import pool from '../../config/db.js';
import { normalize } from './otp.service.js';

const COLUMNS = {
  Email: { contact: 'Email', verified: 'EmailVerifiedAt' },
  Mobile: { contact: 'Mobile', verified: 'MobileVerifiedAt' },
};

export async function findOrCreateUser({ subjectType, subject, fullName }) {
  const { contact, verified } = COLUMNS[subjectType];
  const value = normalize(subjectType, subject);

  const found = await pool.query(
    `update "Common"."Users"
     set "${verified}" = coalesce("${verified}", now()),
         "LastLoginAt" = now(),
         "Status" = case when "Status" = 'PendingVerification' then 'Active' else "Status" end
     where "${contact}" = $1
     returning "UserId", "FullName", "UserType", "Status"`,
    [value]
  );
  if (found.rows.length) {
    const user = found.rows[0];
    if (user.Status === 'Locked' || user.Status === 'Disabled') {
      const err = new Error('This account cannot sign in');
      err.status = 403;
      throw err;
    }
    console.log('USER:', user);
    return user;
    
  }

  

  const created = await pool.query(
    `insert into "Common"."Users" ("UserType", "FullName", "${contact}", "Status", "${verified}", "LastLoginAt")
     values ('Applicant', $1, $2, 'Active', now(), now())
     returning "UserId", "FullName", "UserType", "Status"`,
    [fullName?.trim() || 'New Applicant', value]
  );
  const user = created.rows[0];

  await pool.query(
    `insert into "Common"."UserRoles" ("UserId", "RoleId")
     select $1, "RoleId" from "Common"."Roles" where "RoleCode" = 'APPLICANT'`,
    [user.UserId]
  );
  return user;
}

export async function getRoleCodes(userId) {
  const { rows } = await pool.query(
    `select r."RoleCode" from "Common"."UserRoles" ur
     join "Common"."Roles" r on r."RoleId" = ur."RoleId"
     where ur."UserId" = $1 and (ur."ExpiresAt" is null or ur."ExpiresAt" > now())`,
    [userId]
  );
  return rows.map((r) => r.RoleCode);
}