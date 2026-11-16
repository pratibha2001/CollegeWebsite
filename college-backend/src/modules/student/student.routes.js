import { Router } from 'express';
import pool from '../../config/db.js';
import { authenticate } from '../../middleware/auth.js';
import { listSemesterCourses, registerCourse } from './course.service.js';

const router = Router();

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `select s."EnrolmentNo" as "enrolmentNo", s."Status" as status, s."AdmissionDate" as "admissionDate",
              p."ProgrammeName" as programme, b."BatchName" as batch
       from "Student"."Students" s
       join "Academics"."Programmes" p on p."ProgrammeId" = s."ProgrammeId"
       join "Academics"."Batches" b on b."BatchId" = s."BatchId"
       where s."UserId" = $1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No student record' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get('/courses', authenticate, async (req, res, next) => {
  try { res.json(await listSemesterCourses(req.user.id)); } catch (e) { next(e); }
});

router.post('/courses/:semesterCourseId/register', authenticate, async (req, res, next) => {
  try {
    res.status(201).json(await registerCourse(req.user.id, Number(req.params.semesterCourseId)));
  } catch (e) { next(e); }
});

export default router;