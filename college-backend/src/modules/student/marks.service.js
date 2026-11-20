import pool from '../../config/db.js';
import { httpError } from '../../shared/errors.js';
import { assertTeaches } from './attendance.service.js';

const TYPES = ['Quiz', 'Assignment', 'MidTerm', 'Lab', 'Project', 'EndTerm'];

export async function createAssessment({ facultyUserId, semesterCourseId, name, type, maxMarks, weightage }) {
  if (!name || !TYPES.includes(type)) throw httpError(400, `name required; type one of ${TYPES.join(', ')}`);
  if (!(maxMarks > 0) || !(weightage >= 0 && weightage <= 100)) throw httpError(400, 'maxMarks > 0, weightage 0-100');

  const client = await pool.connect();
  try {
    await client.query('begin');
    await assertTeaches(client, facultyUserId, semesterCourseId);
    await client.query(
      `select 1 from "Academics"."SemesterCourses" where "SemesterCourseId" = $1 for update`, [semesterCourseId]);
    const { rows: [{ total }] } = await client.query(
      `select coalesce(sum("Weightage"), 0)::float as total
         from "Student"."Assessments" where "SemesterCourseId" = $1`, [semesterCourseId]);
    if (total + weightage > 100) throw httpError(409, `Total weightage would pass 100 (already ${total})`);

    const { rows: [a] } = await client.query(
      `insert into "Student"."Assessments"
         ("SemesterCourseId","AssessmentName","AssessmentType","MaxMarks","Weightage")
       values ($1, $2, $3, $4, $5) returning "AssessmentId"`,
      [semesterCourseId, name, type, maxMarks, weightage]);
    await client.query('commit');
    return { assessmentId: a.AssessmentId };
  } catch (e) {
    await client.query('rollback');
    if (e.code === '23505') throw httpError(409, 'An assessment with this name already exists');
    throw e;
  } finally { client.release(); }
}

export async function enterMarks({ facultyUserId, assessmentId, entries, reason }) {
  if (!Array.isArray(entries) || entries.length === 0) throw httpError(400, 'entries required');

  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: [a] } = await client.query(
      `select "SemesterCourseId", "MaxMarks", "IsPublished" from "Student"."Assessments"
        where "AssessmentId" = $1 for update`, [assessmentId]);
    if (!a) throw httpError(404, 'Assessment not found');
    await assertTeaches(client, facultyUserId, a.SemesterCourseId);
    if (a.IsPublished) throw httpError(409, 'Assessment is published; marks are locked');

    const max = Number(a.MaxMarks);
    for (const e of entries) {
      if (!Number.isInteger(e.studentId)) throw httpError(400, 'studentId must be a number');
      if (e.isAbsent !== true && !(typeof e.marks === 'number' && e.marks >= 0 && e.marks <= max))
        throw httpError(400, `Marks for student ${e.studentId} must be 0-${max}`);
    }

    const ids = entries.map((e) => e.studentId);
    const { rows: ok } = await client.query(
      `select "StudentId" from "Student"."CourseRegistrations"
        where "SemesterCourseId" = $1 and "Status" = 'Registered' and "StudentId" = any($2)`,
      [a.SemesterCourseId, ids]);
    if (ok.length !== new Set(ids).size) throw httpError(400, 'Some students are not registered for this course');

    let saved = 0, unchanged = 0;
    for (const e of entries) {
      const absent = e.isAbsent === true;
      const marks = absent ? null : e.marks;

      const { rows: [cur] } = await client.query(
        `select "ResultEntryId", "Marks", "IsAbsent", "VersionNo" from "Student"."ResultEntries"
          where "AssessmentId" = $1 and "StudentId" = $2 and "IsCurrent" for update`,
        [assessmentId, e.studentId]);

      if (cur && cur.IsAbsent === absent && Number(cur.Marks) === Number(marks)) { unchanged++; continue; }
      if (cur) {
        if (!reason) throw httpError(400, 'reason is required when changing existing marks');
        await client.query(
          `update "Student"."ResultEntries" set "IsCurrent" = false where "ResultEntryId" = $1`, [cur.ResultEntryId]);
      }
      await client.query(
        `insert into "Student"."ResultEntries"
           ("AssessmentId","StudentId","Marks","IsAbsent","VersionNo","ChangeReason","EnteredBy")
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [assessmentId, e.studentId, marks, absent, cur ? cur.VersionNo + 1 : 1, cur ? reason : null, facultyUserId]);
      saved++;
    }

    await client.query('commit');
    return { saved, unchanged };
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}