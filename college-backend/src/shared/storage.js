import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.env.UPLOAD_DIR || 'uploads');

export async function saveFile(key, buffer) {
  const full = path.join(ROOT, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buffer);
}

// Detect the real file type from its first bytes
export function sniffMime(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}