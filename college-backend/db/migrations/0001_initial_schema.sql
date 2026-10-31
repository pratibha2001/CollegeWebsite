-- =====================================================================
-- College Platform: PostgreSQL schema (Admission, Student, Alumni)
-- Run top to bottom. Tables are ordered so every foreign key target exists.
-- =====================================================================

CREATE SCHEMA "Common";
CREATE SCHEMA "Academics";
CREATE SCHEMA "Admission";
CREATE SCHEMA "Payments";
CREATE SCHEMA "Student";
CREATE SCHEMA "Alumni";
CREATE SCHEMA "Audit";


-- =====================================================================
-- COMMON: identity, access, consent, notifications, outbox
-- =====================================================================

CREATE TABLE "Common"."Users"
(
  "UserId" SERIAL NOT NULL PRIMARY KEY,
  "UserType" varchar(20) NOT NULL,
  "FullName" varchar(150) NOT NULL,
  "Email" varchar(150) NULL,
  "Mobile" varchar(16) NULL,
  "Status" varchar(30) NOT NULL DEFAULT 'PendingVerification',
  "EmailVerifiedAt" timestamptz NULL,
  "MobileVerifiedAt" timestamptz NULL,
  "LastLoginAt" timestamptz NULL,
  "PreferredLanguage" varchar(5) NOT NULL DEFAULT 'en',
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_Users_Email" UNIQUE ("Email"),
  CONSTRAINT "Unique_Users_Mobile" UNIQUE ("Mobile"),
  CONSTRAINT "Check_Users_UserType" CHECK ("UserType" IN ('Applicant','Student','Faculty','Staff','Alumni','Admin')),
  CONSTRAINT "Check_Users_Status" CHECK ("Status" IN ('PendingVerification','Active','Locked','Disabled')),
  CONSTRAINT "Check_Users_Contact" CHECK ("Email" IS NOT NULL OR "Mobile" IS NOT NULL)
);


CREATE TABLE "Common"."Roles"
(
  "RoleId" SERIAL NOT NULL PRIMARY KEY,
  "RoleCode" varchar(40) NOT NULL,
  "RoleName" varchar(100) NOT NULL,
  "Description" varchar(200) NULL,
  CONSTRAINT "Unique_Roles_RoleCode" UNIQUE ("RoleCode"),
  CONSTRAINT "Unique_Roles_RoleName" UNIQUE ("RoleName")
);


CREATE TABLE "Common"."Permissions"
(
  "PermissionId" SERIAL NOT NULL PRIMARY KEY,
  "PermissionCode" varchar(80) NOT NULL,
  "Description" varchar(200) NULL,
  CONSTRAINT "Unique_Permissions_PermissionCode" UNIQUE ("PermissionCode")
);


CREATE TABLE "Common"."RolePermissions"
(
  "RoleId" integer NOT NULL REFERENCES "Common"."Roles"("RoleId"),
  "PermissionId" integer NOT NULL REFERENCES "Common"."Permissions"("PermissionId"),
  PRIMARY KEY ("RoleId", "PermissionId")
);


CREATE TABLE "Common"."UserRoles"
(
  "UserRoleId" SERIAL NOT NULL PRIMARY KEY,
  "UserId" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "RoleId" integer NOT NULL REFERENCES "Common"."Roles"("RoleId"),
  "ScopeType" varchar(20) NOT NULL DEFAULT 'Global',
  "ScopeRef" varchar(60) NOT NULL DEFAULT '',
  "GrantedBy" integer NULL REFERENCES "Common"."Users"("UserId"),
  "GrantedAt" timestamptz NOT NULL DEFAULT now(),
  "ExpiresAt" timestamptz NULL,
  CONSTRAINT "Unique_UserRoles_UserRoleScope" UNIQUE ("UserId", "RoleId", "ScopeType", "ScopeRef"),
  CONSTRAINT "Check_UserRoles_ScopeType" CHECK ("ScopeType" IN ('Global','Department','Programme'))
);


CREATE TABLE "Common"."OtpChallenges"
(
  "OtpChallengeId" SERIAL NOT NULL PRIMARY KEY,
  "SubjectType" varchar(10) NOT NULL,
  "SubjectHash" char(64) NOT NULL,
  "Purpose" varchar(30) NOT NULL,
  "CodeHash" char(64) NOT NULL,
  "Attempts" smallint NOT NULL DEFAULT 0,
  "MaxAttempts" smallint NOT NULL DEFAULT 3,
  "ExpiresAt" timestamptz NOT NULL,
  "ConsumedAt" timestamptz NULL,
  "IpHash" char(64) NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Check_OtpChallenges_SubjectType" CHECK ("SubjectType" IN ('Email','Mobile')),
  CONSTRAINT "Check_OtpChallenges_Purpose" CHECK ("Purpose" IN ('Signup','Login','MobileVerify','EmailVerify','PasswordReset'))
);


CREATE TABLE "Common"."PrivacyNotices"
(
  "PrivacyNoticeId" SERIAL NOT NULL PRIMARY KEY,
  "Version" varchar(20) NOT NULL,
  "Language" varchar(5) NOT NULL DEFAULT 'en',
  "EffectiveFrom" timestamptz NOT NULL,
  "ContentHash" char(64) NOT NULL,
  CONSTRAINT "Unique_PrivacyNotices_VersionLanguage" UNIQUE ("Version", "Language")
);


CREATE TABLE "Common"."ConsentPurposes"
(
  "ConsentPurposeId" SERIAL NOT NULL PRIMARY KEY,
  "PurposeCode" varchar(60) NOT NULL,
  "PurposeName" varchar(150) NOT NULL,
  "IsRequired" boolean NOT NULL DEFAULT false,
  "RetentionDays" integer NULL,
  "IsActive" boolean NOT NULL DEFAULT true,
  CONSTRAINT "Unique_ConsentPurposes_PurposeCode" UNIQUE ("PurposeCode")
);


CREATE TABLE "Common"."ConsentRecords"
(
  "ConsentRecordId" SERIAL NOT NULL PRIMARY KEY,
  "UserId" integer NULL REFERENCES "Common"."Users"("UserId"),
  "SubjectEmailHash" char(64) NULL,
  "ConsentPurposeId" integer NOT NULL REFERENCES "Common"."ConsentPurposes"("ConsentPurposeId"),
  "PrivacyNoticeId" integer NOT NULL REFERENCES "Common"."PrivacyNotices"("PrivacyNoticeId"),
  "Status" varchar(10) NOT NULL,
  "Channel" varchar(20) NOT NULL,
  "GivenByGuardian" boolean NOT NULL DEFAULT false,
  "OccurredAt" timestamptz NOT NULL DEFAULT now(),
  "IpHash" char(64) NULL,
  CONSTRAINT "Check_ConsentRecords_Status" CHECK ("Status" IN ('Granted','Withdrawn')),
  CONSTRAINT "Check_ConsentRecords_Channel" CHECK ("Channel" IN ('WebForm','Console','SmsReply','EmailLink','Chatbot','Import'))
);


