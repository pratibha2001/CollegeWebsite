import crypto from 'node:crypto';
import pool from '../../config/db.js';
import { saveFile, sniffMime } from '../../shared/storage.js';

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

export async function uploadDocument({ userId, applicationId, typeCode, file }) {
  if (!file) throw httpError(400, 'file is required');
  const client = await pool.connect();
  try {
    await client.query('begin');

    const app = await client.query(
      `select "Status" from "Admission"."Applications"
       where "ApplicationId" = $1 and "ApplicantUserId" = $2
       for update`,
      [applicationId, userId]
    );
    if (app.rows.length === 0) throw httpError(404, 'Application not found');
    if (app.rows[0].Status !== 'Draft') throw httpError(409, 'This application can no longer be edited');

    const type = await client.query(
      `select "DocumentTypeId", "AllowedMimeTypes", "MaxBytes"
       from "Admission"."DocumentTypes" where "TypeCode" = $1 and "IsActive"`,
      [typeCode]
    );
    if (type.rows.length === 0) throw httpError(400, 'Unknown document type');
    const { DocumentTypeId, AllowedMimeTypes, MaxBytes } = type.rows[0];

    if (file.size > MaxBytes) throw httpError(400, `File too large (max ${Math.round(MaxBytes / 1024)} KB)`);
    const mime = sniffMime(file.buffer);
    if (!mime || !AllowedMimeTypes.includes(mime)) {
      throw httpError(400, `Allowed types: ${AllowedMimeTypes.join(', ')}`);
    }

    const key = `applications/${applicationId}/${crypto.randomUUID()}.${EXT[mime]}`;
    const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
    await saveFile(key, file.buffer);

    const doc = await client.query(
      `insert into "Admission"."Documents"
         ("OwnerUserId", "ApplicationId", "DocumentTypeId", "OriginalFileName",
          "StorageKey", "MimeType", "SizeBytes", "ChecksumSha256")
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning "DocumentId"`,
      [userId, applicationId, DocumentTypeId, file.originalname.slice(0, 255),
       key, mime, file.size, checksum]
    );
    const documentId = doc.rows[0].DocumentId;

    // the older file of the same type is kept for history but marked as replaced
    await client.query(
      `update "Admission"."Documents"
       set "ReplacedByDocumentId" = $1, "DeletedAt" = now()
       where "ApplicationId" = $2 and "DocumentTypeId" = $3
         and "DocumentId" <> $1 and "DeletedAt" is null`,
      [documentId, applicationId, DocumentTypeId]
    );

    await client.query('commit');
    return { documentId, typeCode, sizeBytes: file.size };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}