import pool from '../../config/db.js';
import { requestOtp, verifyOtp } from '../common/otp.service.js';
import { recordConsent } from '../common/consent.service.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function loadMinorDraft(db, userId, applicationId, lock) {
  const { rows } = await db.query(
    `select a."Status", a."GuardianConsentRecordId", p."GuardianMobile",
            age(current_date, p."DateOfBirth") < interval '18 years' as "isMinor"
     from "Admission"."Applications" a
     left join "Admission"."ApplicationPersonal" p on p."ApplicationId" = a."ApplicationId"
     where a."ApplicationId" = $1 and a."ApplicantUserId" = $2
     ${lock ? 'for update of a' : ''}`,
    [applicationId, userId]
  );
  const app = rows[0];
  if (!app) throw httpError(404, 'Application not found');
  if (app.Status !== 'Draft') throw httpError(409, 'This application can no longer be edited');
  if (!app.GuardianMobile) throw httpError(400, 'Save personal and guardian details first');
  if (!app.isMinor) throw httpError(400, 'Guardian consent is only needed for applicants under 18');
  if (app.GuardianConsentRecordId) throw httpError(409, 'Guardian consent already recorded');
  return app;
}

export async function requestGuardianConsent({ userId, applicationId, ip }) {
  const app = await loadMinorDraft(pool, userId, applicationId, false);
  await requestOtp({ subjectType: 'Mobile', subject: app.GuardianMobile, purpose: 'MobileVerify', ip });
  return { sentTo: '******' + app.GuardianMobile.slice(-4) };
}

export async function confirmGuardianConsent({ userId, applicationId, code, ip }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const app = await loadMinorDraft(client, userId, applicationId, true);

    await verifyOtp({ subjectType: 'Mobile', subject: app.GuardianMobile, purpose: 'MobileVerify', code });

    const consentRecordId = await recordConsent(client, {
      userId, purposeCode: 'GUARDIAN_ADMISSION', channel: 'WebForm', givenByGuardian: true, ip,
    });

    await client.query(
      `update "Admission"."Applications"
       set "GuardianConsentRecordId" = $1, "UpdatedAt" = now(), "RowVersion" = "RowVersion" + 1
       where "ApplicationId" = $2`,
      [consentRecordId, applicationId]
    );

    await client.query('commit');
    return { consentRecordId };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}