CREATE TABLE "Common"."NotificationTemplates"
(
  "TemplateId" SERIAL NOT NULL PRIMARY KEY,
  "TemplateCode" varchar(80) NOT NULL,
  "Channel" varchar(10) NOT NULL,
  "Language" varchar(5) NOT NULL DEFAULT 'en',
  "Subject" varchar(200) NULL,
  "BodyText" text NOT NULL,
  "BodyHtml" text NULL,
  "DltTemplateId" varchar(40) NULL,
  "Status" varchar(10) NOT NULL DEFAULT 'Draft',
  CONSTRAINT "Unique_NotificationTemplates_CodeChannelLanguage" UNIQUE ("TemplateCode", "Channel", "Language"),
  CONSTRAINT "Check_NotificationTemplates_Channel" CHECK ("Channel" IN ('Email','Sms','WhatsApp','InApp')),
  CONSTRAINT "Check_NotificationTemplates_Status" CHECK ("Status" IN ('Draft','Approved','Retired'))
);


CREATE TABLE "Common"."Notifications"
(
  "NotificationId" BIGSERIAL NOT NULL PRIMARY KEY,
  "TemplateId" integer NOT NULL REFERENCES "Common"."NotificationTemplates"("TemplateId"),
  "UserId" integer NULL REFERENCES "Common"."Users"("UserId"),
  "Channel" varchar(10) NOT NULL,
  "RecipientHash" char(64) NOT NULL,
  "Payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "Status" varchar(15) NOT NULL DEFAULT 'Queued',
  "Attempts" smallint NOT NULL DEFAULT 0,
  "ErrorMessage" text NULL,
  "ProviderMessageId" varchar(100) NULL,
  "IdempotencyKey" varchar(120) NULL,
  "ScheduledFor" timestamptz NOT NULL DEFAULT now(),
  "SentAt" timestamptz NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_Notifications_IdempotencyKey" UNIQUE ("IdempotencyKey"),
  CONSTRAINT "Check_Notifications_Status" CHECK ("Status" IN ('Queued','Sending','Sent','Delivered','Failed','Bounced','Suppressed','Expired'))
);


CREATE TABLE "Common"."OutboxEvents"
(
  "OutboxEventId" BIGSERIAL NOT NULL PRIMARY KEY,
  "AggregateType" varchar(60) NOT NULL,
  "AggregateId" varchar(60) NOT NULL,
  "EventType" varchar(100) NOT NULL,
  "Payload" jsonb NOT NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  "PublishedAt" timestamptz NULL
);


-- =====================================================================
-- ACADEMICS: departments, programmes, batches, courses, fees
-- =====================================================================

CREATE TABLE "Academics"."Departments"
(
  "DepartmentId" SERIAL NOT NULL PRIMARY KEY,
  "DepartmentCode" varchar(12) NOT NULL,
  "DepartmentName" varchar(100) NOT NULL,
  "Description" varchar(200) NULL,
  CONSTRAINT "Unique_Departments_DepartmentCode" UNIQUE ("DepartmentCode"),
  CONSTRAINT "Unique_Departments_DepartmentName" UNIQUE ("DepartmentName")
);


CREATE TABLE "Academics"."Programmes"
(
  "ProgrammeId" SERIAL NOT NULL PRIMARY KEY,
  "ProgrammeCode" varchar(20) NOT NULL,
  "ProgrammeName" varchar(150) NOT NULL,
  "DepartmentId" integer NOT NULL REFERENCES "Academics"."Departments"("DepartmentId"),
  "Level" varchar(20) NOT NULL,
  "Mode" varchar(15) NOT NULL DEFAULT 'FullTime',
  "DurationMonths" smallint NOT NULL,
  "TotalSeats" integer NOT NULL,
  "IsActive" boolean NOT NULL DEFAULT true,
  CONSTRAINT "Unique_Programmes_ProgrammeCode" UNIQUE ("ProgrammeCode"),
  CONSTRAINT "Unique_Programmes_ProgrammeName" UNIQUE ("ProgrammeName"),
  CONSTRAINT "Check_Programmes_Level" CHECK ("Level" IN ('Diploma','Undergraduate','Postgraduate','Doctoral','Certificate')),
  CONSTRAINT "Check_Programmes_Mode" CHECK ("Mode" IN ('FullTime','PartTime','Online','Hybrid')),
  CONSTRAINT "Check_Programmes_DurationMonths" CHECK ("DurationMonths" BETWEEN 1 AND 120),
  CONSTRAINT "Check_Programmes_TotalSeats" CHECK ("TotalSeats" >= 0)
);


CREATE TABLE "Academics"."Batches"
(
  "BatchId" SERIAL NOT NULL PRIMARY KEY,
  "ProgrammeId" integer NOT NULL REFERENCES "Academics"."Programmes"("ProgrammeId"),
  "BatchName" varchar(50) NOT NULL,
  "StartYear" smallint NOT NULL,
  "EndYear" smallint NOT NULL,
  CONSTRAINT "Unique_Batches_ProgrammeBatchName" UNIQUE ("ProgrammeId", "BatchName"),
  CONSTRAINT "Check_Batches_Years" CHECK ("EndYear" > "StartYear")
);


CREATE TABLE "Academics"."Semesters"
(
  "SemesterId" SERIAL NOT NULL PRIMARY KEY,
  "BatchId" integer NOT NULL REFERENCES "Academics"."Batches"("BatchId"),
  "SemesterNo" smallint NOT NULL,
  "StartDate" date NOT NULL,
  "EndDate" date NOT NULL,
  CONSTRAINT "Unique_Semesters_BatchSemesterNo" UNIQUE ("BatchId", "SemesterNo"),
  CONSTRAINT "Check_Semesters_Dates" CHECK ("EndDate" > "StartDate")
);


CREATE TABLE "Academics"."Courses"
(
  "CourseId" SERIAL NOT NULL PRIMARY KEY,
  "CourseCode" varchar(20) NOT NULL,
  "CourseName" varchar(150) NOT NULL,
  "DepartmentId" integer NOT NULL REFERENCES "Academics"."Departments"("DepartmentId"),
  "Credits" numeric(4,1) NOT NULL,
  "IsElective" boolean NOT NULL DEFAULT false,
  CONSTRAINT "Unique_Courses_CourseCode" UNIQUE ("CourseCode"),
  CONSTRAINT "Check_Courses_Credits" CHECK ("Credits" > 0)
);


CREATE TABLE "Academics"."SemesterCourses"
(
  "SemesterCourseId" SERIAL NOT NULL PRIMARY KEY,
  "SemesterId" integer NOT NULL REFERENCES "Academics"."Semesters"("SemesterId"),
  "CourseId" integer NOT NULL REFERENCES "Academics"."Courses"("CourseId"),
  "FacultyUserId" integer NULL REFERENCES "Common"."Users"("UserId"),
  "SeatLimit" integer NULL,
  CONSTRAINT "Unique_SemesterCourses_SemesterCourse" UNIQUE ("SemesterId", "CourseId"),
  CONSTRAINT "Check_SemesterCourses_SeatLimit" CHECK ("SeatLimit" IS NULL OR "SeatLimit" > 0)
);


