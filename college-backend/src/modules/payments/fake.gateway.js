import crypto from 'node:crypto';

export const PROVIDER = 'FakePay';

export function createProviderOrder() {
  return { providerOrderId: 'fp_order_' + crypto.randomBytes(8).toString('hex') };
}

export function sign(rawBody) {
  return crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
}

export function verifySignature(rawBody, signature) {
  if (!rawBody || typeof signature !== 'string') return false;
  const expected = Buffer.from(sign(rawBody));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}