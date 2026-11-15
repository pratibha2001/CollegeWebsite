import { Router } from "express";
import { authenticate, requirePermission } from "../../middleware/auth.js";
import { requestOtp, verifyOtp, normalize } from "./otp.service.js";
import { findOrCreateUser, getRoleCodes } from "./user.service.js";
import { signToken } from "../../shared/jwt.js";


const router = Router();

router.post("/otp/request", async (req, res, next) => {
  try {
    const { subjectType, subject } = req.body;
    if (!["Email", "Mobile"].includes(subjectType) || !subject) {
      return res
        .status(400)
        .json({
          error: "subjectType (Email or Mobile) and subject are required",
        });
    }
    const result = await requestOtp({
      subjectType,
      subject,
      purpose: "Login",
      ip: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/otp/verify", async (req, res, next) => {
  try {
    const { subjectType, subject, purpose, code } = req.body;
    const ok = await verifyOtp({ subjectType, subject, purpose, code });
    if (!ok) return res.status(400).json({ error: "Invalid or expired code" });

    const user = await findOrCreateUser({ subjectType, subject });
    const roles = await getRoleCodes(user.UserId);
    const token = signToken(user.UserId, roles);

    res.json({
      token,
      user: { id: user.UserId, fullName: user.FullName, roles },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authenticate, (req, res) => {
  res.json(req.user);
});

router.post('/merit-lists', authenticate, requirePermission('MERITLIST_APPROVE'), async (req, res, next) => {
  try {
    const programmeId = Number(req.body?.programmeId);
    const waitlistSize = Number(req.body?.waitlistSize ?? 10);
    if (!Number.isInteger(programmeId) || !Number.isInteger(waitlistSize) || waitlistSize < 0) {
      return res.status(400).json({ error: 'programmeId and a whole-number waitlistSize are required' });
    }
    res.status(201).json(await generateMeritList({ staffUserId: req.user.id, programmeId, waitlistSize }));
  } catch (err) {
    next(err);
  }
});

router.get('/merit-lists/:id', authenticate, requirePermission('APPLICATION_REVIEW'), async (req, res, next) => {
  try {
    const meritListId = Number(req.params.id);
    if (!Number.isInteger(meritListId)) return res.status(400).json({ error: 'Invalid merit list id' });
    res.json(await getMeritList(meritListId));
  } catch (err) {
    next(err);
  }
});

router.post('/merit-lists/:id/publish', authenticate, requirePermission('MERITLIST_APPROVE'), async (req, res, next) => {
  try {
    const meritListId = Number(req.params.id);
    if (!Number.isInteger(meritListId)) return res.status(400).json({ error: 'Invalid merit list id' });
    res.json(await publishMeritList({ staffUserId: req.user.id, meritListId }));
  } catch (err) {
    next(err);
  }
});



export default router;
