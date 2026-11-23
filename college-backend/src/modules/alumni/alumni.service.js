import pool from '../../config/db.js';
import { httpError } from '../../shared/errors.js';
import { recordConsent } from '../common/consent.service.js';
import { getGraduateInfo } from '../student/graduation.service.js';

export async function getMyProfile(userId) {
  const { rows: [p] } = await pool.query(
    `select a.*, pr."ProgrammeName" from "Alumni"."AlumniProfiles" a
       join "Academics"."Programmes" pr on pr."ProgrammeId" = a."ProgrammeId"
      where a."UserId" = $1`, [userId]);
  if (!p) throw httpError(404, 'No alumni profile yet. Activate it first');
  return p;
}

export async function activateProfile(userId, { directoryOptIn, mentorshipOptIn, consent, ip }) {
  if (consent !== true) throw httpError(400, 'You must agree to the alumni privacy terms (consent: true)');

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select 1 from "Common"."Users" where "UserId" = $1 for update`, [userId]);

    const { rows: [existing] } = await client.query(
      `select 1 from "Alumni"."AlumniProfiles" where "UserId" = $1`, [userId]);
    if (existing) throw httpError(409, 'Alumni profile already active');

    const grad = await getGraduateInfo(client, userId);
    if (!grad) throw httpError(404, 'Only graduates with an issued degree can activate an alumni profile');

    const consentRecordId = await recordConsent(client, {
      userId, purposeCode: 'ALUMNI_PROFILE', channel: 'WebForm', givenByGuardian: false, ip,
    });

    const { rows: [p] } = await client.query(
      `insert into "Alumni"."AlumniProfiles"
         ("UserId","StudentId","ProgrammeId","GraduationYear","VerificationStatus",
          "DirectoryOptIn","MentorshipOptIn","ConsentRecordId")
       values ($1, $2, $3, $4, 'Verified', $5, $6, $7)
       returning "AlumniProfileId", "GraduationYear", "VerificationStatus", "DirectoryOptIn", "MentorshipOptIn"`,
      [userId, grad.StudentId, grad.ProgrammeId, grad.graduationYear,
       directoryOptIn === true, mentorshipOptIn === true, consentRecordId]);
    await client.query('commit');
    return p;
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}