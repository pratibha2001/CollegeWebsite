import pool from '../config/db.js';
import { handleApplicationAccepted } from '../modules/student/student.events.js';

const handlers = {
  ApplicationAccepted: handleApplicationAccepted,
};

async function processOne() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `select "OutboxEventId", "EventType", "Payload" from "Common"."OutboxEvents"
       where "PublishedAt" is null
       order by "OutboxEventId"
       limit 1
       for update skip locked`
    );
    if (rows.length === 0) {
      await client.query('rollback');
      return false;
    }
    const event = rows[0];
    const handler = Object.hasOwn(handlers, event.EventType) ? handlers[event.EventType] : null;
    if (handler) await handler(client, event.Payload);

    await client.query(
      `update "Common"."OutboxEvents" set "PublishedAt" = now() where "OutboxEventId" = $1`,
      [event.OutboxEventId]
    );
    await client.query('commit');
    console.log(`[outbox] #${event.OutboxEventId} ${event.EventType}: ${handler ? 'handled' : 'no handler, marked done'}`);
    return true;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export function startOutboxWorker(intervalMs = 5000) {
  let running = false;
  setInterval(async () => {
    if (running) return; // don't overlap with a slow previous run
    running = true;
    try {
      for (let i = 0; i < 20 && (await processOne()); i++);
    } catch (err) {
      console.error('[outbox] failed, will retry next tick:', err.message);
    } finally {
      running = false;
    }
  }, intervalMs);
}