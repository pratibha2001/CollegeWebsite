import { httpError } from '../../shared/errors.js';
import { getStudent } from './course.service.js';

export async function getSemesterFee(db, { userId, semesterId }) {
  const s = await getStudent(db, userId);
  const { rows: [sem] } = await db.query(
    `select sem."SemesterNo", st."ProgrammeId",
            (extract(year from sem."StartDate") - case when extract(month from sem."StartDate") >= 6 then 0 else 1 end)::int as y
       from "Academics"."Semesters" sem
       join "Student"."Students" st on st."BatchId" = sem."BatchId"
      where sem."SemesterId" = $1 and st."StudentId" = $2`, [semesterId, s.StudentId]);
  if (!sem) throw httpError(404, 'Semester not found for you');

  const academicYear = `${sem.y}-${String((sem.y + 1) % 100).padStart(2, '0')}`;
  const { rows: items } = await db.query(
    `select "ItemName", "AmountPaise" from "Academics"."FeeItems"
      where "ProgrammeId" = $1 and "AcademicYear" = $2 and "IsMandatory"
        and ("Frequency" = 'PerSemester' or ("Frequency" = 'PerYear' and $3::int % 2 = 1))
      order by "ItemName"`, [sem.ProgrammeId, academicYear, sem.SemesterNo]);
  if (!items.length) throw httpError(404, `No fees set up for ${academicYear}`);

  return {
    semesterNo: sem.SemesterNo,
    academicYear,
    items: items.map((i) => ({ name: i.ItemName, rupees: Number(i.AmountPaise) / 100 })),
    totalPaise: items.reduce((t, i) => t + Number(i.AmountPaise), 0),
  };
}