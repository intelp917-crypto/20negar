import fs from 'fs';
import path from 'path';
import { STORAGE_DIR, UPLOAD_SESSION_TTL_MS } from '../config.ts';
import {
  deleteUploadSession,
  getExpiredUploadSessions,
  getUploadSession,
  getUploadSessionById,
  markUploadFinalized,
  updateUploadSession,
  UploadSession,
} from './upload.service.ts';
import {
  cleanupSession as cleanupChunkSession,
  dataFile as chunkDataFile,
  loadSession as loadChunkSession,
} from '../routes/upload.routes.ts';

/**
 * «آخرین مرحله» آپلود: تبدیل بایت‌های تأییدشده به یک ویدیو.
 * ------------------------------------------------------------------
 * فایل TUS پس از پایان آپلود جابه‌جا نمی‌شود؛ سرور فقط وضعیت «کامل» را
 * ثبت می‌کند. این کار یک مزیت مهم دارد: اگر پاسخ ۲۰۴ آخر به دلیل قطعی
 * اینترنت به مرورگر نرسد، کلاینت با HEAD می‌بیند offset == length و همان
 * آپلود را موفق می‌داند (بدون ارسال دوبارهٔ چند گیگابایت).
 * جابه‌جایی واقعی فایل دقیقاً یک‌بار و هنگام ساخت رکورد ویدیو انجام می‌شود.
 *
 * همه مسیرهای آپلود (TUS و چانکی قدیمی) از همین یک تابع resolve عبور می‌کنند
 * تا هیچ مسیری بدون بررسی مالکیت/حجم/وضعیت به فایل دسترسی نداشته باشد.
 */

export const TUS_DIR = path.resolve(STORAGE_DIR, 'temp', 'tus');
export const TUS_META_SUFFIX = '.json';
const SAFE_UPLOAD_ID = /^[a-f0-9-]{16,64}$/i;

export interface ResolvedUpload {
  uploadId: string;
  /** مسیر فیزیکی فایل آمادهٔ انتقال؛ برای آپلودهای قبلاً نهایی‌شده خالی است. */
  tempPath: string;
  originalName: string;
  size: number;
  mime: string;
  /** اگر مقدار داشته باشد، کار تمام است و فقط باید همان ویدیو برگردانده شود. */
  alreadyFinalizedVideoId: number | null;
}

function isInsideStorage(filePath: string): boolean {
  const relative = path.relative(STORAGE_DIR, filePath);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

/** مسیر امن فایل دادهٔ TUS؛ هر شناسه‌ای که از قاعده خارج شود رد می‌شود. */
export function tusDataPath(uploadId: string): string | null {
  if (!SAFE_UPLOAD_ID.test(uploadId)) return null;
  const full = path.resolve(TUS_DIR, uploadId);
  return isInsideStorage(full) ? full : null;
}

export function tusMetaPath(uploadId: string): string | null {
  const data = tusDataPath(uploadId);
  return data ? `${data}${TUS_META_SUFFIX}` : null;
}

/** کلید نسبی داخل STORAGE_DIR را به مسیر فیزیکی امن تبدیل می‌کند. */
export function resolveStorageKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const full = path.resolve(STORAGE_DIR, key);
  return isInsideStorage(full) ? full : null;
}

