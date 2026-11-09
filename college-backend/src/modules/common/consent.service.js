import { hmac } from '../../shared/crypto.js';

export async function recordConsent(client, { userId, purposeCode, channel, givenByGuardian, ip }) {
  const purpose = await client.query(
    `select "ConsentPurposeId" from "Common"."ConsentPurposes"
     where "PurposeCode" = $1 and "IsActive"`,
    [purposeCode]
  );
  const notice = await client.query(
    `select "PrivacyNoticeId" from "Common"."PrivacyNotices"
     where "Language" = 'en' and "EffectiveFrom" <= now()
     order by "EffectiveFrom" desc limit 1`
  );
  if (purpose.rows.length === 0 || notice.rows.length === 0) {
    const err = new Error('Consent purpose or privacy notice not set up');
    err.status = 500;
    throw err;
  }

  const { rows } = await client.query(
    `insert into "Common"."ConsentRecords"
       ("UserId", "ConsentPurposeId", "PrivacyNoticeId", "Status", "Channel", "GivenByGuardian", "IpHash")
     values ($1, $2, $3, 'Granted', $4, $5, $6)
     returning "ConsentRecordId"`,
    [userId, purpose.rows[0].ConsentPurposeId, notice.rows[0].PrivacyNoticeId,
     channel, givenByGuardian, ip ? hmac(ip) : null]
  );
  return rows[0].ConsentRecordId;
}