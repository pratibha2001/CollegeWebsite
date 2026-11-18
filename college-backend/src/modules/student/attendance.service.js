import pool from '../../config/db.js';
import { httpError } from '../../shared/errors.js';
import { getStudent } from './course.service.js';

const STATUSES = ['Present', 'Absent', 'Late', 'Excused'];

async function assertTeaches(db, facultyUserId, semesterCourseId) {
  const { rows } = await db.query(
    `select 1 from "Academics"."SemesterCourses"
      where "SemesterCourseId" = $1 and "FacultyUserId" = $2`, [semesterCourseId, facultyUserId]);
  if (!rows[0]) throw httpError(403, 'You do not teach this course');
}

export async function getRoster(facultyUserId, semesterCourseId) {
  await assertTeaches(pool, facultyUserId, semesterCourseId);
  const { rows } = await pool.query(
    `select s."StudentId", s."EnrolmentNo", u."FullName"
       from "Student"."CourseRegistrations" cr
       join "Student"."Students" s on s."StudentId" = cr."StudentId"
       join "Common"."Users" u on u."UserId" = s."UserId"
      where cr."SemesterCourseId" = $1 and cr."Status" = 'Registered'
      order by s."EnrolmentNo"`, [semesterCourseId]);
  return rows;
}

export async function markAttendance({ facultyUserId, semesterCourseId, sessionDate, startTime, records }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate || '')) throw httpError(400, 'sessionDate must be YYYY-MM-DD');
  if (new Date(sessionDate) > new Date()) throw httpError(400, 'Cannot mark attendance for a future date');
  if (!/^\d{2}:\d{2}$/.test(startTime || '')) throw httpError(400, 'startTime must be HH:MM');
  if (!Array.isArray(records) || records.length === 0) throw httpError(400, 'records required');
  for (const r of records) {
    if (!Number.isInteger(r.studentId) || !STATUSES.includes(r.status))
      throw httpError(400, `Bad record: ${JSON.stringify(r)}`);
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    await assertTeaches(client, facultyUserId, semesterCourseId);

    const ids = records.map((r) => r.studentId);
    const { rows: ok } = await client.query(
      `select "StudentId" from "Student"."CourseRegistrations"
        where "SemesterCourseId" = $1 and "Status" = 'Registered' and "StudentId" = any($2)`,
      [semesterCourseId, ids]);
    if (ok.length !== new Set(ids).size) throw httpError(400, 'Some students are not registered for this course');

    const { rows: [session] } = await client.query(
      `insert into "Student"."AttendanceSessions" ("SemesterCourseId","SessionDate","StartTime","MarkedBy")
       values ($1, $2, $3, $4)
       on conflict ("SemesterCourseId","SessionDate","StartTime")
         do update set "MarkedBy" = excluded."MarkedBy", "MarkedAt" = now()
       returning "AttendanceSessionId"`,
      [semesterCourseId, sessionDate, startTime, facultyUserId]);

    for (const r of records) {
      await client.query(
        `insert into "Student"."AttendanceRecords" ("AttendanceSessionId","StudentId","Status")
         values ($1, $2, $3)
         on conflict ("AttendanceSessionId","StudentId") do update set "Status" = excluded."Status"`,
        [session.AttendanceSessionId, r.studentId, r.status]);
    }

    await client.query('commit');
    return { attendanceSessionId: session.AttendanceSessionId, marked: records.length };
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}



export async function myAttendance(userId) {
  const s = await getStudent(pool, userId);
  const { rows } = await pool.query(
    `select c."CourseCode", c."CourseName",
            count(a."AttendanceSessionId") filter (where coalesce(r."Status", 'Absent') <> 'Excused')::int as held,
            count(*) filter (where r."Status" in ('Present', 'Late'))::int as attended
       from "Student"."CourseRegistrations" cr
       join "Academics"."SemesterCourses" sc on sc."SemesterCourseId" = cr."SemesterCourseId"
       join "Academics"."Courses" c on c."CourseId" = sc."CourseId"
       left join "Student"."AttendanceSessions" a on a."SemesterCourseId" = cr."SemesterCourseId"
       left join "Student"."AttendanceRecords" r
              on r."AttendanceSessionId" = a."AttendanceSessionId" and r."StudentId" = cr."StudentId"
      where cr."StudentId" = $1 and cr."Status" = 'Registered'
      group by c."CourseCode", c."CourseName"
      order by c."CourseCode"`, [s.StudentId]);

  return rows.map((r) => {
    const percent = r.held ? Math.round((r.attended * 1000) / r.held) / 10 : null;
    return { ...r, percent, shortage: percent !== null && percent < 75 };
  });
}