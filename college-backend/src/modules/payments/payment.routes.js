import crypto from 'node:crypto';
import { Router } from 'express';
import pool from '../../config/db.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { createApplicationFeeOrder, handleWebhook } from './payment.service.js';
import { sign } from './fake.gateway.js';

const router = Router();

router.post('/application-fee', authenticate, requirePermission('APPLICATION_CREATE_OWN'), async (req, res, next) => {
  try {
    const applicationId = Number(req.body?.applicationId);
    if (!Number.isInteger(applicationId)) return res.status(400).json({ error: 'applicationId is required' });
    res.status(201).json(await createApplicationFeeOrder({ userId: req.user.id, applicationId }));
  } catch (err) {
    next(err);
  }
});

// called by the gateway, so no login; the signature is the proof
router.post('/webhook', async (req, res, next) => {
  try {
    const result = await handleWebhook({
      rawBody: req.rawBody, signature: req.get('x-fakepay-signature'), event: req.body,
    });
    if (!result.ok) return res.status(400).json({ error: 'Invalid signature' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// dev only: pretend to be the gateway and send a correctly signed "paid" webhook
if (process.env.NODE_ENV !== 'production') {
  router.post('/dev/simulate-payment', authenticate, async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `select "ProviderOrderId", "AmountPaise" from "Payments"."PaymentOrders"
         where "OrderNo" = $1 and "PayerUserId" = $2`,
        [req.body?.orderNo, req.user.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
      const body = JSON.stringify({
        id: 'evt_' + crypto.randomUUID(),
        type: 'payment.captured',
        data: {
          providerOrderId: rows[0].ProviderOrderId,
          providerPaymentId: 'fp_pay_' + crypto.randomUUID(),
          amountPaise: Number(rows[0].AmountPaise),
          method: 'Upi',
        },
      });
      const r = await fetch(`http://localhost:${process.env.PORT || 4000}/api/payments/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-fakepay-signature': sign(body) },
        body,
      });
      res.status(r.status).json(await r.json());
    } catch (err) {
      next(err);
    }
  });
}

export default router;