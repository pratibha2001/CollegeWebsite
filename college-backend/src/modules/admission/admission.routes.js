import { Router } from 'express';
import pool from '../../config/db.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { createDraft, listMine } from './application.service.js';

const router = Router();

router.get('/programmes', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `select p."ProgrammeId" as id, p."ProgrammeCode" as code, p."ProgrammeName" as name,
              d."DepartmentName" as department, p."Level" as level,
              p."DurationMonths" as "durationMonths", w."AcademicYear" as "academicYear",
              w."ApplicationFeePaise" / 100.0 as "applicationFeeRupees", w."ClosesAt" as "closesAt"
       from "Admission"."ApplicationWindows" w
       join "Academics"."Programmes" p on p."ProgrammeId" = w."ProgrammeId"
       join "Academics"."Departments" d on d."DepartmentId" = p."DepartmentId"
       where p."IsActive" and now() between w."OpensAt" and w."ClosesAt"
       order by p."ProgrammeName"`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/applications',
  authenticate,
  requirePermission('APPLICATION_CREATE_OWN'),
  async (req, res, next) => {
    try {
      const programmeId = Number(req.body.programmeId);
      const intakeMonth = req.body.intakeMonth === undefined ? 8 : Number(req.body.intakeMonth);
      if (!Number.isInteger(programmeId) || !Number.isInteger(intakeMonth) || intakeMonth < 1 || intakeMonth > 12) {
        return res.status(400).json({ error: 'programmeId and a valid intakeMonth (1-12) are required' });
      }
      const result = await createDraft({ userId: req.user.id, programmeId, intakeMonth });
      res.status(result.created ? 201 : 200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/applications/mine',
  authenticate,
  requirePermission('APPLICATION_CREATE_OWN'),
  async (req, res, next) => {
    try {
      res.json(await listMine(req.user.id));
    } catch (err) {
      next(err);
    }
  }
);

export default router;

