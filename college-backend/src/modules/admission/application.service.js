import pool from '../../config/db.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });

export async function createDraft({ userId, programmeId, intakeMonth }) {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const win = await client.query(
      `select "AcademicYear" from "Admission"."ApplicationWindows"
       where "ProgrammeId" = $1 and now() between "OpensAt" and "ClosesAt"`,
      [programmeId]
    );
    if (win.rows.length === 0) throw httpError(400, 'Applications are not open for this programme');
    const academicYear = win.rows[0].AcademicYear;

    const form = await client.query(
      `select "FormDefinitionId" from "Admission"."FormDefinitions"
       where "FormKey" = 'undergraduate-application' and "Status" = 'Published'
       order by "Version" desc limit 1`
    );
    if (form.rows.length === 0) throw httpError(500, 'No published application form');

    const inserted = await client.query(
      `insert into "Admission"."Applications"
         ("ApplicantUserId", "ProgrammeId", "AcademicYear", "IntakeMonth", "FormDefinitionId")
       values ($1, $2, $3, $4, $5)
       on conflict ("ApplicantUserId", "ProgrammeId", "AcademicYear")
         where "Status" not in ('Withdrawn', 'Expired') do nothing
       returning "ApplicationId"`,
      [userId, programmeId, academicYear, intakeMonth, form.rows[0].FormDefinitionId]
    );

    let applicationId;
    const created = inserted.rows.length === 1;
    if (created) {
      applicationId = inserted.rows[0].ApplicationId;
      await client.query(
        `insert into "Admission"."ApplicationStatusHistory"
           ("ApplicationId", "FromStatus", "ToStatus", "ActorUserId", "ActorType")
         values ($1, null, 'Draft', $2, 'Applicant')`,
        [applicationId, userId]
      );
    } else {
      const existing = await client.query(
        `select "ApplicationId" from "Admission"."Applications"
         where "ApplicantUserId" = $1 and "ProgrammeId" = $2 and "AcademicYear" = $3
           and "Status" not in ('Withdrawn', 'Expired')`,
        [userId, programmeId, academicYear]
      );
      applicationId = existing.rows[0].ApplicationId;
    }

    await client.query('commit');
    return { applicationId, created };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function listMine(userId) {
  const { rows } = await pool.query(
    `select a."ApplicationId" as id, a."ApplicationNo" as "applicationNo",
            p."ProgrammeName" as programme, a."AcademicYear" as "academicYear",
            a."Status" as status, a."CurrentStep" as "currentStep", a."UpdatedAt" as "updatedAt"
     from "Admission"."Applications" a
     join "Academics"."Programmes" p on p."ProgrammeId" = a."ProgrammeId"
     where a."ApplicantUserId" = $1
     order by a."CreatedAt" desc`,
    [userId]
  );
  return rows;
}