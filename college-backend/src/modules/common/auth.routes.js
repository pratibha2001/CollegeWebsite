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





export default router;
