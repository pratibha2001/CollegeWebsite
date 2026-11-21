import { Router } from 'express';
import pool from '../../config/db.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { getRoster, markAttendance ,myAttendance} from './attendance.service.js';
import { listSemesterCourses, registerCourse } from './course.service.js';
import { createAssessment, enterMarks, publishAssessment, myResults } from './marks.service.js';
import { generateGradeSheets, publishGradeSheets, myGradeSheets } from './gradesheet.service.js';
import { createRequest, listMyRequests, cancelRequest, listQueue as srQueue, actOnRequest } from './servicerequest.service.js';
import { clearArea, issueDegree, verifyDegree, myClearance } from './graduation.service.js';


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

router.get('/faculty/courses/:semesterCourseId/roster', authenticate, requirePermission('ATTENDANCE_MARK'),
  async (req, res, next) => {
    try { res.json(await getRoster(req.user.id, Number(req.params.semesterCourseId))); } catch (e) { next(e); }
  });

router.post('/faculty/courses/:semesterCourseId/attendance', authenticate, requirePermission('ATTENDANCE_MARK'),
  async (req, res, next) => {
    try {
      const { sessionDate, startTime, records } = req.body;
      res.status(201).json(await markAttendance({
        facultyUserId: req.user.id, semesterCourseId: Number(req.params.semesterCourseId),
        sessionDate, startTime, records,
      }));
    } catch (e) { next(e); }
  });

  router.get('/attendance', authenticate, async (req, res, next) => {
  try { res.json(await myAttendance(req.user.id)); } catch (e) { next(e); }
});

router.post('/faculty/courses/:semesterCourseId/assessments', authenticate, requirePermission('MARKS_ENTER'),
  async (req, res, next) => {
    try {
      const { name, type, maxMarks, weightage } = req.body;
      res.status(201).json(await createAssessment({
        facultyUserId: req.user.id, semesterCourseId: Number(req.params.semesterCourseId),
        name, type, maxMarks, weightage,
      }));
    } catch (e) { next(e); }
  });

router.post('/faculty/assessments/:assessmentId/marks', authenticate, requirePermission('MARKS_ENTER'),
  async (req, res, next) => {
    try {
      const { entries, reason } = req.body;
      res.json(await enterMarks({
        facultyUserId: req.user.id, assessmentId: Number(req.params.assessmentId), entries, reason,
      }));
    } catch (e) { next(e); }
  });

  router.post('/faculty/assessments/:assessmentId/publish', authenticate, requirePermission('MARKS_ENTER'),
  async (req, res, next) => {
    try {
      res.json(await publishAssessment({ facultyUserId: req.user.id, assessmentId: Number(req.params.assessmentId) }));
    } catch (e) { next(e); }
  });

router.get('/results', authenticate, async (req, res, next) => {
  try { res.json(await myResults(req.user.id)); } catch (e) { next(e); }
});

router.post('/exams/semesters/:semesterId/grade-sheets', authenticate, requirePermission('RESULTS_PUBLISH'),
  async (req, res, next) => {
    try { res.status(201).json(await generateGradeSheets(Number(req.params.semesterId))); } catch (e) { next(e); }
  });

router.post('/exams/semesters/:semesterId/grade-sheets/publish', authenticate, requirePermission('RESULTS_PUBLISH'),
  async (req, res, next) => {
    try {
      res.json(await publishGradeSheets({ semesterId: Number(req.params.semesterId), reason: req.body?.reason }));
    } catch (e) { next(e); }
  });

router.get('/grade-sheets', authenticate, async (req, res, next) => {
  try { res.json(await myGradeSheets(req.user.id)); } catch (e) { next(e); }
});

router.post('/service-requests', authenticate, async (req, res, next) => {
  try { res.status(201).json(await createRequest(req.user.id, req.body ?? {})); } catch (e) { next(e); }
});
router.get('/service-requests', authenticate, async (req, res, next) => {
  try { res.json(await listMyRequests(req.user.id)); } catch (e) { next(e); }
});
router.post('/service-requests/:id/cancel', authenticate, async (req, res, next) => {
  try { res.json(await cancelRequest(req.user.id, Number(req.params.id))); } catch (e) { next(e); }
});

router.get('/staff/service-requests', authenticate, requirePermission('SERVICE_REQUEST_HANDLE'), async (req, res, next) => {
  try { res.json(await srQueue(req.query.status ?? 'Submitted')); } catch (e) { next(e); }
});
router.post('/staff/service-requests/:id/action', authenticate, requirePermission('SERVICE_REQUEST_HANDLE'),
  async (req, res, next) => {
    try {
      res.json(await actOnRequest({ staffUserId: req.user.id, requestId: Number(req.params.id),
        action: req.body?.action, note: req.body?.note }));
    } catch (e) { next(e); }
  });

 
router.get('/graduation', authenticate, async (req, res, next) => {
  try { res.json(await myClearance(req.user.id)); } catch (e) { next(e); }
});

router.post('/staff/graduation/:studentId/clear', authenticate, requirePermission('GRADUATION_CLEAR'),
  async (req, res, next) => {
    try { res.json(await clearArea({ studentId: Number(req.params.studentId), area: req.body?.area })); }
    catch (e) { next(e); }
  });

router.post('/staff/graduation/:studentId/issue-degree', authenticate, requirePermission('DEGREE_ISSUE'),
  async (req, res, next) => {
    try { res.json(await issueDegree({ studentId: Number(req.params.studentId) })); } catch (e) { next(e); }
  });

// no login on purpose
router.get('/verify-degree/:code', async (req, res, next) => {
  try { res.json(await verifyDegree(req.params.code)); } catch (e) { next(e); }
});

export default router;