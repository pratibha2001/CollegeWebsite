import crypto from 'node:crypto';

export const hmac = (value) =>
  crypto.createHmac('sha256', process.env.OTP_SECRET).update(value).digest('hex');

export const generateOtp = () =>
  String(crypto.randomInt(0, 1000000)).padStart(6, '0');

export const safeEqual = (a, b) =>
  a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

