export async function handleApplicationAccepted(client, payload) {
  const { applicationId, userId, programmeId, academicYear } = payload;
  const startYear = Number(String(academicYear).slice(0, 4));

  const prog = await client.query(
    `select "ProgrammeCode", "DurationMonths" from "Academics"."Programmes" where "ProgrammeId" = $1`,
    [programmeId]
  );
  if (!prog.rows[0]) throw new Error(`Programme ${programmeId} not found`);
  const { ProgrammeCode, DurationMonths } = prog.rows[0];
  const endYear = startYear + Math.ceil(DurationMonths / 12);
  const batchName = `${startYear}-${endYear}`;

  await client.query(
    `insert into "Academics"."Batches" ("ProgrammeId", "BatchName", "StartYear", "EndYear")
     values ($1, $2, $3, $4)
     on conflict ("ProgrammeId", "BatchName") do nothing`,
    [programmeId, batchName, startYear, endYear]
  );
  const batch = await client.query(
    `select "BatchId" from "Academics"."Batches" where "ProgrammeId" = $1 and "BatchName" = $2`,
    [programmeId, batchName]
  );

  // e.g. BTECHCSE2026000001
  const enrolmentNo =
    ProgrammeCode.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) + startYear + String(applicationId).padStart(6, '0');

  const created = await client.query(
    `insert into "Student"."Students" ("UserId", "ApplicationId", "EnrolmentNo", "ProgrammeId", "BatchId")
     values ($1, $2, $3, $4, $5)
     on conflict do nothing
     returning "StudentId"`,
    [userId, applicationId, enrolmentNo, programmeId, batch.rows[0].BatchId]
  );

  if (created.rows.length > 0) {
    await client.query(
      `update "Common"."Users" set "UserType" = 'Student', "UpdatedAt" = now() where "UserId" = $1`,
      [userId]
    );
  }
}