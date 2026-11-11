import pool from '../../config/db.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });

export async function listQueue({ status }) {
  const { rows } = await pool.query(
    `select a."ApplicationId" as id, a."ApplicationNo" as "applicationNo", u."FullName" as "applicantName",
            pr."ProgrammeName" as programme, a."Status" as status, a."SubmittedAt" as "submittedAt",
            ac."Percentage" as "class10Percentage", a."AssignedReviewerId" as "assignedReviewerId"
     from "Admission"."Applications" a
     join "Common"."Users" u on u."UserId" = a."ApplicantUserId"
     join "Academics"."Programmes" pr on pr."ProgrammeId" = a."ProgrammeId"
     left join "Admission"."ApplicationAcademics" ac
       on ac."ApplicationId" = a."ApplicationId" and ac."Level" = 'Secondary'
     where a."Status" = $1 and a."FeeStatus" in ('Paid', 'Waived', 'NotRequired')
     order by a."SubmittedAt"
     limit 50`,
    [status]
  );
  return rows;
}

export async function getApplicationDetail(applicationId) {
  const app = await pool.query(
    `select a.*, u."FullName" as "applicantName", u."Mobile", u."Email"
     from "Admission"."Applications" a
     join "Common"."Users" u on u."UserId" = a."ApplicantUserId"
     where a."ApplicationId" = $1 and a."Status" <> 'Draft'`,
    [applicationId]
  );
  if (!app.rows[0]) throw httpError(404, 'Application not found');

  const [personal, academics, documents, history] = await Promise.all([
    pool.query(`select * from "Admission"."ApplicationPersonal" where "ApplicationId" = $1`, [applicationId]),
    pool.query(`select * from "Admission"."ApplicationAcademics" where "ApplicationId" = $1 order by "Level"`, [applicationId]),
    pool.query(
      `select d."DocumentId", t."TypeCode", d."OriginalFileName", d."MimeType", d."SizeBytes", d."VerificationStatus"
       from "Admission"."Documents" d
       join "Admission"."DocumentTypes" t on t."DocumentTypeId" = d."DocumentTypeId"
       where d."ApplicationId" = $1 and d."DeletedAt" is null`,
      [applicationId]
    ),
    pool.query(
      `select "FromStatus", "ToStatus", "ActorType", "Reason", "CreatedAt"
       from "Admission"."ApplicationStatusHistory" where "ApplicationId" = $1 order by "CreatedAt"`,
      [applicationId]
    ),
  ]);

  return {
    application: app.rows[0],
    personal: personal.rows[0] ?? null,
    academics: academics.rows,
    documents: documents.rows,
    history: history.rows,
  };
}

export async function startReview({ staffUserId, applicationId }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `select "Status", "FeeStatus", "AssignedReviewerId" from "Admission"."Applications"
       where "ApplicationId" = $1 for update`,
      [applicationId]
    );
    const app = rows[0];
    if (!app || app.Status === 'Draft') throw httpError(404, 'Application not found');
    if (app.Status === 'UnderReview' && app.AssignedReviewerId === staffUserId) {
      await client.query('commit');
      return { applicationId, status: 'UnderReview', alreadyYours: true };
    }
    if (app.Status !== 'Submitted') throw httpError(409, `Cannot start review from status ${app.Status}`);
    if (!['Paid', 'Waived', 'NotRequired'].includes(app.FeeStatus)) throw httpError(409, 'Fee not paid yet');

    await client.query(
      `update "Admission"."Applications"
       set "Status" = 'UnderReview', "AssignedReviewerId" = $2, "UpdatedAt" = now(), "RowVersion" = "RowVersion" + 1
       where "ApplicationId" = $1`,
      [applicationId, staffUserId]
    );
    await client.query(
      `insert into "Admission"."ApplicationStatusHistory"
         ("ApplicationId", "FromStatus", "ToStatus", "ActorUserId", "ActorType")
       values ($1, 'Submitted', 'UnderReview', $2, 'Staff')`,
      [applicationId, staffUserId]
    );
    await client.query('commit');
    return { applicationId, status: 'UnderReview', assignedTo: staffUserId };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}