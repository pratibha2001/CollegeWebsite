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

async function lockAssigned(client, applicationId, staffUserId) {
  const { rows } = await client.query(
    `select "Status", "AssignedReviewerId" from "Admission"."Applications"
     where "ApplicationId" = $1 for update`,
    [applicationId]
  );
  const app = rows[0];
  if (!app) throw httpError(404, 'Application not found');
  if (app.Status !== 'UnderReview') throw httpError(409, `Application is ${app.Status}, not UnderReview`);
  if (app.AssignedReviewerId !== staffUserId) throw httpError(403, 'This application is assigned to another reviewer');
}

export async function verifyDocument({ staffUserId, documentId, decision, reason }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const doc = await client.query(
      `select "ApplicationId" from "Admission"."Documents"
       where "DocumentId" = $1 and "DeletedAt" is null`,
      [documentId]
    );
    if (!doc.rows[0]) throw httpError(404, 'Document not found');
    await lockAssigned(client, doc.rows[0].ApplicationId, staffUserId);

    await client.query(
      `update "Admission"."Documents"
       set "VerificationStatus" = $2, "VerifiedBy" = $3, "VerifiedAt" = now(),
           "RejectionReason" = $4
       where "DocumentId" = $1`,
      [documentId, decision, staffUserId, decision === 'Rejected' ? reason : null]
    );
    await client.query('commit');
    return { documentId, verificationStatus: decision };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function completeReview({ staffUserId, applicationId, note }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await lockAssigned(client, applicationId, staffUserId);

    const docs = await client.query(
      `select "VerificationStatus", count(*)::int as n from "Admission"."Documents"
       where "ApplicationId" = $1 and "DeletedAt" is null
       group by "VerificationStatus"`,
      [applicationId]
    );
    const count = Object.fromEntries(docs.rows.map((r) => [r.VerificationStatus, r.n]));
    if (count.Pending) throw httpError(409, `${count.Pending} document(s) still need checking`);

    const toStatus = count.Rejected ? 'DocumentsPending' : 'Shortlisted';

    await client.query(
      `update "Admission"."Applications" a
       set "Status" = $2::varchar,
    "MeritScore" = case when $2::varchar = 'Shortlisted' then (
             select coalesce(
               max(ac."Percentage") filter (where ac."Level" = 'SeniorSecondary'),
               max(ac."Percentage") filter (where ac."Level" = 'Secondary'))
             from "Admission"."ApplicationAcademics" ac
             where ac."ApplicationId" = a."ApplicationId") else a."MeritScore" end,
           "UpdatedAt" = now(), "RowVersion" = "RowVersion" + 1
       where a."ApplicationId" = $1`,
      [applicationId, toStatus]
    );
    if (toStatus === 'Shortlisted') {
      await client.query(
        `update "Admission"."ApplicationAcademics" set "Verified" = true where "ApplicationId" = $1`,
        [applicationId]
      );
    }
    await client.query(
      `insert into "Admission"."ApplicationStatusHistory"
         ("ApplicationId", "FromStatus", "ToStatus", "ActorUserId", "ActorType", "Reason")
       values ($1, 'UnderReview', $2, $3, 'Staff', $4)`,
      [applicationId, toStatus, staffUserId, note ?? null]
    );
    await client.query('commit');
    return { applicationId, status: toStatus };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}