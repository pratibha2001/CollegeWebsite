import crypto from 'node:crypto';
import pool from '../../config/db.js';
import { getApplicationFee, markApplicationFeePaid } from '../admission/application.service.js';
import { PROVIDER, createProviderOrder, verifySignature } from './fake.gateway.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });

const toOrder = (r) => ({
  orderNo: r.OrderNo,
  providerOrderId: r.ProviderOrderId,
  amountRupees: Number(r.AmountPaise) / 100,
  expiresAt: r.ExpiresAt,
});

export async function createApplicationFeeOrder({ userId, applicationId }) {
  const fee = await getApplicationFee(pool, { userId, applicationId });
  if (fee.status === 'Draft') throw httpError(409, 'Submit the application before paying');
  if (fee.feeStatus !== 'Pending') throw httpError(409, `No fee due (fee status: ${fee.feeStatus})`);

  // reuse an open order, so a double click doesn't create two
  const open = await pool.query(
    `select "OrderNo", "ProviderOrderId", "AmountPaise", "ExpiresAt" from "Payments"."PaymentOrders"
     where "PayerUserId" = $1 and "Purpose" = 'ApplicationFee' and "ReferenceId" = $2
       and "Status" in ('Created', 'Pending') and "ExpiresAt" > now()
     order by "CreatedAt" desc limit 1`,
    [userId, applicationId]
  );
  if (open.rows[0]) return toOrder(open.rows[0]);

  const orderNo = 'ORD' + Date.now() + crypto.randomInt(100, 1000);
  const { providerOrderId } = createProviderOrder();
  const { rows } = await pool.query(
    `insert into "Payments"."PaymentOrders"
       ("OrderNo", "PayerUserId", "Purpose", "ReferenceType", "ReferenceId", "AmountPaise",
        "Provider", "ProviderOrderId", "IdempotencyKey", "ExpiresAt", "Status")
     values ($1, $2, 'ApplicationFee', 'Application', $3, $4, $5, $6, $1, now() + interval '30 minutes', 'Pending')
     returning "OrderNo", "ProviderOrderId", "AmountPaise", "ExpiresAt"`,
    [orderNo, userId, applicationId, fee.feePaise, PROVIDER, providerOrderId]
  );
  return toOrder(rows[0]);
}

export async function handleWebhook({ rawBody, signature, event }) {
  const valid = verifySignature(rawBody, signature);
  const client = await pool.connect();
  try {
    await client.query('begin');

    // store every event; the unique EventId makes a repeated delivery a no-op
    const saved = await client.query(
      `insert into "Payments"."PaymentWebhookEvents"
         ("Provider", "EventId", "EventType", "SignatureValid", "Payload", "Status")
       values ($1, $2, $3, $4, $5, $6)
       on conflict ("Provider", "EventId") do nothing
       returning "PaymentWebhookEventId"`,
      [PROVIDER, String(event?.id ?? `missing-${crypto.randomUUID()}`), String(event?.type ?? 'unknown'),
       valid, event ?? {}, valid ? 'Received' : 'Ignored']
    );
    if (!valid) {
      await client.query('commit');
      return { ok: false };
    }
    if (saved.rows.length === 0) {
      await client.query('rollback');
      return { ok: true, outcome: 'Duplicate' };
    }
    const eventRowId = saved.rows[0].PaymentWebhookEventId;

    let outcome = 'Processed';
    let error = null;
    if (event.type !== 'payment.captured') {
      outcome = 'Ignored';
    } else {
      const p = event.data ?? {};
      const found = await client.query(
        `select "PaymentOrderId", "Status", "AmountPaise", "Purpose", "ReferenceId"
         from "Payments"."PaymentOrders" where "Provider" = $1 and "ProviderOrderId" = $2
         for update`,
        [PROVIDER, p.providerOrderId]
      );
      const order = found.rows[0];
      if (!order) { outcome = 'Failed'; error = 'Unknown order'; }
      else if (Number(order.AmountPaise) !== Number(p.amountPaise)) { outcome = 'Failed'; error = 'Amount mismatch'; }
      else if (order.Status === 'Paid') { outcome = 'Ignored'; error = 'Already paid'; }
      else {
        await client.query(
          `insert into "Payments"."PaymentAttempts"
             ("PaymentOrderId", "ProviderPaymentId", "Method", "Status", "AmountPaise", "RawResponse", "CapturedAt")
           values ($1, $2, $3, 'Captured', $4, $5, now())
           on conflict ("ProviderPaymentId") do nothing`,
          [order.PaymentOrderId, p.providerPaymentId, p.method ?? null, p.amountPaise, event]
        );
        await client.query(
          `update "Payments"."PaymentOrders"
           set "Status" = 'Paid', "PaidAt" = now(),
               "ReceiptNo" = 'RCPT' || lpad("PaymentOrderId"::text, 8, '0'),
               "UpdatedAt" = now(), "RowVersion" = "RowVersion" + 1
           where "PaymentOrderId" = $1`,
          [order.PaymentOrderId]
        );
        if (order.Purpose === 'ApplicationFee') await markApplicationFeePaid(client, order.ReferenceId);
      }
    }

    await client.query(
      `update "Payments"."PaymentWebhookEvents"
       set "Status" = $2, "Error" = $3, "ProcessedAt" = now()
       where "PaymentWebhookEventId" = $1`,
      [eventRowId, outcome, error]
    );
    await client.query('commit');
    return { ok: true, outcome, error };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}