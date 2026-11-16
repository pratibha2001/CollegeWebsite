import pool from '../../config/db.js';
import { httpError } from '../../shared/errors.js';

async function getStudent(db, userId) {
  const { rows } = await db.query(
    `select "StudentId", "BatchId" from "Student"."Students"
      where "UserId" = $1 and "Status" = 'Active'`, [userId]);
  if (!rows[0]) throw httpError(404, 'Student record not found');
  return rows[0];
}

export async function listSemesterCourses(userId) {
  const s = await getStudent(pool, userId);
  const { rows } = await pool.query(
    `select sc."SemesterCourseId", c."CourseCode", c."CourseName", c."Credits", c."IsElective",
            sc."SeatLimit", (cr."CourseRegistrationId" is not null) as "Registered"
       from "Academics"."Semesters" sem
       join "Academics"."SemesterCourses" sc on sc."SemesterId" = sem."SemesterId"
       join "Academics"."Courses" c on c."CourseId" = sc."CourseId"
       left join "Student"."CourseRegistrations" cr
         on cr."SemesterCourseId" = sc."SemesterCourseId" and cr."StudentId" = $2
        and cr."Status" = 'Registered'
      where sem."BatchId" = $1 and current_date between sem."StartDate" and sem."EndDate"
      order by c."IsElective", c."CourseCode"`, [s.BatchId, s.StudentId]);
  return rows;
}

export async function registerCourse(userId, semesterCourseId) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const s = await getStudent(client, userId);
    const { rows } = await client.query(
      `select sc."SeatLimit" from "Academics"."SemesterCourses" sc
         join "Academics"."Semesters" sem on sem."SemesterId" = sc."SemesterId"
        where sc."SemesterCourseId" = $1 and sem."BatchId" = $2
          and current_date between sem."StartDate" and sem."EndDate"
        for update of sc`, [semesterCourseId, s.BatchId]);
    if (!rows[0]) throw httpError(404, 'Course not offered to you this semester');
    if (rows[0].SeatLimit) {
      const { rows: [{ taken }] } = await client.query(
        `select count(*)::int as taken from "Student"."CourseRegistrations"
          where "SemesterCourseId" = $1 and "Status" = 'Registered'`, [semesterCourseId]);
      if (taken >= rows[0].SeatLimit) throw httpError(409, 'Course is full');
    }
    const r = await client.query(
      `insert into "Student"."CourseRegistrations" ("StudentId","SemesterCourseId")
       values ($1, $2)
       on conflict ("StudentId","SemesterCourseId")
         do update set "Status" = 'Registered', "RegisteredAt" = now()
         where "CourseRegistrations"."Status" = 'Dropped'
       returning "CourseRegistrationId"`, [s.StudentId, semesterCourseId]);
    await client.query('commit');
    return { registered: true, alreadyRegistered: r.rowCount === 0 };
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}