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
       where "FormKey" = 'application.default' and "Status" = 'Published'
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

export async function saveAcademics({ userId, applicationId, records }) {
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

    // remove levels the applicant took out of the list (e.g. a Diploma they deleted)
    await client.query(
      `delete from "Admission"."ApplicationAcademics"
       where "ApplicationId" = $1 and not ("Level" = any($2))`,
      [applicationId, records.map((r) => r.level)]
    );

    for (const r of records) {
      await client.query(
        `insert into "Admission"."ApplicationAcademics"
           ("ApplicationId", "Level", "BoardOrUniversity", "Institution", "YearOfPassing",
            "MarksObtained", "MarksTotal", "Percentage")
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict ("ApplicationId", "Level") do update set
           "BoardOrUniversity" = excluded."BoardOrUniversity",
           "Institution" = excluded."Institution",
           "YearOfPassing" = excluded."YearOfPassing",
           "MarksObtained" = excluded."MarksObtained",
           "MarksTotal" = excluded."MarksTotal",
           "Percentage" = excluded."Percentage",
           "Verified" = false`,
        [applicationId, r.level, r.boardOrUniversity, r.institution, r.yearOfPassing,
         r.marksObtained, r.marksTotal, r.percentage]
      );
    }

    await client.query(
      `update "Admission"."Applications"
       set "CurrentStep" = greatest("CurrentStep", 3),
           "UpdatedAt" = now(),
           "RowVersion" = "RowVersion" + 1
       where "ApplicationId" = $1`,
      [applicationId]
    );

    await client.query('commit');
    return { saved: true, records: records.length };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}


const REQUIRED_DOCS = ['PHOTO', 'SIGNATURE', 'MARKSHEET_10'];

export async function submitApplication({ userId, applicationId }) {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const { rows } = await client.query(
      `select a."Status", a."ProgrammeId", a."GuardianConsentRecordId",
              p."ApplicationId" is not null as "hasPersonal",
              age(current_date, p."DateOfBirth") < interval '18 years' as "isMinor",
              w."ApplicationFeePaise",
              now() between w."OpensAt" and w."ClosesAt" as "windowOpen"
       from "Admission"."Applications" a
       left join "Admission"."ApplicationPersonal" p on p."ApplicationId" = a."ApplicationId"
       left join "Admission"."ApplicationWindows" w
         on w."ProgrammeId" = a."ProgrammeId" and w."AcademicYear" = a."AcademicYear"
       where a."ApplicationId" = $1 and a."ApplicantUserId" = $2
       for update of a`,
      [applicationId, userId]
    );
    const app = rows[0];
    if (!app) throw httpError(404, 'Application not found');
    if (app.Status !== 'Draft') throw httpError(409, 'This application has already been submitted');
    if (!app.windowOpen) throw httpError(400, 'Applications are closed for this programme');

    // collect everything that is missing, so the applicant sees it all at once
    const missing = [];
    if (!app.hasPersonal) missing.push('personal and guardian details');
    if (app.isMinor && !app.GuardianConsentRecordId) missing.push('guardian consent');

    const levels = await client.query(
      `select "Level" from "Admission"."ApplicationAcademics" where "ApplicationId" = $1`,
      [applicationId]
    );
    const haveLevels = levels.rows.map((r) => r.Level);
    if (!haveLevels.includes('Secondary')) missing.push('Class 10 marks');
    if (!haveLevels.includes('SeniorSecondary')) missing.push('Class 12 details');

    const docs = await client.query(
      `select t."TypeCode" from "Admission"."Documents" d
       join "Admission"."DocumentTypes" t on t."DocumentTypeId" = d."DocumentTypeId"
       where d."ApplicationId" = $1 and d."DeletedAt" is null`,
      [applicationId]
    );
    const uploaded = docs.rows.map((r) => r.TypeCode);
    for (const code of REQUIRED_DOCS) {
      if (!uploaded.includes(code)) missing.push(`document ${code}`);
    }

    if (missing.length > 0) {
      await client.query('rollback');
      return { submitted: false, missing };
    }

    const feePaise = Number(app.ApplicationFeePaise);
    const updated = await client.query(
      `update "Admission"."Applications"
       set "Status" = 'Submitted',
           "ApplicationNo" = 'APP' || left("AcademicYear", 4) || lpad("ApplicationId"::text, 6, '0'),
           "SubmittedAt" = now(),
           "DeclarationAcceptedAt" = now(),
           "FeeStatus" = case when $2::bigint = 0 then 'NotRequired' else "FeeStatus" end,
           "CurrentStep" = greatest("CurrentStep", 6),
           "UpdatedAt" = now(),
           "RowVersion" = "RowVersion" + 1
       where "ApplicationId" = $1
       returning "ApplicationNo", "FeeStatus"`,
      [applicationId, feePaise]
    );
    const { ApplicationNo, FeeStatus } = updated.rows[0];

    await client.query(
      `insert into "Admission"."ApplicationStatusHistory"
         ("ApplicationId", "FromStatus", "ToStatus", "ActorUserId", "ActorType")
       values ($1, 'Draft', 'Submitted', $2, 'Applicant')`,
      [applicationId, userId]
    );

    await client.query(
      `insert into "Common"."OutboxEvents" ("AggregateType", "AggregateId", "EventType", "Payload")
       values ('Application', $1, 'ApplicationSubmitted', $2)`,
      [String(applicationId), { applicationId, applicationNo: ApplicationNo, programmeId: app.ProgrammeId }]
    );

    await client.query('commit');
    return {
      submitted: true,
      applicationNo: ApplicationNo,
      feeStatus: FeeStatus,
      amountDueRupees: FeeStatus === 'Pending' ? feePaise / 100 : 0,
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}