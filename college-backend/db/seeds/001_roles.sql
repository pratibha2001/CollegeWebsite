INSERT INTO "Common"."Roles" ("RoleCode", "RoleName", "Description") VALUES
  ('APPLICANT',          'Applicant',          'Applies for a programme'),
  ('ADMISSIONS_OFFICER', 'Admissions Officer', 'Reviews applications and documents'),
  ('HEAD_OF_ADMISSIONS', 'Head of Admissions', 'Approves merit lists and decisions'),
  ('FINANCE_OFFICER',    'Finance Officer',    'Reconciles payments and refunds'),
  ('REGISTRAR',          'Registrar',          'Owns academic structure and records'),
  ('ADMIN',              'Administrator',      'Manages users and roles')
ON CONFLICT ("RoleCode") DO NOTHING;

INSERT INTO "Common"."Permissions" ("PermissionCode", "Description") VALUES
  ('APPLICATION_CREATE_OWN', 'Create and edit own application'),
  ('APPLICATION_REVIEW',     'Review applications and documents'),
  ('APPLICATION_DECIDE',     'Offer, waitlist or reject applications'),
  ('MERITLIST_APPROVE',      'Approve and publish merit lists'),
  ('PAYMENT_VIEW',           'View payments and reconciliation')
ON CONFLICT ("PermissionCode") DO NOTHING;

INSERT INTO "Common"."RolePermissions" ("RoleId", "PermissionId")
SELECT r."RoleId", p."PermissionId"
FROM "Common"."Roles" r
JOIN "Common"."Permissions" p
  ON (r."RoleCode", p."PermissionCode") IN (
    ('APPLICANT',          'APPLICATION_CREATE_OWN'),
    ('ADMISSIONS_OFFICER', 'APPLICATION_REVIEW'),
    ('HEAD_OF_ADMISSIONS', 'APPLICATION_REVIEW'),
    ('HEAD_OF_ADMISSIONS', 'APPLICATION_DECIDE'),
    ('HEAD_OF_ADMISSIONS', 'MERITLIST_APPROVE'),
    ('FINANCE_OFFICER',    'PAYMENT_VIEW')
  )
ON CONFLICT DO NOTHING;