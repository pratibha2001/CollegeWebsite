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

// the fields other alumni can see, if the owner allows it (key → column)
const PUBLIC_FIELDS = {
  currentTitle: 'CurrentTitle', organisation: 'Organisation', industry: 'Industry',
  city: 'City', country: 'Country', bio: 'Bio', linkedInUrl: 'LinkedInUrl',
};
// editable text fields: key → [column, max length]
const TEXT_FIELDS = {
  currentTitle: ['CurrentTitle', 100], organisation: ['Organisation', 150], industry: ['Industry', 80],
  city: ['City', 80], bio: ['Bio', 2000], linkedInUrl: ['LinkedInUrl', 200],
};

export async function updateMyProfile(userId, body = {}) {
  const sets = [];
  const vals = [];
  const set = (col, val) => { vals.push(val); sets.push(`"${col}" = $${vals.length}`); };

  for (const [key, [col, max]] of Object.entries(TEXT_FIELDS)) {
    if (body[key] === undefined) continue;
    const v = body[key] === null ? null : String(body[key]).trim();
    if (v && v.length > max) throw httpError(400, `${key} can be at most ${max} characters`);
    if (key === 'linkedInUrl' && v && !/^https:\/\/(www\.)?linkedin\.com\//.test(v))
      throw httpError(400, 'linkedInUrl must be a https://linkedin.com/ link');
    set(col, v || null);
  }
  if (body.country !== undefined) {
    if (body.country !== null && !/^[A-Z]{2}$/.test(body.country)) throw httpError(400, 'country must be a 2-letter code like IN');
    set('Country', body.country);
  }
  for (const [key, col] of [['directoryOptIn', 'DirectoryOptIn'], ['mentorshipOptIn', 'MentorshipOptIn']]) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'boolean') throw httpError(400, `${key} must be true or false`);
    set(col, body[key]);
  }
  if (body.mentorshipAreas !== undefined) {
    const a = body.mentorshipAreas;
    if (!Array.isArray(a) || a.length > 10 || a.some((x) => typeof x !== 'string' || !x.trim() || x.length > 50))
      throw httpError(400, 'mentorshipAreas must be up to 10 short text items');
    set('MentorshipAreas', a.map((x) => x.trim()));
  }
  if (body.fieldVisibility !== undefined) {
    const fv = body.fieldVisibility;
    if (!fv || typeof fv !== 'object' || Array.isArray(fv)
        || Object.entries(fv).some(([k, v]) => !PUBLIC_FIELDS[k] || typeof v !== 'boolean'))
      throw httpError(400, `fieldVisibility keys: ${Object.keys(PUBLIC_FIELDS).join(', ')}; values true/false`);
    set('FieldVisibility', fv);
  }
  if (!sets.length) throw httpError(400, 'Nothing to update');

  vals.push(userId);
  const { rows: [p] } = await pool.query(
    `update "Alumni"."AlumniProfiles" set ${sets.join(', ')}, "UpdatedAt" = now()
      where "UserId" = $${vals.length} returning *`, vals);
  if (!p) throw httpError(404, 'No alumni profile yet. Activate it first');
  return p;
}

function toCard(r) {
  const visible = r.FieldVisibility ?? {};
  const card = { alumniProfileId: r.AlumniProfileId, name: r.FullName, programme: r.ProgrammeName,
                 graduationYear: r.GraduationYear, openToMentoring: r.MentorshipOptIn };
  for (const [key, col] of Object.entries(PUBLIC_FIELDS)) if (visible[key] === true) card[key] = r[col];
  return card;
}

export async function searchDirectory({ q, programmeId, graduationYear, page }) {
  const where = [`a."VerificationStatus" = 'Verified'`, `a."DirectoryOptIn"`];
  const vals = [];
  const param = (v) => { vals.push(v); return `$${vals.length}`; };

  if (q) {
    if (String(q).length > 100) throw httpError(400, 'q is too long');
    const like = param('%' + String(q).replace(/[%_\\]/g, '\\$&') + '%');
    where.push(`(u."FullName" ilike ${like}
      or (a."FieldVisibility"->>'organisation' = 'true' and a."Organisation" ilike ${like})
      or (a."FieldVisibility"->>'city' = 'true' and a."City" ilike ${like}))`);
  }
  if (programmeId !== undefined) {
    if (!Number.isInteger(Number(programmeId))) throw httpError(400, 'programmeId must be a number');
    where.push(`a."ProgrammeId" = ${param(Number(programmeId))}`);
  }
  if (graduationYear !== undefined) {
    if (!Number.isInteger(Number(graduationYear))) throw httpError(400, 'graduationYear must be a number');
    where.push(`a."GraduationYear" = ${param(Number(graduationYear))}`);
  }
  const pageNo = Math.max(1, Number(page) || 1);

  const { rows } = await pool.query(
    `select a.*, u."FullName", pr."ProgrammeName"
       from "Alumni"."AlumniProfiles" a
       join "Common"."Users" u on u."UserId" = a."UserId"
       join "Academics"."Programmes" pr on pr."ProgrammeId" = a."ProgrammeId"
      where ${where.join(' and ')}
      order by u."FullName"
      limit 20 offset ${(pageNo - 1) * 20}`, vals);
  return { page: pageNo, results: rows.map(toCard) };
}