CREATE TABLE "Academics"."FeeItems"
(
  "FeeItemId" SERIAL NOT NULL PRIMARY KEY,
  "ProgrammeId" integer NOT NULL REFERENCES "Academics"."Programmes"("ProgrammeId"),
  "AcademicYear" varchar(9) NOT NULL,
  "Category" varchar(20) NOT NULL DEFAULT 'General',
  "ItemName" varchar(100) NOT NULL,
  "AmountPaise" bigint NOT NULL,
  "Frequency" varchar(15) NOT NULL DEFAULT 'PerYear',
  "IsMandatory" boolean NOT NULL DEFAULT true,
  CONSTRAINT "Unique_FeeItems_ProgrammeYearCategoryItem" UNIQUE ("ProgrammeId", "AcademicYear", "Category", "ItemName"),
  CONSTRAINT "Check_FeeItems_AmountPaise" CHECK ("AmountPaise" >= 0),
  CONSTRAINT "Check_FeeItems_Frequency" CHECK ("Frequency" IN ('OneTime','PerYear','PerSemester','Monthly'))
);


-- =====================================================================
-- PAYMENTS: shared by admission fees, student dues, events, donations
-- =====================================================================

CREATE TABLE "Payments"."PaymentOrders"
(
  "PaymentOrderId" SERIAL NOT NULL PRIMARY KEY,
  "OrderNo" varchar(24) NOT NULL,
  "PayerUserId" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "Purpose" varchar(20) NOT NULL,
  "ReferenceType" varchar(25) NOT NULL,
  "ReferenceId" integer NOT NULL,
  "AmountPaise" bigint NOT NULL,
  "TaxPaise" bigint NOT NULL DEFAULT 0,
  "Currency" char(3) NOT NULL DEFAULT 'INR',
  "Status" varchar(20) NOT NULL DEFAULT 'Created',
  "Provider" varchar(30) NOT NULL,
  "ProviderOrderId" varchar(80) NULL,
  "IdempotencyKey" varchar(80) NOT NULL,
  "ExpiresAt" timestamptz NOT NULL,
  "PaidAt" timestamptz NULL,
  "ReceiptNo" varchar(24) NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
  "RowVersion" integer NOT NULL DEFAULT 1,
  CONSTRAINT "Unique_PaymentOrders_OrderNo" UNIQUE ("OrderNo"),
  CONSTRAINT "Unique_PaymentOrders_ReceiptNo" UNIQUE ("ReceiptNo"),
  CONSTRAINT "Unique_PaymentOrders_ProviderOrder" UNIQUE ("Provider", "ProviderOrderId"),
  CONSTRAINT "Unique_PaymentOrders_PayerPurposeKey" UNIQUE ("PayerUserId", "Purpose", "IdempotencyKey"),
  CONSTRAINT "Check_PaymentOrders_Purpose" CHECK ("Purpose" IN ('ApplicationFee','AdmissionFee','TuitionFee','EventFee','Donation','Other')),
  CONSTRAINT "Check_PaymentOrders_ReferenceType" CHECK ("ReferenceType" IN ('Application','Student','EventRegistration','Donation')),
  CONSTRAINT "Check_PaymentOrders_AmountPaise" CHECK ("AmountPaise" > 0),
  CONSTRAINT "Check_PaymentOrders_TaxPaise" CHECK ("TaxPaise" >= 0),
  CONSTRAINT "Check_PaymentOrders_Status" CHECK ("Status" IN ('Created','Pending','Paid','Failed','Expired','Refunded','PartiallyRefunded','Disputed')),
  CONSTRAINT "Check_PaymentOrders_PaidAt" CHECK ("Status" NOT IN ('Paid','Refunded','PartiallyRefunded') OR "PaidAt" IS NOT NULL)
);


CREATE TABLE "Payments"."PaymentAttempts"
(
  "PaymentAttemptId" SERIAL NOT NULL PRIMARY KEY,
  "PaymentOrderId" integer NOT NULL REFERENCES "Payments"."PaymentOrders"("PaymentOrderId"),
  "ProviderPaymentId" varchar(80) NOT NULL,
  "Method" varchar(15) NULL,
  "Status" varchar(15) NOT NULL DEFAULT 'Initiated',
  "AmountPaise" bigint NOT NULL,
  "FailureCode" varchar(60) NULL,
  "FailureReason" varchar(200) NULL,
  "RawResponse" jsonb NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  "CapturedAt" timestamptz NULL,
  CONSTRAINT "Unique_PaymentAttempts_ProviderPaymentId" UNIQUE ("ProviderPaymentId"),
  CONSTRAINT "Check_PaymentAttempts_Method" CHECK ("Method" IS NULL OR "Method" IN ('Upi','Card','NetBanking','Wallet','Emi','Other')),
  CONSTRAINT "Check_PaymentAttempts_Status" CHECK ("Status" IN ('Initiated','Authorised','Captured','Failed','Cancelled')),
  CONSTRAINT "Check_PaymentAttempts_AmountPaise" CHECK ("AmountPaise" > 0)
);


CREATE TABLE "Payments"."PaymentWebhookEvents"
(
  "PaymentWebhookEventId" BIGSERIAL NOT NULL PRIMARY KEY,
  "Provider" varchar(30) NOT NULL,
  "EventId" varchar(100) NOT NULL,
  "EventType" varchar(80) NOT NULL,
  "SignatureValid" boolean NOT NULL,
  "Payload" jsonb NOT NULL,
  "Status" varchar(15) NOT NULL DEFAULT 'Received',
  "Error" text NULL,
  "ReceivedAt" timestamptz NOT NULL DEFAULT now(),
  "ProcessedAt" timestamptz NULL,
  CONSTRAINT "Unique_PaymentWebhookEvents_ProviderEvent" UNIQUE ("Provider", "EventId"),
  CONSTRAINT "Check_PaymentWebhookEvents_Status" CHECK ("Status" IN ('Received','Processed','Ignored','Failed'))
);


CREATE TABLE "Payments"."Refunds"
(
  "RefundId" SERIAL NOT NULL PRIMARY KEY,
  "RefundNo" varchar(24) NOT NULL,
  "PaymentOrderId" integer NOT NULL REFERENCES "Payments"."PaymentOrders"("PaymentOrderId"),
  "PaymentAttemptId" integer NOT NULL REFERENCES "Payments"."PaymentAttempts"("PaymentAttemptId"),
  "AmountPaise" bigint NOT NULL,
  "ReasonCode" varchar(25) NOT NULL,
  "ReasonNote" varchar(300) NULL,
  "Status" varchar(15) NOT NULL DEFAULT 'Requested',
  "RequestedBy" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "ApprovedBy" integer NULL REFERENCES "Common"."Users"("UserId"),
  "ProviderRefundId" varchar(80) NULL,
  "CompletedAt" timestamptz NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_Refunds_RefundNo" UNIQUE ("RefundNo"),
  CONSTRAINT "Check_Refunds_AmountPaise" CHECK ("AmountPaise" > 0),
  CONSTRAINT "Check_Refunds_ReasonCode" CHECK ("ReasonCode" IN ('Duplicate','ApplicantRequest','ProgrammeCancelled','Error','Other')),
  CONSTRAINT "Check_Refunds_Status" CHECK ("Status" IN ('Requested','Approved','Processing','Completed','Rejected','Failed')),
  CONSTRAINT "Check_Refunds_Approver" CHECK ("ApprovedBy" IS NULL OR "ApprovedBy" <> "RequestedBy")
);


