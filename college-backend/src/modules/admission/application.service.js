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

export async function savePersonal({ userId, applicationId, data }) {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const app = await client.query(
      `select "Status" from "Admission"."Applications"
       where "ApplicationId" = $1 and "ApplicantUserId" = $2
       for update`,
      [applicationId, userId]
    );
    if (app.rows.length === 0) throw httpError(404, 'Application not found');
    if (app.rows[0].Status !== 'Draft') throw httpError(409, 'This application can no longer be edited');

    await client.query(
      `insert into "Admission"."ApplicationPersonal"
         ("ApplicationId", "DateOfBirth", "Gender", "Category", "IsPwd", "Nationality", "HomeState",
          "GuardianName", "GuardianRelation", "GuardianMobile", "GuardianEmail",
          "AddressCurrent", "AddressPermanent", "NeedsHostel", "NeedsTransport")
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       on conflict ("ApplicationId") do update set
         "DateOfBirth" = excluded."DateOfBirth",
         "Gender" = excluded."Gender",
         "Category" = excluded."Category",
         "IsPwd" = excluded."IsPwd",
         "Nationality" = excluded."Nationality",
         "HomeState" = excluded."HomeState",
         "GuardianName" = excluded."GuardianName",
         "GuardianRelation" = excluded."GuardianRelation",
         "GuardianMobile" = excluded."GuardianMobile",
         "GuardianEmail" = excluded."GuardianEmail",
         "AddressCurrent" = excluded."AddressCurrent",
         "AddressPermanent" = excluded."AddressPermanent",
         "NeedsHostel" = excluded."NeedsHostel",
         "NeedsTransport" = excluded."NeedsTransport"`,
      [
        applicationId, data.dateOfBirth, data.gender, data.category, data.isPwd, data.nationality,
        data.homeState, data.guardianName, data.guardianRelation, data.guardianMobile,
        data.guardianEmail, data.addressCurrent, data.addressPermanent,
        data.needsHostel, data.needsTransport,
      ]
    );

    await client.query(
      `update "Admission"."Applications"
       set "CurrentStep" = greatest("CurrentStep", 2),
           "UpdatedAt" = now(),
           "RowVersion" = "RowVersion" + 1
       where "ApplicationId" = $1`,
      [applicationId]
    );

    const minor = await client.query(
      `select age(current_date, "DateOfBirth") < interval '18 years' as "isMinor"
       from "Admission"."ApplicationPersonal" where "ApplicationId" = $1`,
      [applicationId]
    );

    await client.query('commit');
    return { saved: true, isMinor: minor.rows[0].isMinor };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}