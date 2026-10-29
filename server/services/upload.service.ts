import { randomUUID } from 'node:crypto';
import { db } from '../db/database.ts';

export type UploadSessionState =
  | 'pending' | 'uploading' | 'completed' | 'finalizing'
  | 'finalized' | 'failed' | 'expired' | 'cancelled';
export type VerificationStatus = 'pending' | 'verified' | 'mismatch' | 'failed';

export interface UploadSession {
  id: string;
  ownerId: number;
  filename: string;
  expectedSize: number;
  actualSize: number | null;
  mime: string;
  tempKey: string | null;
  finalKey: string | null;
  state: UploadSessionState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  checksumExpected: string | null;
  checksumActual: string | null;
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
  finalizedVideoId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CreateUploadSessionInput {
  id?: string;
  ownerId: number;
  filename: string;
  expectedSize: number;
  mime: string;
  expiresAt: string;
  tempKey?: string | null;
  checksumExpected?: string | null;
}

/** Keep client-provided names useful while preventing oversized metadata values. */
export const MAX_UPLOAD_FILENAME_LENGTH = 255;

export function normalizeUploadFilename(value: string | null | undefined): string {
  const raw = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  // Browsers may submit a path (especially older clients); only retain the name.
  const basename = raw.replace(/\\/g, '/').split('/').pop() || '';
  if (!basename) return '';
  if (Array.from(basename).length <= MAX_UPLOAD_FILENAME_LENGTH) return basename;

  const extension = basename.lastIndexOf('.') > 0 ? basename.slice(basename.lastIndexOf('.')) : '';
  const stem = extension ? basename.slice(0, -extension.length) : basename;
  const available = Math.max(1, MAX_UPLOAD_FILENAME_LENGTH - Array.from(extension).length);
  return `${Array.from(stem).slice(0, available).join('')}${Array.from(extension).slice(0, MAX_UPLOAD_FILENAME_LENGTH - available).join('')}`;
}

export type UploadSessionUpdate = Partial<Pick<UploadSession,
  'actualSize' | 'tempKey' | 'finalKey' | 'state' | 'expiresAt' |
  'checksumActual' | 'verificationStatus' | 'verifiedAt' | 'finalizedVideoId' |
  'errorCode' | 'errorMessage'>>;

export interface UploadFinishInput {
  expectedChecksum: string | null;
  actualChecksum: string;
  actualSize: number;
  existingState?: UploadSessionState;
}

export interface UploadFinishDecision {
  idempotent: boolean;
  state: UploadSessionState;
  verificationStatus: VerificationStatus;
  verified: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

const SESSION_COLUMNS = `
  id, owner_id as ownerId, filename, expected_size as expectedSize,
  actual_size as actualSize, mime, temp_key as tempKey, final_key as finalKey,
  state, created_at as createdAt, updated_at as updatedAt, expires_at as expiresAt,
  checksum_expected as checksumExpected, checksum_actual as checksumActual,
  verification_status as verificationStatus, verified_at as verifiedAt,
  finalized_video_id as finalizedVideoId, error_code as errorCode, error_message as errorMessage
`;

export function validateCreateUploadSessionInput(input: CreateUploadSessionInput): void {
  if (!Number.isInteger(input.ownerId) || input.ownerId <= 0) throw new Error('ownerId must be a positive integer');
  if (!normalizeUploadFilename(input.filename)) throw new Error('filename is required');
  if (!Number.isSafeInteger(input.expectedSize) || input.expectedSize < 0) throw new Error('expectedSize must be a non-negative safe integer');
  if (!input.mime.trim() || input.mime.length > 255) throw new Error('mime is required and must be at most 255 characters');
  if (Number.isNaN(Date.parse(input.expiresAt))) throw new Error('expiresAt must be an ISO date');
}

export function createUploadSession(input: CreateUploadSessionInput): UploadSession {
  validateCreateUploadSessionInput(input);
  const filename = normalizeUploadFilename(input.filename);
  const id = input.id || randomUUID();
  if (!/^[a-f0-9-]{16,64}$/i.test(id)) throw new Error('id must be a safe upload-session identifier');
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO upload_sessions (id, owner_id, filename, expected_size, mime, temp_key, expires_at, checksum_expected, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
     [id, input.ownerId, filename, input.expectedSize, input.mime, input.tempKey ?? null, input.expiresAt, input.checksumExpected ?? null, now, now]
  );
  return getUploadSession(input.ownerId, id)!;
}

/** Create the durable record for a transport upload, or safely refresh its metadata. */
export function upsertUploadSession(input: CreateUploadSessionInput): UploadSession {
  validateCreateUploadSessionInput(input);
  const filename = normalizeUploadFilename(input.filename);
  const id = input.id || randomUUID();
  if (!/^[a-f0-9-]{16,64}$/i.test(id)) throw new Error('id must be a safe upload-session identifier');
  const now = new Date().toISOString();
  const existing = db.queryOne<{ ownerId: number }>('SELECT owner_id as ownerId FROM upload_sessions WHERE id = ?', [id]);
  if (existing && existing.ownerId !== input.ownerId) throw new Error('upload session belongs to another owner');
  db.run(
    `INSERT INTO upload_sessions (id, owner_id, filename, expected_size, mime, temp_key, expires_at, checksum_expected, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET filename = excluded.filename, expected_size = excluded.expected_size,
       mime = excluded.mime, temp_key = COALESCE(upload_sessions.temp_key, excluded.temp_key),
       expires_at = excluded.expires_at, checksum_expected = COALESCE(upload_sessions.checksum_expected, excluded.checksum_expected),
       updated_at = excluded.updated_at`,
     [id, input.ownerId, filename, input.expectedSize, input.mime, input.tempKey ?? null, input.expiresAt, input.checksumExpected ?? null, now, now]
  );
  return getUploadSession(input.ownerId, id)!;
}

export function getUploadSession(ownerId: number, id: string): UploadSession | null {
  return db.queryOne<UploadSession>(`SELECT ${SESSION_COLUMNS} FROM upload_sessions WHERE id = ? AND owner_id = ?`, [id, ownerId]);
}

export function isUploadSessionOwner(session: Pick<UploadSession, 'ownerId'> | null, ownerId: number): boolean {
  return !!session && session.ownerId === ownerId;
}

/** Owner-agnostic lookup, used only by background cleanup and finalization idempotency. */
export function getUploadSessionById(id: string): UploadSession | null {
  return db.queryOne<UploadSession>(`SELECT ${SESSION_COLUMNS} FROM upload_sessions WHERE id = ?`, [id]);
}

export function getExpiredUploadSessions(nowIso: string, limit = 250): UploadSession[] {
  return db.query<UploadSession>(
    `SELECT ${SESSION_COLUMNS} FROM upload_sessions WHERE expires_at < ? ORDER BY expires_at ASC LIMIT ?`,
    [nowIso, limit]
  );
}

export function deleteUploadSession(id: string): void {
  db.run('DELETE FROM upload_sessions WHERE id = ?', [id]);
}

/** Records that an upload is now a video; repeated finalize calls stay idempotent. */
export function markUploadFinalized(ownerId: number, id: string, videoId: number, finalKey: string): UploadSession | null {
  return updateUploadSession(ownerId, id, {
    state: 'finalized',
    finalizedVideoId: videoId,
    finalKey,
    errorCode: null,
    errorMessage: null,
  });
}

export function decideUploadFinish(input: UploadFinishInput): UploadFinishDecision {
  const verified = !input.expectedChecksum || input.expectedChecksum === input.actualChecksum;
  const mismatch = !!input.expectedChecksum && !verified;
  const idempotent = (input.existingState === 'completed' || input.existingState === 'finalized') && !mismatch;
  return {
    idempotent,
    state: mismatch ? 'failed' : input.existingState === 'finalized' ? 'finalized' : 'completed',
    verificationStatus: mismatch ? 'mismatch' : input.expectedChecksum ? 'verified' : 'pending',
    verified,
    errorCode: mismatch ? 'CHECKSUM_MISMATCH' : null,
    errorMessage: mismatch ? 'Uploaded bytes did not match the expected SHA-256 checksum.' : null,
  };
}

export function updateUploadSession(ownerId: number, id: string, update: UploadSessionUpdate): UploadSession | null {
  const fields: Record<string, unknown> = {
    actualSize: update.actualSize, tempKey: update.tempKey, finalKey: update.finalKey,
    state: update.state, expiresAt: update.expiresAt, checksumActual: update.checksumActual,
    verificationStatus: update.verificationStatus, verifiedAt: update.verifiedAt,
    finalizedVideoId: update.finalizedVideoId, errorCode: update.errorCode,
    errorMessage: update.errorMessage == null ? update.errorMessage : update.errorMessage.slice(0, 1000),
  };
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return getUploadSession(ownerId, id);
  const columnNames: Record<string, string> = {
    actualSize: 'actual_size', tempKey: 'temp_key', finalKey: 'final_key', state: 'state',
    expiresAt: 'expires_at', checksumActual: 'checksum_actual', verificationStatus: 'verification_status',
    verifiedAt: 'verified_at', finalizedVideoId: 'finalized_video_id', errorCode: 'error_code', errorMessage: 'error_message',
  };
  const setClause = entries.map(([key]) => `${columnNames[key]} = ?`).join(', ');
  db.run(`UPDATE upload_sessions SET ${setClause}, updated_at = ? WHERE id = ? AND owner_id = ?`, [
    ...entries.map(([, value]) => value), new Date().toISOString(), id, ownerId,
  ]);
  return getUploadSession(ownerId, id);
}
