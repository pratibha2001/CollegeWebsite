import crypto from 'node:crypto';
import pool from '../../config/db.js';
import { httpError } from '../../shared/errors.js';
import { getStudent } from './course.service.js';

// area name -> column. Only these strings ever reach the SQL.
const AREAS = { Academics: 'AcademicsCleared', Library: 'LibraryCleared', Hostel: 'HostelCleared', Finance: 'FinanceCleared' };

async function lockActiveStudent(client, studentId) {
  const { rows: [st] } = await client.query(
    `select "StudentId", "UserId", "EnrolmentNo", "ProgrammeId", "BatchId", "Status"
       from "Student"."Students" where "StudentId" = $1 for update`, [studentId]);
  if (!st) throw httpError(404, 'Student not found');
  if (st.Status !== 'Active') throw httpError(409, `Student is ${st.Status}`);
  return st;
}

export async function clearArea({ studentId, area }) {
  const column = AREAS[area];
  if (!column) throw httpError(400, `area must be one of ${Object.keys(AREAS).join(', ')}`);

  const client = await pool.connect();
  try {
    await client.query('begin');
    await lockActiveStudent(client, studentId);

    if (area === 'Academics') {
      const { rows: [g] } = await client.query(
        `select count(*) filter (where "Status" in ('Published', 'Locked'))::int as published,
                count(*) filter (where "Status" = 'Draft')::int as drafts
           from "Student"."GradeSheets" where "StudentId" = $1`, [studentId]);
      if (!g.published || g.drafts) throw httpError(409, 'Academics: needs published grade sheets and no pending drafts');
    }

    await client.query(
      `insert into "Student"."GraduationClearances" ("StudentId") values ($1)
       on conflict ("StudentId") do nothing`, [studentId]);
    await client.query(
      `update "Student"."GraduationClearances" set "${column}" = true where "StudentId" = $1`, [studentId]);
    await client.query(
      `update "Student"."GraduationClearances" set "ClearedAt" = now()
        where "StudentId" = $1 and "ClearedAt" is null
          and "AcademicsCleared" and "LibraryCleared" and "HostelCleared" and "FinanceCleared"`, [studentId]);

    const { rows: [c] } = await client.query(
      `select "AcademicsCleared", "LibraryCleared", "HostelCleared", "FinanceCleared", "ClearedAt"
         from "Student"."GraduationClearances" where "StudentId" = $1`, [studentId]);
    await client.query('commit');
    return c;
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}

export async function issueDegree({ studentId }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const st = await lockActiveStudent(client, studentId);

    const { rows: [c] } = await client.query(
      `select "ClearedAt", "DegreeIssuedAt" from "Student"."GraduationClearances"
        where "StudentId" = $1 for update`, [studentId]);
    if (!c?.ClearedAt) throw httpError(409, 'Not fully cleared yet');
    if (c.DegreeIssuedAt) throw httpError(409, 'Degree already issued');

    const code = 'DV' + crypto.randomBytes(6).toString('hex').toUpperCase();
    await client.query(
      `update "Student"."GraduationClearances"
          set "DegreeIssuedAt" = now(), "DegreeVerificationCode" = $2 where "StudentId" = $1`, [studentId, code]);
    await client.query(
      `update "Student"."Students" set "Status" = 'Graduated', "UpdatedAt" = now() where "StudentId" = $1`, [studentId]);
    await client.query(
      `insert into "Common"."OutboxEvents" ("AggregateType", "AggregateId", "EventType", "Payload")
       values ('Student', $1, 'StudentGraduated', $2)`,
      [String(studentId), { studentId, userId: st.UserId, enrolmentNo: st.EnrolmentNo,
                            programmeId: st.ProgrammeId, batchId: st.BatchId, verificationCode: code }]);
    await client.query('commit');
    return { issued: true, verificationCode: code };
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}

// public: employers check a degree with the code only
export async function verifyDegree(code) {
  const { rows: [d] } = await pool.query(
    `select u."FullName" as "name", s."EnrolmentNo" as "enrolmentNo", p."ProgrammeName" as programme,
            b."BatchName" as batch, gc."DegreeIssuedAt" as "issuedAt"
       from "Student"."GraduationClearances" gc
       join "Student"."Students" s on s."StudentId" = gc."StudentId"
       join "Common"."Users" u on u."UserId" = s."UserId"
       join "Academics"."Programmes" p on p."ProgrammeId" = s."ProgrammeId"
       join "Academics"."Batches" b on b."BatchId" = s."BatchId"
      where gc."DegreeVerificationCode" = $1 and gc."DegreeIssuedAt" is not null`, [code]);
  if (!d) throw httpError(404, 'No degree found for this code');
  return { valid: true, ...d };
}

export async function myClearance(userId) {
  const s = await getStudent(pool, userId);
  const { rows: [c] } = await pool.query(
    `select "AcademicsCleared", "LibraryCleared", "HostelCleared", "FinanceCleared", "ClearedAt"
       from "Student"."GraduationClearances" where "StudentId" = $1`, [s.StudentId]);
  return c ?? { AcademicsCleared: false, LibraryCleared: false, HostelCleared: false, FinanceCleared: false, ClearedAt: null };
}

export async function getGraduateInfo(db, userId) {
  const { rows: [g] } = await db.query(
    `select s."StudentId", s."ProgrammeId", extract(year from gc."DegreeIssuedAt")::int as "graduationYear"
       from "Student"."Students" s
       join "Student"."GraduationClearances" gc on gc."StudentId" = s."StudentId"
      where s."UserId" = $1 and s."Status" = 'Graduated' and gc."DegreeIssuedAt" is not null`, [userId]);
  return g ?? null;
}