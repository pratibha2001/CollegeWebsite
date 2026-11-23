import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { getMyProfile, activateProfile } from './alumni.service.js';

const router = Router();

router.get('/profile', authenticate, requirePermission('ALUMNI_SELF'), async (req, res, next) => {
  try { res.json(await getMyProfile(req.user.id)); } catch (e) { next(e); }
});

router.post('/profile/activate', authenticate, requirePermission('ALUMNI_SELF'), async (req, res, next) => {
  try {
    const { directoryOptIn, mentorshipOptIn, consent } = req.body ?? {};
    res.status(201).json(await activateProfile(req.user.id, { directoryOptIn, mentorshipOptIn, consent, ip: req.ip }));
  } catch (e) { next(e); }
});

export default router;