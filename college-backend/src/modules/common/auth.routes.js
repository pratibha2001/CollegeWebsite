import { Router } from 'express';
import { requestOtp, verifyOtp } from './otp.service.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';

const router = Router();

router.post('/otp/request', async (req, res, next) => {
  try {
    const { subjectType, subject } = req.body;
    if (!['Email', 'Mobile'].includes(subjectType) || !subject) {
      return res.status(400).json({ error: 'subjectType (Email or Mobile) and subject are required' });
    }
    const result = await requestOtp({ subjectType, subject, purpose: 'Login', ip: req.ip });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/otp/verify', async (req, res, next) => {
  try {
    const { subjectType, subject, code } = req.body;
    if (!['Email', 'Mobile'].includes(subjectType) || !subject || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'subjectType, subject and a 6-digit code are required' });
    }
    await verifyOtp({ subjectType, subject, purpose: 'Login', code });
    res.json({ verified: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});

// temporary, to test permissions. Delete later.
router.get('/test-review', authenticate, requirePermission('APPLICATION_REVIEW'), (req, res) => {
  res.json({ allowed: true });
});

export default router;