-- =====================================================================
-- ADMISSION: enquiries, forms, applications, documents, merit lists
-- =====================================================================

CREATE TABLE "Admission"."Leads"
(
  "LeadId" SERIAL NOT NULL PRIMARY KEY,
  "LeadNo" varchar(20) NOT NULL,
  "FullName" varchar(150) NOT NULL,
  "Email" varchar(150) NULL,
  "Mobile" varchar(16) NULL,
  "City" varchar(80) NULL,
  "ProgrammeId" integer NULL REFERENCES "Academics"."Programmes"("ProgrammeId"),
  "Source" varchar(20) NOT NULL DEFAULT 'WebForm',
  "UtmCampaign" varchar(100) NULL,
  "Status" varchar(15) NOT NULL DEFAULT 'New',
  "AssignedTo" integer NULL REFERENCES "Common"."Users"("UserId"),
  "ConsentRecordId" integer NOT NULL REFERENCES "Common"."ConsentRecords"("ConsentRecordId"),
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_Leads_LeadNo" UNIQUE ("LeadNo"),
  CONSTRAINT "Check_Leads_Status" CHECK ("Status" IN ('New','Contacted','Qualified','VisitBooked','Applied','Enrolled','Lost','Spam')),
  CONSTRAINT "Check_Leads_Contact" CHECK ("Email" IS NOT NULL OR "Mobile" IS NOT NULL)
);


CREATE TABLE "Admission"."FormDefinitions"
(
  "FormDefinitionId" SERIAL NOT NULL PRIMARY KEY,
  "FormKey" varchar(80) NOT NULL,
  "Version" integer NOT NULL,
  "SchemaJson" jsonb NOT NULL,
  "Status" varchar(10) NOT NULL DEFAULT 'Draft',
  "PublishedAt" timestamptz NULL,
  CONSTRAINT "Unique_FormDefinitions_KeyVersion" UNIQUE ("FormKey", "Version"),
  CONSTRAINT "Check_FormDefinitions_Status" CHECK ("Status" IN ('Draft','Published','Retired'))
);


CREATE TABLE "Admission"."ApplicationWindows"
(
  "ApplicationWindowId" SERIAL NOT NULL PRIMARY KEY,
  "ProgrammeId" integer NOT NULL REFERENCES "Academics"."Programmes"("ProgrammeId"),
  "AcademicYear" varchar(9) NOT NULL,
  "OpensAt" timestamptz NOT NULL,
  "ClosesAt" timestamptz NOT NULL,
  "ApplicationFeePaise" bigint NOT NULL DEFAULT 0,
  "LateFeePaise" bigint NOT NULL DEFAULT 0,
  CONSTRAINT "Unique_ApplicationWindows_ProgrammeYear" UNIQUE ("ProgrammeId", "AcademicYear"),
  CONSTRAINT "Check_ApplicationWindows_Dates" CHECK ("ClosesAt" > "OpensAt"),
  CONSTRAINT "Check_ApplicationWindows_Fees" CHECK ("ApplicationFeePaise" >= 0 AND "LateFeePaise" >= 0)
);


CREATE TABLE "Admission"."Applications"
(
  "ApplicationId" SERIAL NOT NULL PRIMARY KEY,
  "ApplicationNo" varchar(20) NULL,
  "ApplicantUserId" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "ProgrammeId" integer NOT NULL REFERENCES "Academics"."Programmes"("ProgrammeId"),
  "AcademicYear" varchar(9) NOT NULL,
  "IntakeMonth" smallint NOT NULL,
  "Status" varchar(25) NOT NULL DEFAULT 'Draft',
  "CurrentStep" smallint NOT NULL DEFAULT 1,
  "FormDefinitionId" integer NOT NULL REFERENCES "Admission"."FormDefinitions"("FormDefinitionId"),
  "Answers" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "SourceLeadId" integer NULL REFERENCES "Admission"."Leads"("LeadId"),
  "DeclarationAcceptedAt" timestamptz NULL,
  "GuardianConsentRecordId" integer NULL REFERENCES "Common"."ConsentRecords"("ConsentRecordId"),
  "SubmittedAt" timestamptz NULL,
  "LockedAt" timestamptz NULL,
  "FeeStatus" varchar(15) NOT NULL DEFAULT 'Pending',
  "Decision" varchar(15) NOT NULL DEFAULT 'None',
  "DecisionAt" timestamptz NULL,
  "DecisionBy" integer NULL REFERENCES "Common"."Users"("UserId"),
  "DecisionNote" text NULL,
  "MeritScore" numeric(8,3) NULL,
  "MeritRank" integer NULL,
  "AssignedReviewerId" integer NULL REFERENCES "Common"."Users"("UserId"),
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
  "RowVersion" integer NOT NULL DEFAULT 1,
  CONSTRAINT "Unique_Applications_ApplicationNo" UNIQUE ("ApplicationNo"),
  CONSTRAINT "Check_Applications_IntakeMonth" CHECK ("IntakeMonth" BETWEEN 1 AND 12),
  CONSTRAINT "Check_Applications_Status" CHECK ("Status" IN ('Draft','Submitted','UnderReview','DocumentsPending','Shortlisted','InterviewScheduled','Offered','Waitlisted','Rejected','Accepted','Withdrawn','Expired')),
  CONSTRAINT "Check_Applications_FeeStatus" CHECK ("FeeStatus" IN ('NotRequired','Pending','Paid','Waived','Refunded')),
  CONSTRAINT "Check_Applications_Decision" CHECK ("Decision" IN ('None','Offered','Waitlisted','Rejected'))
);

CREATE UNIQUE INDEX "Unique_Applications_OnePerProgrammeYear"
  ON "Admission"."Applications" ("ApplicantUserId", "ProgrammeId", "AcademicYear")
  WHERE "Status" NOT IN ('Withdrawn','Expired');


CREATE TABLE "Admission"."ApplicationPersonal"
(
  "ApplicationId" integer NOT NULL PRIMARY KEY REFERENCES "Admission"."Applications"("ApplicationId"),
  "DateOfBirth" date NOT NULL,
  "Gender" varchar(15) NULL,
  "Category" varchar(15) NOT NULL DEFAULT 'General',
  "IsPwd" boolean NOT NULL DEFAULT false,
  "Nationality" char(2) NOT NULL DEFAULT 'IN',
  "HomeState" varchar(60) NULL,
  "GuardianName" varchar(150) NOT NULL,
  "GuardianRelation" varchar(20) NULL,
  "GuardianMobile" varchar(16) NOT NULL,
  "GuardianEmail" varchar(150) NULL,
  "AddressCurrent" text NULL,
  "AddressPermanent" text NULL,
  "NeedsHostel" boolean NOT NULL DEFAULT false,
  "NeedsTransport" boolean NOT NULL DEFAULT false,
  CONSTRAINT "Check_ApplicationPersonal_Category" CHECK ("Category" IN ('General','ObcNcl','Sc','St','Ews','Other')),
  CONSTRAINT "Check_ApplicationPersonal_DateOfBirth" CHECK ("DateOfBirth" > DATE '1950-01-01')
);