function safeStat(filePath: string | null): fs.Stats | null {
  if (!filePath) return null;
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

/**
 * اگر رکورد پایگاه‌داده به هر دلیلی «کامل» ثبت نشده باشد ولی فایل و
 * متادیتای TUS می‌گویند آپلود تمام شده است، همان‌جا وضعیت را ترمیم می‌کنیم.
 * (مثلاً سرور بین نوشتن آخرین چانک و به‌روزرسانی رکورد ری‌استارت شده باشد.)
 */
function reconcileCompletedTus(session: UploadSession): boolean {
  const dataPath = tusDataPath(session.id);
  const stat = safeStat(dataPath);
  if (!dataPath || !stat) return false;

  let sidecarSize = Number.NaN;
  try {
    const sidecar = JSON.parse(fs.readFileSync(`${dataPath}${TUS_META_SUFFIX}`, 'utf8'));
    sidecarSize = Number(sidecar?.size);
  } catch {
    return false;
  }

  if (!Number.isFinite(sidecarSize) || sidecarSize <= 0) return false;
  if (stat.size !== sidecarSize || stat.size !== session.expectedSize) return false;

  updateUploadSession(session.ownerId, session.id, {
    state: 'completed',
    actualSize: stat.size,
    tempKey: path.relative(STORAGE_DIR, dataPath).replace(/\\/g, '/'),
    errorCode: null,
    errorMessage: null,
  });
  console.warn(`[Upload] Reconciled completed TUS upload ${session.id} (${stat.size} bytes).`);
  return true;
}

/**
 * منبع فایل یک آپلود کامل‌شده را برمی‌گرداند یا null وقتی هنوز آماده نیست.
 * فقط مالک آپلود (یا مسیرهای داخلی که ownerId را خودشان تعیین می‌کنند) می‌تواند
 * به این تابع برسد.
 */
export function resolveCompletedUpload(uploadId: string, ownerId: number): ResolvedUpload | null {
  if (!SAFE_UPLOAD_ID.test(uploadId)) return null;

  const session = getUploadSession(ownerId, uploadId);
  if (session) {
    if (session.finalizedVideoId) {
      return {
        uploadId,
        tempPath: '',
        originalName: session.filename,
        size: session.actualSize ?? session.expectedSize,
        mime: session.mime,
        alreadyFinalizedVideoId: session.finalizedVideoId,
      };
    }

    const completed = session.state === 'completed' || reconcileCompletedTus(session);
    if (completed) {
      const tempPath =
        resolveStorageKey(session.tempKey) ?? tusDataPath(uploadId);
      const stat = safeStat(tempPath);
      const size = session.actualSize ?? session.expectedSize;
      if (tempPath && stat && stat.size === size && stat.size > 0) {
        return {
          uploadId,
          tempPath,
          originalName: session.filename,
          size,
          mime: session.mime,
          alreadyFinalizedVideoId: null,
        };
      }
    }
  }

  // مسیر قدیمی چانکی: نشست‌های JSON در temp/chunked (سازگاری با آپلودهای در جریان).
  const legacy = loadChunkSession(uploadId);
  if (!legacy || legacy.userId !== ownerId) return null;
  if (legacy.received.length !== legacy.totalChunks) return null;
  for (let index = 0; index < legacy.totalChunks; index++) {
    if (!legacy.received.includes(index)) return null;
  }
  const legacyPath = chunkDataFile(uploadId);
  const legacyStat = safeStat(legacyPath);
  if (!legacyStat || legacyStat.size !== legacy.fileSize) return null;

  return {
    uploadId,
    tempPath: legacyPath,
    originalName: legacy.originalName,
    size: legacy.fileSize,
    mime: legacy.mimeType,
    alreadyFinalizedVideoId: null,
  };
}

/** فایل‌های موقت یک آپلود را بعد از انتقال موفق پاک می‌کند. */
export function cleanupUploadArtifacts(uploadId: string): void {
  for (const file of [tusDataPath(uploadId), tusMetaPath(uploadId)]) {
    if (!file) continue;
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  }
  try {
    cleanupChunkSession(uploadId);
  } catch {}
}

/** ثبت نهایی: ویدیو ساخته شد، پس این آپلود دیگر قابل استفادهٔ دوباره نیست. */
export function completeUploadFinalization(ownerId: number, uploadId: string, videoId: number, finalKey: string): void {
  try {
    markUploadFinalized(ownerId, uploadId, videoId, finalKey);
  } catch (err: any) {
    console.warn('[Upload] Could not mark upload session finalized:', err?.message || err);
  }
}

function unlinkQuietly(filePath: string | null): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

/**
 * پاک‌سازی دوره‌ای: نشست‌های منقضی، فایل‌های TUS بی‌صاحب و بقایای چانکی.
 * ملاک اصلی، رکورد پایگاه‌داده است تا آپلود در حال انجام هرگز حذف نشود.
 */
export function cleanupExpiredUploads(): void {
  const now = Date.now();
  try {
    for (const session of getExpiredUploadSessions(new Date(now).toISOString())) {
      cleanupUploadArtifacts(session.id);
      deleteUploadSession(session.id);
    }
  } catch (err: any) {
    console.warn('[Upload] Expired session cleanup failed:', err?.message || err);
  }

  try {
    for (const entry of fs.readdirSync(TUS_DIR)) {
      const id = entry.endsWith(TUS_META_SUFFIX) ? entry.slice(0, -TUS_META_SUFFIX.length) : entry;
      if (getUploadSessionById(id)) continue;
      const full = path.join(TUS_DIR, entry);
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > UPLOAD_SESSION_TTL_MS) fs.unlinkSync(full);
      } catch {}
    }
  } catch {}

  try {
    const chunkDir = path.resolve(STORAGE_DIR, 'temp', 'chunked');
    if (fs.existsSync(chunkDir)) {
      for (const entry of fs.readdirSync(chunkDir)) {
        const id = entry.replace(/\.(json|data)$/, '');
        if (getUploadSessionById(id)) continue;
        const full = path.join(chunkDir, entry);
        try {
          const stat = fs.statSync(full);
          if (now - stat.mtimeMs > UPLOAD_SESSION_TTL_MS) fs.unlinkSync(full);
        } catch {}
      }
    }
  } catch {}

}
