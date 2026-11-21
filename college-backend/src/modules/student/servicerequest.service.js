import pool from '../../config/db.js';
import { httpError } from '../../shared/errors.js';
import { getStudent } from './course.service.js';

const SLA_DAYS = { Bonafide: 3, Transcript: 7, IdCard: 7, Leave: 2, HostelChange: 5, Revaluation: 10, Other: 5 };

const MOVES = {
  start:    { from: ['Submitted'], to: 'InProgress' },
  complete: { from: ['InProgress'], to: 'Completed' },
  reject:   { from: ['Submitted', 'InProgress'], to: 'Rejected' },
};

export async function createRequest(userId, { type, details }) {
  if (!SLA_DAYS[type]) throw httpError(400, `type must be one of ${Object.keys(SLA_DAYS).join(', ')}`);
  if (details && details.length > 2000) throw httpError(400, 'details too long');

  const client = await pool.connect();
  try {
    await client.query('begin');
    const s = await getStudent(client, userId);
    await client.query(`select 1 from "Student"."Students" where "StudentId" = $1 for update`, [s.StudentId]);

    const { rows: open } = await client.query(
      `select "RequestNo" from "Student"."ServiceRequests"
        where "StudentId" = $1 and "RequestType" = $2 and "Status" in ('Submitted', 'InProgress')`,
      [s.StudentId, type]);
    if (open[0]) throw httpError(409, `You already have an open ${type} request (${open[0].RequestNo})`);

    const { rows: [{ id }] } = await client.query(
      `select nextval(pg_get_serial_sequence('"Student"."ServiceRequests"', 'ServiceRequestId'))::int as id`);
    const requestNo = `SR${new Date().getFullYear()}${String(id).padStart(6, '0')}`;

    const { rows: [r] } = await client.query(
      `insert into "Student"."ServiceRequests"
         ("ServiceRequestId","RequestNo","StudentId","RequestType","Details","DueAt")
       values ($1, $2, $3, $4, $5, now() + make_interval(days => $6))
       returning "RequestNo", "Status", "DueAt"`,
      [id, requestNo, s.StudentId, type, details ?? null, SLA_DAYS[type]]);
    await client.query('commit');
    return r;
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}

export async function listMyRequests(userId) {
  const s = await getStudent(pool, userId);
  const { rows } = await pool.query(
    `select "ServiceRequestId", "RequestNo", "RequestType", "Details", "Status", "DueAt", "ClosedAt", "CreatedAt"
       from "Student"."ServiceRequests" where "StudentId" = $1 order by "CreatedAt" desc`, [s.StudentId]);
  return rows;
}

export async function cancelRequest(userId, requestId) {
  const s = await getStudent(pool, userId);
  const { rowCount } = await pool.query(
    `update "Student"."ServiceRequests" set "Status" = 'Cancelled', "ClosedAt" = now()
      where "ServiceRequestId" = $1 and "StudentId" = $2 and "Status" = 'Submitted'`,
    [requestId, s.StudentId]);
  if (!rowCount) throw httpError(409, 'Only your own Submitted requests can be cancelled');
  return { cancelled: true };
}

export async function listQueue(status = 'Submitted') {
  const { rows } = await pool.query(
    `select r."ServiceRequestId", r."RequestNo", r."RequestType", r."Details", r."Status", r."DueAt",
            s."EnrolmentNo", u."FullName", (r."DueAt" < now()) as overdue
       from "Student"."ServiceRequests" r
       join "Student"."Students" s on s."StudentId" = r."StudentId"
       join "Common"."Users" u on u."UserId" = s."UserId"
      where r."Status" = $1 order by r."DueAt"`, [status]);
  return rows;
}

export async function actOnRequest({ staffUserId, requestId, action, note }) {
  const move = MOVES[action];
  if (!move) throw httpError(400, `action must be one of ${Object.keys(MOVES).join(', ')}`);
  if (action === 'reject' && !note?.trim()) throw httpError(400, 'note is required when rejecting');

  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows: [r] } = await client.query(
      `select "Status" from "Student"."ServiceRequests" where "ServiceRequestId" = $1 for update`, [requestId]);
    if (!r) throw httpError(404, 'Request not found');
    if (!move.from.includes(r.Status)) throw httpError(409, `Cannot ${action} a ${r.Status} request`);

    const { rows: [updated] } = await client.query(
      `update "Student"."ServiceRequests"
          set "Status" = $2,
              "AssignedTo" = coalesce("AssignedTo", $3),
              "ClosedAt" = case when $2::varchar in ('Completed', 'Rejected') then now() end,
              "Details" = case when $4::text is null then "Details"
                               else coalesce("Details" || E'\n', '') || '[' || $2::varchar || '] ' || $4::text end
        where "ServiceRequestId" = $1
        returning "RequestNo", "Status", "ClosedAt"`,
      [requestId, move.to, staffUserId, note?.trim() || null]);
    await client.query('commit');
    return updated;
  } catch (e) {
    await client.query('rollback'); throw e;
  } finally { client.release(); }
}