CREATE TABLE "Admission"."ApplicationAcademics"
(
  "ApplicationAcademicId" SERIAL NOT NULL PRIMARY KEY,
  "ApplicationId" integer NOT NULL REFERENCES "Admission"."Applications"("ApplicationId"),
  "Level" varchar(20) NOT NULL,
  "BoardOrUniversity" varchar(150) NOT NULL,
  "Institution" varchar(200) NULL,
  "YearOfPassing" smallint NOT NULL,
  "MarksObtained" numeric(8,2) NULL,
  "MarksTotal" numeric(8,2) NULL,
  "Percentage" numeric(5,2) NULL,
  "Subjects" jsonb NULL,
  "Verified" boolean NOT NULL DEFAULT false,
  CONSTRAINT "Unique_ApplicationAcademics_ApplicationLevel" UNIQUE ("ApplicationId", "Level"),
  CONSTRAINT "Check_ApplicationAcademics_Level" CHECK ("Level" IN ('Secondary','SeniorSecondary','Diploma','Undergraduate','Postgraduate','Other')),
  CONSTRAINT "Check_ApplicationAcademics_Percentage" CHECK ("Percentage" IS NULL OR "Percentage" BETWEEN 0 AND 100)
);


CREATE TABLE "Admission"."ApplicationExamScores"
(
  "ApplicationExamScoreId" SERIAL NOT NULL PRIMARY KEY,
  "ApplicationId" integer NOT NULL REFERENCES "Admission"."Applications"("ApplicationId"),
  "ExamName" varchar(100) NOT NULL,
  "RollNo" varchar(40) NULL,
  "ExamYear" smallint NOT NULL,
  "Score" numeric(8,2) NULL,
  "Percentile" numeric(5,2) NULL,
  "ExamRank" integer NULL,
  "Verified" boolean NOT NULL DEFAULT false,
  CONSTRAINT "Unique_ApplicationExamScores_ApplicationExamYear" UNIQUE ("ApplicationId", "ExamName", "ExamYear")
);


CREATE TABLE "Admission"."ApplicationStatusHistory"
(
  "ApplicationStatusHistoryId" BIGSERIAL NOT NULL PRIMARY KEY,
  "ApplicationId" integer NOT NULL REFERENCES "Admission"."Applications"("ApplicationId"),
  "FromStatus" varchar(25) NULL,
  "ToStatus" varchar(25) NOT NULL,
  "Reason" text NULL,
  "ActorUserId" integer NULL REFERENCES "Common"."Users"("UserId"),
  "ActorType" varchar(10) NOT NULL DEFAULT 'Staff',
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Check_ApplicationStatusHistory_ActorType" CHECK ("ActorType" IN ('Applicant','Staff','System'))
);


CREATE TABLE "Admission"."DocumentTypes"
(
  "DocumentTypeId" SERIAL NOT NULL PRIMARY KEY,
  "TypeCode" varchar(40) NOT NULL,
  "TypeName" varchar(100) NOT NULL,
  "AllowedMimeTypes" text[] NOT NULL,
  "MaxBytes" integer NOT NULL DEFAULT 2097152,
  "IsActive" boolean NOT NULL DEFAULT true,
  CONSTRAINT "Unique_DocumentTypes_TypeCode" UNIQUE ("TypeCode"),
  CONSTRAINT "Check_DocumentTypes_MaxBytes" CHECK ("MaxBytes" > 0)
);


CREATE TABLE "Admission"."Documents"
(
  "DocumentId" SERIAL NOT NULL PRIMARY KEY,
  "OwnerUserId" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "ApplicationId" integer NULL REFERENCES "Admission"."Applications"("ApplicationId"),
  "DocumentTypeId" integer NOT NULL REFERENCES "Admission"."DocumentTypes"("DocumentTypeId"),
  "OriginalFileName" varchar(255) NOT NULL,
  "StorageKey" varchar(300) NOT NULL,
  "MimeType" varchar(100) NOT NULL,
  "SizeBytes" bigint NOT NULL,
  "ChecksumSha256" char(64) NULL,
  "ScanStatus" varchar(10) NOT NULL DEFAULT 'Pending',
  "VerificationStatus" varchar(10) NOT NULL DEFAULT 'Pending',
  "VerifiedBy" integer NULL REFERENCES "Common"."Users"("UserId"),
  "VerifiedAt" timestamptz NULL,
  "RejectionReason" varchar(300) NULL,
  "ReplacedByDocumentId" integer NULL REFERENCES "Admission"."Documents"("DocumentId"),
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  "DeletedAt" timestamptz NULL,
  CONSTRAINT "Unique_Documents_StorageKey" UNIQUE ("StorageKey"),
  CONSTRAINT "Check_Documents_SizeBytes" CHECK ("SizeBytes" > 0),
  CONSTRAINT "Check_Documents_ScanStatus" CHECK ("ScanStatus" IN ('Pending','Clean','Infected','Error')),
  CONSTRAINT "Check_Documents_VerificationStatus" CHECK ("VerificationStatus" IN ('Pending','Verified','Rejected'))
);


CREATE TABLE "Admission"."ApplicationChecklistItems"
(
  "ApplicationId" integer NOT NULL REFERENCES "Admission"."Applications"("ApplicationId"),
  "ItemCode" varchar(60) NOT NULL,
  "Status" varchar(10) NOT NULL DEFAULT 'Pending',
  "Remark" varchar(300) NULL,
  "CheckedBy" integer NULL REFERENCES "Common"."Users"("UserId"),
  "CheckedAt" timestamptz NULL,
  PRIMARY KEY ("ApplicationId", "ItemCode"),
  CONSTRAINT "Check_ApplicationChecklistItems_Status" CHECK ("Status" IN ('Pending','Ok','Issue'))
);


CREATE TABLE "Admission"."MeritLists"
(
  "MeritListId" SERIAL NOT NULL PRIMARY KEY,
  "ProgrammeId" integer NOT NULL REFERENCES "Academics"."Programmes"("ProgrammeId"),
  "AcademicYear" varchar(9) NOT NULL,
  "RoundNo" smallint NOT NULL DEFAULT 1,
  "RuleSet" jsonb NOT NULL,
  "Status" varchar(10) NOT NULL DEFAULT 'Draft',
  "GeneratedBy" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "GeneratedAt" timestamptz NOT NULL DEFAULT now(),
  "ApprovedBy" integer NULL REFERENCES "Common"."Users"("UserId"),
  "PublishedAt" timestamptz NULL,
  "SnapshotHash" char(64) NULL,
  CONSTRAINT "Unique_MeritLists_ProgrammeYearRound" UNIQUE ("ProgrammeId", "AcademicYear", "RoundNo"),
  CONSTRAINT "Check_MeritLists_Status" CHECK ("Status" IN ('Draft','Approved','Published'))
);


