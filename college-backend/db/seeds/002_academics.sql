INSERT INTO "Academics"."Departments" ("DepartmentCode", "DepartmentName")
VALUES ('CSE', 'Computer Science and Engineering')
ON CONFLICT ("DepartmentCode") DO NOTHING;

INSERT INTO "Academics"."Programmes"
  ("ProgrammeCode", "ProgrammeName", "DepartmentId", "Level", "Mode", "DurationMonths", "TotalSeats")
SELECT 'BTECH-CSE', 'B.Tech Computer Science', d."DepartmentId", 'Undergraduate', 'FullTime', 48, 120
FROM "Academics"."Departments" d WHERE d."DepartmentCode" = 'CSE'
ON CONFLICT ("ProgrammeCode") DO NOTHING;

INSERT INTO "Admission"."ApplicationWindows"
  ("ProgrammeId", "AcademicYear", "OpensAt", "ClosesAt", "ApplicationFeePaise", "LateFeePaise")
SELECT p."ProgrammeId", '2026-2027', now() - interval '1 day', now() + interval '60 days', 1000 * 100, 500 * 100
FROM "Academics"."Programmes" p WHERE p."ProgrammeCode" = 'BTECH-CSE'
ON CONFLICT ("ProgrammeId", "AcademicYear") DO NOTHING;

INSERT INTO "Admission"."FormDefinitions" ("FormKey", "Version", "SchemaJson", "Status", "PublishedAt")
VALUES ('undergraduate-application', 1,
  '{"steps":["personal","guardian","academics","exam","documents","declaration"]}',
  'Published', now())
ON CONFLICT ("FormKey", "Version") DO NOTHING;