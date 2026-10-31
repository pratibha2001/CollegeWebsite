import pool from '../../config/db.js';
import { hmac, generateOtp, safeEqual } from '../../shared/crypto.js';

const normalize = (type, value) =>
  type === 'Email' ? value.trim().toLowerCase() : value.replace(/[\s-]/g, '');

const hashSubject = (type, subject) => hmac(`${type}:${normalize(type, subject)}`);

export async function requestOtp({ subjectType, subject, purpose, ip }) {
  const subjectHash = hashSubject(subjectType, subject);

  const { rows } = await pool.query(
    `select count(*)::int as n from "Common"."OtpChallenges"
     where "SubjectHash" = $1 and "Purpose" = $2
       and "CreatedAt" > now() - interval '10 minutes'`,
    [subjectHash, purpose]
  );
  if (rows[0].n >= 3) {
    const err = new Error('Too many codes requested. Try again later.');
    err.status = 429;
    throw err;
  }

  const code = generateOtp();
  await pool.query(
    `insert into "Common"."OtpChallenges"
       ("SubjectType","SubjectHash","Purpose","CodeHash","ExpiresAt","IpHash")
     values ($1,$2,$3,$4, now() + interval '10 minutes', $5)`,
    [subjectType, subjectHash, purpose, hmac(`${subjectHash}:${code}`), ip ? hmac(ip) : null]
  );

  console.log(`[DEV OTP] ${subjectType} ${subject}: ${code}`);
  return { expiresInSeconds: 600 };
}

export async function verifyOtp({ subjectType, subject, purpose, code }) {
  const subjectHash = hashSubject(subjectType, subject);
  const fail = () => {
    const err = new Error('Invalid or expired code');
    err.status = 400;
    return err;
  };

  const { rows } = await pool.query(
    `update "Common"."OtpChallenges" set "Attempts" = "Attempts" + 1
     where "OtpChallengeId" = (
       select "OtpChallengeId" from "Common"."OtpChallenges"
       where "SubjectHash" = $1 and "Purpose" = $2
         and "ConsumedAt" is null and "ExpiresAt" > now()
       order by "CreatedAt" desc limit 1)
       and "Attempts" < "MaxAttempts"
     returning "OtpChallengeId", "CodeHash"`,
    [subjectHash, purpose]
  );
  if (rows.length === 0) throw fail();

  if (!safeEqual(rows[0].CodeHash, hmac(`${subjectHash}:${code}`))) throw fail();

  const used = await pool.query(
    `update "Common"."OtpChallenges" set "ConsumedAt" = now()
     where "OtpChallengeId" = $1 and "ConsumedAt" is null`,
    [rows[0].OtpChallengeId]
  );
  if (used.rowCount !== 1) throw fail();

  return true;
}