CREATE TABLE "Admission"."MeritListEntries"
(
  "MeritListEntryId" SERIAL NOT NULL PRIMARY KEY,
  "MeritListId" integer NOT NULL REFERENCES "Admission"."MeritLists"("MeritListId"),
  "ApplicationId" integer NOT NULL REFERENCES "Admission"."Applications"("ApplicationId"),
  "MeritRank" integer NOT NULL,
  "CategoryRank" integer NULL,
  "Score" numeric(8,3) NOT NULL,
  "Outcome" varchar(15) NOT NULL,
  CONSTRAINT "Unique_MeritListEntries_ListApplication" UNIQUE ("MeritListId", "ApplicationId"),
  CONSTRAINT "Check_MeritListEntries_Outcome" CHECK ("Outcome" IN ('Selected','Waitlisted','NotSelected'))
);


-- =====================================================================
-- STUDENT: enrolment, courses, attendance, results, requests, graduation
-- =====================================================================

CREATE TABLE "Student"."Students"
(
  "StudentId" SERIAL NOT NULL PRIMARY KEY,
  "UserId" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "ApplicationId" integer NULL REFERENCES "Admission"."Applications"("ApplicationId"),
  "EnrolmentNo" varchar(20) NOT NULL,
  "ProgrammeId" integer NOT NULL REFERENCES "Academics"."Programmes"("ProgrammeId"),
  "BatchId" integer NOT NULL REFERENCES "Academics"."Batches"("BatchId"),
  "Status" varchar(15) NOT NULL DEFAULT 'Active',
  "AdmissionDate" date NOT NULL DEFAULT CURRENT_DATE,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_Students_UserId" UNIQUE ("UserId"),
  CONSTRAINT "Unique_Students_ApplicationId" UNIQUE ("ApplicationId"),
  CONSTRAINT "Unique_Students_EnrolmentNo" UNIQUE ("EnrolmentNo"),
  CONSTRAINT "Check_Students_Status" CHECK ("Status" IN ('Active','OnLeave','Graduated','DroppedOut','Transferred'))
);


CREATE TABLE "Student"."CourseRegistrations"
(
  "CourseRegistrationId" SERIAL NOT NULL PRIMARY KEY,
  "StudentId" integer NOT NULL REFERENCES "Student"."Students"("StudentId"),
  "SemesterCourseId" integer NOT NULL REFERENCES "Academics"."SemesterCourses"("SemesterCourseId"),
  "Status" varchar(15) NOT NULL DEFAULT 'Registered',
  "RegisteredAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_CourseRegistrations_StudentSemesterCourse" UNIQUE ("StudentId", "SemesterCourseId"),
  CONSTRAINT "Check_CourseRegistrations_Status" CHECK ("Status" IN ('Registered','Dropped','Completed'))
);


CREATE TABLE "Student"."TimetableSlots"
(
  "TimetableSlotId" SERIAL NOT NULL PRIMARY KEY,
  "SemesterCourseId" integer NOT NULL REFERENCES "Academics"."SemesterCourses"("SemesterCourseId"),
  "Weekday" smallint NOT NULL,
  "StartTime" time NOT NULL,
  "EndTime" time NOT NULL,
  "Room" varchar(30) NULL,
  CONSTRAINT "Unique_TimetableSlots_CourseWeekdayStart" UNIQUE ("SemesterCourseId", "Weekday", "StartTime"),
  CONSTRAINT "Check_TimetableSlots_Weekday" CHECK ("Weekday" BETWEEN 1 AND 7),
  CONSTRAINT "Check_TimetableSlots_Time" CHECK ("EndTime" > "StartTime")
);


CREATE TABLE "Student"."AttendanceSessions"
(
  "AttendanceSessionId" SERIAL NOT NULL PRIMARY KEY,
  "SemesterCourseId" integer NOT NULL REFERENCES "Academics"."SemesterCourses"("SemesterCourseId"),
  "SessionDate" date NOT NULL,
  "StartTime" time NOT NULL,
  "MarkedBy" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "MarkedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_AttendanceSessions_CourseDateStart" UNIQUE ("SemesterCourseId", "SessionDate", "StartTime")
);


CREATE TABLE "Student"."AttendanceRecords"
(
  "AttendanceRecordId" BIGSERIAL NOT NULL PRIMARY KEY,
  "AttendanceSessionId" integer NOT NULL REFERENCES "Student"."AttendanceSessions"("AttendanceSessionId"),
  "StudentId" integer NOT NULL REFERENCES "Student"."Students"("StudentId"),
  "Status" varchar(10) NOT NULL,
  CONSTRAINT "Unique_AttendanceRecords_SessionStudent" UNIQUE ("AttendanceSessionId", "StudentId"),
  CONSTRAINT "Check_AttendanceRecords_Status" CHECK ("Status" IN ('Present','Absent','Late','Excused'))
);


CREATE TABLE "Student"."Assessments"
(
  "AssessmentId" SERIAL NOT NULL PRIMARY KEY,
  "SemesterCourseId" integer NOT NULL REFERENCES "Academics"."SemesterCourses"("SemesterCourseId"),
  "AssessmentName" varchar(100) NOT NULL,
  "AssessmentType" varchar(20) NOT NULL,
  "MaxMarks" numeric(6,2) NOT NULL,
  "Weightage" numeric(5,2) NOT NULL,
  "EntryOpensAt" timestamptz NULL,
  "EntryClosesAt" timestamptz NULL,
  "IsPublished" boolean NOT NULL DEFAULT false,
  "PublishedAt" timestamptz NULL,
  CONSTRAINT "Unique_Assessments_CourseName" UNIQUE ("SemesterCourseId", "AssessmentName"),
  CONSTRAINT "Check_Assessments_Type" CHECK ("AssessmentType" IN ('Quiz','Assignment','MidTerm','Lab','Project','EndTerm')),
  CONSTRAINT "Check_Assessments_MaxMarks" CHECK ("MaxMarks" > 0),
  CONSTRAINT "Check_Assessments_Weightage" CHECK ("Weightage" BETWEEN 0 AND 100)
);


CREATE TABLE "Student"."ResultEntries"
(
  "ResultEntryId" BIGSERIAL NOT NULL PRIMARY KEY,
  "AssessmentId" integer NOT NULL REFERENCES "Student"."Assessments"("AssessmentId"),
  "StudentId" integer NOT NULL REFERENCES "Student"."Students"("StudentId"),
  "Marks" numeric(6,2) NULL,
  "IsAbsent" boolean NOT NULL DEFAULT false,
  "VersionNo" integer NOT NULL DEFAULT 1,
  "IsCurrent" boolean NOT NULL DEFAULT true,
  "ChangeReason" varchar(300) NULL,
  "EnteredBy" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_ResultEntries_AssessmentStudentVersion" UNIQUE ("AssessmentId", "StudentId", "VersionNo"),
  CONSTRAINT "Check_ResultEntries_Marks" CHECK ("Marks" IS NULL OR "Marks" >= 0)
);

CREATE UNIQUE INDEX "Unique_ResultEntries_OneCurrentPerStudent"
  ON "Student"."ResultEntries" ("AssessmentId", "StudentId")
  WHERE "IsCurrent" = true;


