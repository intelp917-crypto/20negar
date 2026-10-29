/**
 * «دفترچهٔ ادامهٔ آپلود»
 * -------------------------------------------------------------------
 * روی اینترنت ناپایدار، دو اتفاق رایج است:
 *  ۱) وسط ارسال، اینترنت قطع/وصل می‌شود.
 *  ۲) همهٔ بایت‌ها رسیده‌اند ولی پاسخ «ثبت ویدیو» به مرورگر برنگشته است.
 * در هر دو حالت کاربر نباید فایل چند گیگابایتی را دوباره بفرستد.
 *
 * tus-js-client خودش آدرس آپلود را برای ادامهٔ انتقال در localStorage نگه
 * می‌دارد؛ این فایل یک لایهٔ دوم است: «شناسهٔ آپلودِ کامل‌شده ولی ثبت‌نشده»
 * را نگه می‌دارد تا اگر کاربر همان فایل را دوباره انتخاب کرد، فقط مرحلهٔ
 * ثبت در سرور تکرار شود (بدون ارسال یک بایت).
 */

export interface UploadCheckpoint {
  fingerprint: string;
  uploadId: string;
  name: string;
  size: number;
  lastModified: number;
  createdAt: number;
}

const STORAGE_KEY = '20negar_upload_checkpoints_v1';
export const CHECKPOINT_TTL_MS = 48 * 60 * 60 * 1000;

export type CheckpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): CheckpointStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null; // حالت خصوصی/مسدود
  }
}

export function fileFingerprint(file: { name: string; size: number; lastModified: number; type?: string }): string {
  return `${file.name}|${file.size}|${file.lastModified}|${file.type || ''}`;
}

export function readCheckpoints(storage?: CheckpointStorage | null, now = Date.now()): Record<string, UploadCheckpoint> {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, UploadCheckpoint>;
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, UploadCheckpoint> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value.uploadId !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(value.uploadId)) continue;
      if (!Number.isFinite(value.createdAt) || now - value.createdAt > CHECKPOINT_TTL_MS) continue;
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function writeCheckpoints(entries: Record<string, UploadCheckpoint>, storage?: CheckpointStorage | null): void {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return;
  try {
    if (Object.keys(entries).length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // حافظهٔ مرورگر پر/مسدود است؛ ادامهٔ آپلود بدون دفترچه هم کار می‌کند.
  }
}

export function saveCheckpoint(
  file: { name: string; size: number; lastModified: number; type?: string },
  uploadId: string,
  storage?: CheckpointStorage | null,
  now = Date.now()
): void {
  const fingerprint = fileFingerprint(file);
  const entries = readCheckpoints(storage, now);
  entries[fingerprint] = {
    fingerprint,
    uploadId,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    createdAt: now,
  };
  writeCheckpoints(entries, storage);
}

export function getCheckpoint(
  file: { name: string; size: number; lastModified: number; type?: string },
  storage?: CheckpointStorage | null,
  now = Date.now()
): UploadCheckpoint | null {
  return readCheckpoints(storage, now)[fileFingerprint(file)] || null;
}

export function clearCheckpoint(
  fileOrFingerprint: { name: string; size: number; lastModified: number; type?: string } | string,
  storage?: CheckpointStorage | null,
  now = Date.now()
): void {
  const fingerprint = typeof fileOrFingerprint === 'string' ? fileOrFingerprint : fileFingerprint(fileOrFingerprint);
  const entries = readCheckpoints(storage, now);
  if (!entries[fingerprint]) return;
  delete entries[fingerprint];
  writeCheckpoints(entries, storage);
}
