import pool from '../../config/db.js';
import { httpError } from '../../shared/errors.js';
import { getStudent } from './course.service.js';

const GRADES = [[90, 'O', 10], [80, 'A+', 9], [70, 'A', 8], [60, 'B+', 7], [50, 'B', 6], [40, 'C', 5], [0, 'F', 0]];
export const toGrade = (pct) => GRADES.find(([min]) => pct >= min);

// one row per student per course: total out of 100
export async function courseScores(db, semesterId) {
  const { rows } = await db.query(
    `select cr."StudentId", c."CourseCode", c."CourseName", c."Credits"::float as credits,
            sum(coalesce(re."Marks", 0) / a."MaxMarks" * a."Weightage")::float as total
       from "Academics"."SemesterCourses" sc
       join "Academics"."Courses" c on c."CourseId" = sc."CourseId"
       join "Student"."CourseRegistrations" cr
         on cr."SemesterCourseId" = sc."SemesterCourseId" and cr."Status" = 'Registered'
       join "Student"."Assessments" a on a."SemesterCourseId" = sc."SemesterCourseId"
       left join "Student"."ResultEntries" re
         on re."AssessmentId" = a."AssessmentId" and re."StudentId" = cr."StudentId" and re."IsCurrent"
      where sc."SemesterId" = $1
      group by cr."StudentId", c."CourseCode", c."CourseName", c."Credits"`, [semesterId]);
  return rows;
}

export async function generateGradeSheets(semesterId) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: [sem] } = await client.query(
      `select 1 from "Academics"."Semesters" where "SemesterId" = $1 for update`, [semesterId]);
    if (!sem) throw httpError(404, 'Semester not found');

    // courses that have students but aren't fully assessed + published
    const { rows: notReady } = await client.query(
      `select c."CourseCode", coalesce(sum(a."Weightage"), 0)::float as weight,
              coalesce(bool_or(not a."IsPublished"), false) as unpublished
         from "Academics"."SemesterCourses" sc
         join "Academics"."Courses" c on c."CourseId" = sc."CourseId"
         left join "Student"."Assessments" a on a."SemesterCourseId" = sc."SemesterCourseId"
        where sc."SemesterId" = $1
          and exists (select 1 from "Student"."CourseRegistrations" cr
                       where cr."SemesterCourseId" = sc."SemesterCourseId" and cr."Status" = 'Registered')
        group by c."CourseCode"
       having coalesce(sum(a."Weightage"), 0) <> 100 or coalesce(bool_or(not a."IsPublished"), false)`,
      [semesterId]);
    if (notReady.length) {
      throw httpError(409, 'Not ready: ' + notReady
        .map((r) => `${r.CourseCode} (weightage ${r.weight}/100${r.unpublished ? ', has unpublished assessments' : ''})`)
        .join('; '));
    }

    const byStudent = {};
    for (const s of await courseScores(client, semesterId)) {
      const [, , gp] = toGrade(s.total);
      const b = (byStudent[s.StudentId] ??= { credits: 0, points: 0 });
      b.credits += s.credits;
      b.points += s.credits * gp;
    }

    await client.query(
      `delete from "Student"."GradeSheets" where "SemesterId" = $1 and "Status" = 'Draft'`, [semesterId]);

    const out = [];
    for (const [studentId, b] of Object.entries(byStudent)) {
      const sgpa = Math.round((b.points / b.credits) * 100) / 100;
      const { rows: [{ v }] } = await client.query(
        `select coalesce(max("VersionNo"), 0) + 1 as v from "Student"."GradeSheets"
          where "StudentId" = $1 and "SemesterId" = $2`, [studentId, semesterId]);
      // simplified CGPA: mean of this SGPA and earlier published SGPAs
      const { rows: [{ cgpa }] } = await client.query(
        `select round(((coalesce(sum("Sgpa"), 0) + $3) / (count(*) + 1))::numeric, 2)::float as cgpa
           from "Student"."GradeSheets"
          where "StudentId" = $1 and "SemesterId" <> $2 and "Status" in ('Published', 'Locked')`,
        [studentId, semesterId, sgpa]);
      await client.query(
        `insert into "Student"."GradeSheets" ("StudentId","SemesterId","VersionNo","Sgpa","Cgpa")
         values ($1, $2, $3, $4, $5)`, [studentId, semesterId, v, sgpa, cgpa]);
      out.push({ studentId: Number(studentId), versionNo: v, sgpa, cgpa });
    }

    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}

export async function publishGradeSheets({ semesterId, reason }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: drafts } = await client.query(
      `select "GradeSheetId" from "Student"."GradeSheets"
        where "SemesterId" = $1 and "Status" = 'Draft' for update`, [semesterId]);
    if (!drafts.length) throw httpError(409, 'No draft grade sheets. Generate first');

    const { rows: prev } = await client.query(
      `select "GradeSheetId" from "Student"."GradeSheets"
        where "SemesterId" = $1 and "Status" = 'Published' for update`, [semesterId]);
    if (prev.length && !reason?.trim()) throw httpError(400, 'reason is required to replace published grade sheets');

    await client.query(
      `update "Student"."GradeSheets" set "Status" = 'Superseded'
        where "SemesterId" = $1 and "Status" = 'Published'`, [semesterId]);
    await client.query(
      `update "Student"."GradeSheets" set "Status" = 'Published', "PublishedAt" = now(), "ChangeReason" = $2
        where "SemesterId" = $1 and "Status" = 'Draft'`, [semesterId, prev.length ? reason.trim() : null]);

    await client.query('commit');
    return { published: drafts.length, superseded: prev.length };
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}

export async function myGradeSheets(userId) {
  const s = await getStudent(pool, userId);
  const { rows: sheets } = await pool.query(
    `select g."SemesterId", sem."SemesterNo", g."VersionNo",
            g."Sgpa"::float as sgpa, g."Cgpa"::float as cgpa, g."PublishedAt"
       from "Student"."GradeSheets" g
       join "Academics"."Semesters" sem on sem."SemesterId" = g."SemesterId"
      where g."StudentId" = $1 and g."Status" in ('Published', 'Locked')
      order by sem."SemesterNo"`, [s.StudentId]);

  const out = [];
  for (const g of sheets) {
    const courses = (await courseScores(pool, g.SemesterId))
      .filter((c) => c.StudentId === s.StudentId)
      .map((c) => {
        const [, grade, gradePoint] = toGrade(c.total);
        return { courseCode: c.CourseCode, courseName: c.CourseName, credits: c.credits,
                 total: Math.round(c.total * 100) / 100, grade, gradePoint };
      });
    out.push({ semesterNo: g.SemesterNo, versionNo: g.VersionNo, sgpa: g.sgpa, cgpa: g.cgpa,
               publishedAt: g.PublishedAt, courses });
  }
  return out;
}