CREATE TABLE "Student"."GradeSheets"
(
  "GradeSheetId" SERIAL NOT NULL PRIMARY KEY,
  "StudentId" integer NOT NULL REFERENCES "Student"."Students"("StudentId"),
  "SemesterId" integer NOT NULL REFERENCES "Academics"."Semesters"("SemesterId"),
  "VersionNo" integer NOT NULL DEFAULT 1,
  "Sgpa" numeric(4,2) NULL,
  "Cgpa" numeric(4,2) NULL,
  "Status" varchar(10) NOT NULL DEFAULT 'Draft',
  "PublishedAt" timestamptz NULL,
  "LockedAt" timestamptz NULL,
  "ChangeReason" varchar(300) NULL,
  CONSTRAINT "Unique_GradeSheets_StudentSemesterVersion" UNIQUE ("StudentId", "SemesterId", "VersionNo"),
  CONSTRAINT "Check_GradeSheets_Status" CHECK ("Status" IN ('Draft','Published','Locked','Superseded'))
);


CREATE TABLE "Student"."ServiceRequests"
(
  "ServiceRequestId" SERIAL NOT NULL PRIMARY KEY,
  "RequestNo" varchar(20) NOT NULL,
  "StudentId" integer NOT NULL REFERENCES "Student"."Students"("StudentId"),
  "RequestType" varchar(30) NOT NULL,
  "Details" text NULL,
  "Status" varchar(15) NOT NULL DEFAULT 'Submitted',
  "AssignedTo" integer NULL REFERENCES "Common"."Users"("UserId"),
  "DueAt" timestamptz NULL,
  "ClosedAt" timestamptz NULL,
  "ResultDocumentId" integer NULL REFERENCES "Admission"."Documents"("DocumentId"),
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_ServiceRequests_RequestNo" UNIQUE ("RequestNo"),
  CONSTRAINT "Check_ServiceRequests_Type" CHECK ("RequestType" IN ('Bonafide','Transcript','IdCard','Leave','HostelChange','Revaluation','Other')),
  CONSTRAINT "Check_ServiceRequests_Status" CHECK ("Status" IN ('Submitted','InProgress','Completed','Rejected','Cancelled'))
);


CREATE TABLE "Student"."GraduationClearances"
(
  "GraduationClearanceId" SERIAL NOT NULL PRIMARY KEY,
  "StudentId" integer NOT NULL REFERENCES "Student"."Students"("StudentId"),
  "AcademicsCleared" boolean NOT NULL DEFAULT false,
  "LibraryCleared" boolean NOT NULL DEFAULT false,
  "HostelCleared" boolean NOT NULL DEFAULT false,
  "FinanceCleared" boolean NOT NULL DEFAULT false,
  "ClearedAt" timestamptz NULL,
  "DegreeIssuedAt" timestamptz NULL,
  "DegreeVerificationCode" varchar(30) NULL,
  CONSTRAINT "Unique_GraduationClearances_StudentId" UNIQUE ("StudentId"),
  CONSTRAINT "Unique_GraduationClearances_VerificationCode" UNIQUE ("DegreeVerificationCode")
);


-- =====================================================================
-- ALUMNI: profiles, mentoring, jobs, events, giving
-- =====================================================================

CREATE TABLE "Alumni"."AlumniProfiles"
(
  "AlumniProfileId" SERIAL NOT NULL PRIMARY KEY,
  "UserId" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "StudentId" integer NULL REFERENCES "Student"."Students"("StudentId"),
  "ProgrammeId" integer NOT NULL REFERENCES "Academics"."Programmes"("ProgrammeId"),
  "GraduationYear" smallint NOT NULL,
  "VerificationStatus" varchar(10) NOT NULL DEFAULT 'Pending',
  "CurrentTitle" varchar(100) NULL,
  "Organisation" varchar(150) NULL,
  "Industry" varchar(80) NULL,
  "City" varchar(80) NULL,
  "Country" char(2) NULL,
  "Bio" text NULL,
  "LinkedInUrl" varchar(200) NULL,
  "DirectoryOptIn" boolean NOT NULL DEFAULT false,
  "MentorshipOptIn" boolean NOT NULL DEFAULT false,
  "MentorshipAreas" text[] NULL,
  "FieldVisibility" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ConsentRecordId" integer NOT NULL REFERENCES "Common"."ConsentRecords"("ConsentRecordId"),
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_AlumniProfiles_UserId" UNIQUE ("UserId"),
  CONSTRAINT "Check_AlumniProfiles_VerificationStatus" CHECK ("VerificationStatus" IN ('Pending','Verified','Rejected'))
);


CREATE TABLE "Alumni"."MentorshipRequests"
(
  "MentorshipRequestId" SERIAL NOT NULL PRIMARY KEY,
  "MenteeUserId" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "MentorUserId" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "Topic" varchar(100) NOT NULL,
  "Message" varchar(500) NULL,
  "Status" varchar(10) NOT NULL DEFAULT 'Requested',
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  "RespondedAt" timestamptz NULL,
  CONSTRAINT "Check_MentorshipRequests_Different" CHECK ("MenteeUserId" <> "MentorUserId"),
  CONSTRAINT "Check_MentorshipRequests_Status" CHECK ("Status" IN ('Requested','Accepted','Declined','Completed','Withdrawn'))
);


CREATE TABLE "Alumni"."JobPostings"
(
  "JobPostingId" SERIAL NOT NULL PRIMARY KEY,
  "PostedByUserId" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  "CompanyName" varchar(150) NOT NULL,
  "Title" varchar(150) NOT NULL,
  "Description" text NULL,
  "Location" varchar(100) NULL,
  "EmploymentType" varchar(15) NOT NULL,
  "ApplyUrl" varchar(300) NULL,
  "Status" varchar(10) NOT NULL DEFAULT 'Pending',
  "ApprovedBy" integer NULL REFERENCES "Common"."Users"("UserId"),
  "ExpiresOn" date NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Check_JobPostings_EmploymentType" CHECK ("EmploymentType" IN ('FullTime','Internship','Contract','PartTime')),
  CONSTRAINT "Check_JobPostings_Status" CHECK ("Status" IN ('Pending','Approved','Rejected','Expired'))
);


CREATE TABLE "Alumni"."Events"
(
  "EventId" SERIAL NOT NULL PRIMARY KEY,
  "Title" varchar(200) NOT NULL,
  "EventType" varchar(20) NOT NULL,
  "StartsAt" timestamptz NOT NULL,
  "EndsAt" timestamptz NOT NULL,
  "Venue" varchar(200) NULL,
  "OnlineUrl" varchar(300) NULL,
  "Capacity" integer NULL,
  "RegistrationOpensAt" timestamptz NULL,
  "RegistrationClosesAt" timestamptz NULL,
  "FeePaise" bigint NOT NULL DEFAULT 0,
  "IsCancelled" boolean NOT NULL DEFAULT false,
  "CreatedBy" integer NOT NULL REFERENCES "Common"."Users"("UserId"),
  CONSTRAINT "Check_Events_Dates" CHECK ("EndsAt" > "StartsAt"),
  CONSTRAINT "Check_Events_Capacity" CHECK ("Capacity" IS NULL OR "Capacity" > 0),
  CONSTRAINT "Check_Events_FeePaise" CHECK ("FeePaise" >= 0)
);


