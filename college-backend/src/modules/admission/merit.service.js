import crypto from 'node:crypto';
import pool from '../../config/db.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });

export async function generateMeritList({ staffUserId, programmeId, waitlistSize }) {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const prog = await client.query(
      `select p."TotalSeats", w."AcademicYear"
       from "Academics"."Programmes" p
       join "Admission"."ApplicationWindows" w on w."ProgrammeId" = p."ProgrammeId"
       where p."ProgrammeId" = $1
       order by w."OpensAt" desc limit 1`,
      [programmeId]
    );
    if (!prog.rows[0]) throw httpError(404, 'Programme or admission window not found');
    const { TotalSeats, AcademicYear } = prog.rows[0];

    // lock existing lists for this programme-year so two people can't generate at once
    const lists = await client.query(
      `select "RoundNo", "Status" from "Admission"."MeritLists"
       where "ProgrammeId" = $1 and "AcademicYear" = $2 for update`,
      [programmeId, AcademicYear]
    );
    if (lists.rows.some((l) => l.Status !== 'Published')) {
      throw httpError(409, 'An unpublished merit list already exists for this programme');
    }
    const roundNo = lists.rows.reduce((max, l) => Math.max(max, l.RoundNo), 0) + 1;

    const taken = await client.query(
      `select count(*)::int as n from "Admission"."Applications"
       where "ProgrammeId" = $1 and "AcademicYear" = $2 and "Status" in ('Offered', 'Accepted')`,
      [programmeId, AcademicYear]
    );
    const seats = Math.max(TotalSeats - taken.rows[0].n, 0);
    const ruleSet = { orderBy: ['MeritScore desc', 'SubmittedAt asc'], seats, waitlistSize };

    const list = await client.query(
      `insert into "Admission"."MeritLists" ("ProgrammeId", "AcademicYear", "RoundNo", "RuleSet", "GeneratedBy")
       values ($1, $2, $3, $4, $5) returning "MeritListId"`,
      [programmeId, AcademicYear, roundNo, ruleSet, staffUserId]
    );
    const meritListId = list.rows[0].MeritListId;

    const entries = await client.query(
      `with ranked as (
         select a."ApplicationId", a."MeritScore",
                row_number() over (order by a."MeritScore" desc, a."SubmittedAt") as overall,
                row_number() over (partition by p."Category" order by a."MeritScore" desc, a."SubmittedAt") as in_category
         from "Admission"."Applications" a
         join "Admission"."ApplicationPersonal" p on p."ApplicationId" = a."ApplicationId"
         where a."ProgrammeId" = $2 and a."AcademicYear" = $3
           and a."Status" = 'Shortlisted' and a."MeritScore" is not null
       )
       insert into "Admission"."MeritListEntries"
         ("MeritListId", "ApplicationId", "MeritRank", "CategoryRank", "Score", "Outcome")
       select $1, "ApplicationId", overall, in_category, "MeritScore",
              case when overall <= $4::int then 'Selected'
                   when overall <= $4::int + $5::int then 'Waitlisted'
                   else 'NotSelected' end
       from ranked
       returning "ApplicationId", "MeritRank", "Outcome"`,
      [meritListId, programmeId, AcademicYear, seats, waitlistSize]
    );

    await client.query('commit');
    return { meritListId, roundNo, seats, entries: entries.rows.length };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function getMeritList(meritListId) {
  const list = await pool.query(`select * from "Admission"."MeritLists" where "MeritListId" = $1`, [meritListId]);
  if (!list.rows[0]) throw httpError(404, 'Merit list not found');
  const entries = await pool.query(
    `select e."MeritRank", e."CategoryRank", e."Score", e."Outcome",
            a."ApplicationNo", u."FullName", p."Category"
     from "Admission"."MeritListEntries" e
     join "Admission"."Applications" a on a."ApplicationId" = e."ApplicationId"
     join "Common"."Users" u on u."UserId" = a."ApplicantUserId"
     join "Admission"."ApplicationPersonal" p on p."ApplicationId" = e."ApplicationId"
     where e."MeritListId" = $1
     order by e."MeritRank"`,
    [meritListId]
  );
  return { list: list.rows[0], entries: entries.rows };
}

export async function publishMeritList({ staffUserId, meritListId }) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const found = await client.query(
      `select "Status", "ProgrammeId", "RoundNo" from "Admission"."MeritLists"
       where "MeritListId" = $1 for update`,
      [meritListId]
    );
    const list = found.rows[0];
    if (!list) throw httpError(404, 'Merit list not found');
    if (list.Status === 'Published') throw httpError(409, 'Already published; generate a new round instead');

    const entries = await client.query(
      `select "ApplicationId", "MeritRank", "Score", "Outcome" from "Admission"."MeritListEntries"
       where "MeritListId" = $1 order by "MeritRank"`,
      [meritListId]
    );
    const snapshotHash = crypto.createHash('sha256').update(JSON.stringify(entries.rows)).digest('hex');

    await client.query(
      `update "Admission"."MeritLists"
       set "Status" = 'Published', "ApprovedBy" = $2, "PublishedAt" = now(), "SnapshotHash" = $3
       where "MeritListId" = $1`,
      [meritListId, staffUserId, snapshotHash]
    );

    // record history first, while the applications still show 'Shortlisted'
    await client.query(
      `insert into "Admission"."ApplicationStatusHistory"
         ("ApplicationId", "FromStatus", "ToStatus", "ActorUserId", "ActorType", "Reason")
       select e."ApplicationId", 'Shortlisted',
              case e."Outcome" when 'Selected' then 'Offered' else 'Waitlisted' end,
              $2, 'Staff', 'Merit list round ' || $3::text
       from "Admission"."MeritListEntries" e
       join "Admission"."Applications" a on a."ApplicationId" = e."ApplicationId"
       where e."MeritListId" = $1 and e."Outcome" in ('Selected', 'Waitlisted') and a."Status" = 'Shortlisted'`,
      [meritListId, staffUserId, list.RoundNo]
    );

    const updated = await client.query(
      `update "Admission"."Applications" a
       set "MeritRank" = e."MeritRank",
           "Status" = case e."Outcome" when 'Selected' then 'Offered' when 'Waitlisted' then 'Waitlisted' else a."Status" end,
           "Decision" = case e."Outcome" when 'Selected' then 'Offered' when 'Waitlisted' then 'Waitlisted' else a."Decision" end,
           "DecisionAt" = now(), "DecisionBy" = $2,
           "UpdatedAt" = now(), "RowVersion" = a."RowVersion" + 1
       from "Admission"."MeritListEntries" e
       where e."MeritListId" = $1 and e."ApplicationId" = a."ApplicationId" and a."Status" = 'Shortlisted'
       returning a."ApplicationId", a."Status"`,
      [meritListId, staffUserId]
    );

    await client.query(
      `insert into "Common"."OutboxEvents" ("AggregateType", "AggregateId", "EventType", "Payload")
       values ('MeritList', $1, 'MeritListPublished', $2)`,
      [String(meritListId), { meritListId, programmeId: list.ProgrammeId, roundNo: list.RoundNo, snapshotHash }]
    );

    await client.query('commit');
    return { meritListId, status: 'Published', snapshotHash, applicationsUpdated: updated.rows.length };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}