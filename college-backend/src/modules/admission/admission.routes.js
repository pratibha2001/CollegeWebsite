import { Router } from 'express';
import pool from '../../config/db.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { parsePersonal, parseAcademics } from './validation.js';
import { createDraft, listMine, savePersonal, saveAcademics } from './application.service.js';
import { requestGuardianConsent, confirmGuardianConsent } from './guardian.service.js';

import multer from 'multer';
import { uploadDocument } from './document.service.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

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

router.put(
  '/applications/:id/personal',
  authenticate,
  requirePermission('APPLICATION_CREATE_OWN'),
  async (req, res, next) => {
    try {
      const applicationId = Number(req.params.id);
      if (!Number.isInteger(applicationId)) {
        return res.status(400).json({ error: 'Invalid application id' });
      }
      const { value, errors } = parsePersonal(req.body);
      if (errors) return res.status(400).json({ errors });
      res.json(await savePersonal({ userId: req.user.id, applicationId, data: value }));
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/applications/:id/academics',
  authenticate,
  requirePermission('APPLICATION_CREATE_OWN'),
  async (req, res, next) => {
    try {
      const applicationId = Number(req.params.id);
      if (!Number.isInteger(applicationId)) {
        return res.status(400).json({ error: 'Invalid application id' });
      }
      const { value, errors } = parseAcademics(req.body);
      if (errors) return res.status(400).json({ errors });
      res.json(await saveAcademics({ userId: req.user.id, applicationId, records: value }));
    } catch (err) {
      next(err);
    }
  }
);


router.post(
  '/applications/:id/documents',
  authenticate,
  requirePermission('APPLICATION_CREATE_OWN'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      const applicationId = Number(req.params.id);
      if (!Number.isInteger(applicationId)) {
        return res.status(400).json({ error: 'Invalid application id' });
      }
      const result = await uploadDocument({
        userId: req.user.id, applicationId, typeCode: req.body.typeCode, file: req.file,
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/applications/:id/guardian-consent/request',
  authenticate,
  requirePermission('APPLICATION_CREATE_OWN'),
  async (req, res, next) => {
    try {
      const applicationId = Number(req.params.id);
      if (!Number.isInteger(applicationId)) return res.status(400).json({ error: 'Invalid application id' });
      res.json(await requestGuardianConsent({ userId: req.user.id, applicationId, ip: req.ip }));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/applications/:id/guardian-consent/verify',
  authenticate,
  requirePermission('APPLICATION_CREATE_OWN'),
  async (req, res, next) => {
    try {
      const applicationId = Number(req.params.id);
      if (!Number.isInteger(applicationId)) return res.status(400).json({ error: 'Invalid application id' });
      const code = String(req.body?.code ?? '');
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'A 6-digit code is required' });
      res.json(await confirmGuardianConsent({ userId: req.user.id, applicationId, code, ip: req.ip }));
    } catch (err) {
      next(err);
    }
  }
);

export default router;