CREATE TABLE "Alumni"."EventRegistrations"
(
  "EventRegistrationId" SERIAL NOT NULL PRIMARY KEY,
  "RegistrationNo" varchar(20) NOT NULL,
  "EventId" integer NOT NULL REFERENCES "Alumni"."Events"("EventId"),
  "UserId" integer NULL REFERENCES "Common"."Users"("UserId"),
  "FullName" varchar(150) NOT NULL,
  "Email" varchar(150) NOT NULL,
  "TicketCode" char(12) NOT NULL,
  "Status" varchar(12) NOT NULL DEFAULT 'Registered',
  "WaitlistPosition" integer NULL,
  "PaymentOrderId" integer NULL REFERENCES "Payments"."PaymentOrders"("PaymentOrderId"),
  "CheckedInAt" timestamptz NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_EventRegistrations_RegistrationNo" UNIQUE ("RegistrationNo"),
  CONSTRAINT "Unique_EventRegistrations_TicketCode" UNIQUE ("TicketCode"),
  CONSTRAINT "Check_EventRegistrations_Status" CHECK ("Status" IN ('Registered','Waitlisted','Cancelled','CheckedIn','NoShow'))
);

CREATE UNIQUE INDEX "Unique_EventRegistrations_OnePerEmail"
  ON "Alumni"."EventRegistrations" ("EventId", lower("Email"))
  WHERE "Status" <> 'Cancelled';


CREATE TABLE "Alumni"."DonationCampaigns"
(
  "DonationCampaignId" SERIAL NOT NULL PRIMARY KEY,
  "CampaignCode" varchar(30) NOT NULL,
  "Title" varchar(200) NOT NULL,
  "Description" text NULL,
  "TargetPaise" bigint NULL,
  "StartsOn" date NOT NULL,
  "EndsOn" date NULL,
  "Is80GEligible" boolean NOT NULL DEFAULT false,
  "IsActive" boolean NOT NULL DEFAULT true,
  CONSTRAINT "Unique_DonationCampaigns_CampaignCode" UNIQUE ("CampaignCode"),
  CONSTRAINT "Check_DonationCampaigns_TargetPaise" CHECK ("TargetPaise" IS NULL OR "TargetPaise" > 0)
);


CREATE TABLE "Alumni"."Donations"
(
  "DonationId" SERIAL NOT NULL PRIMARY KEY,
  "DonationCampaignId" integer NOT NULL REFERENCES "Alumni"."DonationCampaigns"("DonationCampaignId"),
  "DonorUserId" integer NULL REFERENCES "Common"."Users"("UserId"),
  "PaymentOrderId" integer NOT NULL REFERENCES "Payments"."PaymentOrders"("PaymentOrderId"),
  "AmountPaise" bigint NOT NULL,
  "IsAnonymous" boolean NOT NULL DEFAULT false,
  "DonorName" varchar(150) NULL,
  "Receipt80GNo" varchar(24) NULL,
  "Message" varchar(500) NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "Unique_Donations_PaymentOrderId" UNIQUE ("PaymentOrderId"),
  CONSTRAINT "Unique_Donations_Receipt80GNo" UNIQUE ("Receipt80GNo"),
  CONSTRAINT "Check_Donations_AmountPaise" CHECK ("AmountPaise" > 0)
);


-- =====================================================================
-- AUDIT: append-only log (no foreign keys, so it can never block a write)
-- =====================================================================

CREATE TABLE "Audit"."AuditLog"
(
  "AuditLogId" BIGSERIAL NOT NULL PRIMARY KEY,
  "OccurredAt" timestamptz NOT NULL DEFAULT now(),
  "ActorUserId" integer NULL,
  "ActorType" varchar(15) NOT NULL DEFAULT 'User',
  "Action" varchar(80) NOT NULL,
  "EntityType" varchar(60) NOT NULL,
  "EntityId" varchar(60) NOT NULL,
  "Summary" text NULL,
  "Diff" jsonb NULL,
  "RequestId" uuid NULL,
  CONSTRAINT "Check_AuditLog_ActorType" CHECK ("ActorType" IN ('User','System','ApiClient','Cms'))
);


-- =====================================================================
-- INDEXES for the most common lookups
-- =====================================================================

CREATE INDEX "Index_OtpChallenges_SubjectPurpose" ON "Common"."OtpChallenges" ("SubjectHash", "Purpose", "CreatedAt" DESC);
CREATE INDEX "Index_ConsentRecords_UserPurpose" ON "Common"."ConsentRecords" ("UserId", "ConsentPurposeId", "OccurredAt" DESC);
CREATE INDEX "Index_Notifications_Pending" ON "Common"."Notifications" ("Status", "ScheduledFor") WHERE "Status" IN ('Queued','Failed');
CREATE INDEX "Index_OutboxEvents_Unpublished" ON "Common"."OutboxEvents" ("CreatedAt") WHERE "PublishedAt" IS NULL;

CREATE INDEX "Index_Leads_StatusAssigned" ON "Admission"."Leads" ("Status", "AssignedTo");
CREATE INDEX "Index_Applications_StatusProgramme" ON "Admission"."Applications" ("Status", "ProgrammeId", "AcademicYear");
CREATE INDEX "Index_Applications_Reviewer" ON "Admission"."Applications" ("AssignedReviewerId", "Status");
CREATE INDEX "Index_Documents_Application" ON "Admission"."Documents" ("ApplicationId", "DocumentTypeId");
CREATE INDEX "Index_ApplicationStatusHistory_Application" ON "Admission"."ApplicationStatusHistory" ("ApplicationId", "CreatedAt");

CREATE INDEX "Index_PaymentOrders_Payer" ON "Payments"."PaymentOrders" ("PayerUserId", "Status");
CREATE INDEX "Index_PaymentOrders_Reference" ON "Payments"."PaymentOrders" ("ReferenceType", "ReferenceId");
CREATE INDEX "Index_PaymentOrders_Pending" ON "Payments"."PaymentOrders" ("ExpiresAt") WHERE "Status" IN ('Created','Pending');

CREATE INDEX "Index_CourseRegistrations_Course" ON "Student"."CourseRegistrations" ("SemesterCourseId");
CREATE INDEX "Index_AttendanceRecords_Student" ON "Student"."AttendanceRecords" ("StudentId");
CREATE INDEX "Index_ServiceRequests_StatusAssigned" ON "Student"."ServiceRequests" ("Status", "AssignedTo");

CREATE INDEX "Index_AlumniProfiles_Directory" ON "Alumni"."AlumniProfiles" ("GraduationYear", "ProgrammeId") WHERE "DirectoryOptIn" = true;
CREATE INDEX "Index_EventRegistrations_Event" ON "Alumni"."EventRegistrations" ("EventId", "Status");

CREATE INDEX "Index_AuditLog_Entity" ON "Audit"."AuditLog" ("EntityType", "EntityId", "OccurredAt" DESC);
CREATE INDEX "Index_AuditLog_Actor" ON "Audit"."AuditLog" ("ActorUserId", "OccurredAt" DESC);


-- =====================================================================
-- OPTIONAL: make the audit log insert-only for the application role
-- (replace app_user with your application database role)
-- =====================================================================
-- REVOKE UPDATE, DELETE, TRUNCATE ON "Audit"."AuditLog" FROM app_user;
-- GRANT INSERT, SELECT ON "Audit"."AuditLog" TO app_user;
