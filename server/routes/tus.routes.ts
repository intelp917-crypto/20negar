import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'node:crypto';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { authenticate, requireRole, AuthenticatedUser } from '../middleware/auth.middleware.ts';
import { AuthService, UserRole } from '../services/auth.service.ts';
import { STORAGE_DIR, MAX_UPLOAD_FILE_SIZE, UPLOAD_SESSION_TTL_MS } from '../config.ts';
import {
  getUploadSession,
  isUploadSessionOwner,
  normalizeUploadFilename,
  updateUploadSession,
  upsertUploadSession,
} from '../services/upload.service.ts';
import {
  cleanupExpiredUploads,
  TUS_DIR,
  tusDataPath,
} from '../services/upload-finalize.service.ts';

/**
 * موتور آپلود TUS (tus.io) — نسخهٔ مقاوم برای اینترنت ناپایدار
 * -------------------------------------------------------------------
 *  - تکه‌های کوچک‌تر از سمت کلاینت، با ادامهٔ خودکار از بایت تأییدشده
 *  - هیچ جابه‌جایی/هش‌کردن سنگینی در پایان PATCH انجام نمی‌شود؛ پاسخ ۲۰۴
 *    بلافاصله برمی‌گردد تا کلاینت و سرور هر دو سریع از مرحلهٔ ارسال خارج شوند
 *  - اگر پاسخ آخرین PATCH گم شود، HEAD همان آپلود را «کامل» می‌بیند و کلاینت
 *    مجبور به آپلود دوبارهٔ فایل نمی‌شود (فایل تا زمان ساخت ویدیو سر جایش می‌ماند)
 *  - SHA-256 فقط وقتی محاسبه می‌شود که کلاینت واقعاً مقداری فرستاده باشد
 *  - خطاهای پایان آپلود به کلاینت برمی‌گردند (نه اینکه بی‌صدا بلعیده شوند)
 *  - مالکیت هر درخواست (CREATE/HEAD/PATCH) سمت سرور بررسی می‌شود
 */

const MAX_FILE_SIZE = MAX_UPLOAD_FILE_SIZE;
const MIN_FREE_RESERVE = 256 * 1024 * 1024; // ۲۵۶ مگابایت حاشیهٔ امن دیسک
const UPLOAD_ROLES: UserRole[] = ['Editor', 'Cameraman', 'SuperAdmin', 'Admin'];

fs.mkdirSync(TUS_DIR, { recursive: true });

/** خطای کنترل‌شده با کد و پیام فارسی (توسط @tus/server به کلاینت برمی‌گردد) */
function tusError(statusCode: number, message: string): Error {
  const err = new Error(message) as Error & { status_code?: number; body?: string };
  err.status_code = statusCode;
  err.body = JSON.stringify({ error: message });
  return err;
}

/**
 * کاربر درخواست TUS را مشخص می‌کند:
 * ۱) از `req.user` که middleware احراز هویت روی درخواست Node گذاشته
 * ۲) در صورت نبود، از هدر Authorization (Bearer token)
 */
function userFromTusRequest(req: any): AuthenticatedUser | null {
  try {
    const expressReq = req?.runtime?.node?.req;
    if (expressReq?.user) return expressReq.user as AuthenticatedUser;
    const header: string = (req?.headers?.get?.('authorization') as string) || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    return token ? AuthService.verifyToken(token) : null;
  } catch {
    return null;
  }
}

function expectedChecksum(meta: Record<string, string>): string | null {
  const value = String(meta.checksum || meta.checksumExpected || meta.sha256 || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function metadataMime(meta: Record<string, string>): string {
  const mime = String(meta.filetype || meta.fileType || meta.type || '').trim();
  return mime ? mime.slice(0, 255) : 'application/octet-stream';
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** قبل از پذیرش آپلود، از کافی‌بودن فضای دیسک مطمئن می‌شویم (خطای زودهنگام و روشن). */
function assertDiskSpace(expectedBytes: number): void {
  let available: number;
  try {
    const statfs = (fs as typeof fs & { statfsSync?: (p: string) => { bsize: number; bavail: number } }).statfsSync;
    if (!statfs) return;
    const stats = statfs(TUS_DIR);
    available = stats.bavail * stats.bsize;
  } catch {
    return; // پلتفرم پشتیبانی نمی‌کند؛ بررسی حجم فایل در پایان انجام می‌شود
  }
  if (available > 0 && available < expectedBytes + MIN_FREE_RESERVE) {
    throw tusError(507, 'فضای دیسک سرور برای این حجم کافی نیست. لطفاً با مدیر سیستم تماس بگیرید.');
  }
}

/**
 * پاک‌سازی: فقط نشست‌های منقضی و فایل‌های بی‌صاحب حذف می‌شوند. آپلود در
 * جریان (دارای رکورد معتبر) هرگز وسط کار پاک نمی‌شود.
 */
// اجرای اول کمی بعد از بالا آمدن سرور (پایگاه‌داده باید initialize شده باشد).
setTimeout(cleanupExpiredUploads, 45_000).unref?.();
setInterval(cleanupExpiredUploads, 30 * 60 * 1000).unref?.();

export const tusServer = new TusServer({
  path: '/api/tus',
  datastore: new FileStore({ directory: TUS_DIR }),
  maxSize: MAX_FILE_SIZE,
  respectForwardedHeaders: true,
  // CORS پاسخ‌ها توسط middleware سراسری سرور انجام می‌شود تا هدر تکراری ساخته نشود
  allowedOrigins: [],

  // @tus/server for HEAD/GET/PATCH/DELETE as well as POST.
  onIncomingRequest: async (req: any, uploadId: string): Promise<void> => {
    // POST receives a newly generated ID before onUploadCreate has inserted
    // the durable row; every existing upload ID requires ownership.
    if (req.method === 'POST') return;
    const user = userFromTusRequest(req);
    if (!user) {
      throw tusError(401, 'احراز هویت الزامی است. توکن نامعتبر یا منقضی شده است.');
    }
    const session = getUploadSession(user.id, uploadId);
    if (!isUploadSessionOwner(session, user.id)) {
      throw tusError(404, 'نشست آپلود یافت نشد.');
    }
  },

  // قبل از ساخت آپلود: احراز هویت + اعتبارسنجی فرمت و حجم
  onUploadCreate: async (req: any, upload: any): Promise<{ metadata?: Record<string, string> }> => {
    const user = userFromTusRequest(req);
    if (!user) {
      throw tusError(401, 'احراز هویت الزامی است. توکن نامعتبر یا منقضی شده است.');
    }
    if (!UPLOAD_ROLES.includes(user.role)) {
      throw tusError(403, `دسترسی غیرمجاز. نقش '${user.role}' دسترسی به بارگذاری ویدیو ندارد.`);
    }

    const meta: Record<string, string> = upload.metadata || {};
    const filename = normalizeUploadFilename(meta.filename || meta.name);
    if (!filename) {
      throw tusError(400, 'نام فایل ارسال نشده است. لطفاً فایل را دوباره انتخاب کنید.');
    }

    const size = Number(upload.size);
    if (!Number.isFinite(size) || size <= 0) {
      throw tusError(400, 'فایل انتخاب‌شده خالی است.');
    }
    if (size > MAX_FILE_SIZE) {
      throw tusError(400, 'حجم فایل از سقف مجاز (۸ گیگابایت) بیشتر است.');
    }

    const checksum = expectedChecksum(meta);
    if ((meta.checksum || meta.checksumExpected || meta.sha256) && !checksum) {
      throw tusError(400, 'چک‌سام SHA-256 نامعتبر است.');
    }

    assertDiskSpace(size);

    const uploadId = String(upload.id);
    const dataPath = tusDataPath(uploadId);
    if (!dataPath) {
      throw tusError(400, 'شناسهٔ آپلود نامعتبر است.');
    }

    upsertUploadSession({
      id: uploadId,
      ownerId: user.id,
      filename,
      expectedSize: size,
      mime: metadataMime(meta),
      expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS).toISOString(),
      tempKey: path.relative(STORAGE_DIR, dataPath).replace(/\\/g, '/'),
      checksumExpected: checksum,
    });

    // مالک آپلود را سمت سرور ثبت می‌کنیم تا در پایان قابل تایید باشد
    return { metadata: { ...meta, userId: String(user.id) } };
  },

  /**
   * پایان آپلود: فقط وضعیت را «کامل» ثبت می‌کنیم. هیچ جابه‌جایی یا هش‌کردن
   * اجباری اینجا انجام نمی‌شود؛ بنابراین پاسخ ۲۰۴ حتی برای فایل ۸ گیگابایتی
   * بلافاصله برمی‌گردد و کلاینت در «۱۰۰٪» گیر نمی‌کند.
   */
  onUploadFinish: async (req: any, upload: any): Promise<{}> => {
    const uploadId = String(upload.id);
    const size = Number(upload.size);
    const offset = Number(upload.offset);

    // آپلود ناقص نیست؛ اگر نبود، اجازه بده پروتکل خودش پاسخ درست را بدهد.
    if (!size || offset !== size) return {};

    const user = userFromTusRequest(req);
    if (!user) throw tusError(401, 'احراز هویت الزامی است.');

    const durable = getUploadSession(user.id, uploadId);
    if (!durable || !isUploadSessionOwner(durable, user.id)) {
      throw tusError(404, 'نشست آپلود یافت نشد.');
    }

    // درخواست تکراری (مثلاً تکرار آخرین PATCH بعد از قطعی) — همان نتیجهٔ قبلی.
    if (durable.state === 'completed' || durable.state === 'finalized') return {};

    const dataPath = tusDataPath(uploadId);
    let actualSize = 0;
    try {
      actualSize = fs.statSync(dataPath as string).size;
    } catch {
      throw tusError(500, 'فایل آپلودشده روی سرور یافت نشد؛ لطفاً دوباره تلاش کنید.');
    }
    if (actualSize !== size) {
      updateUploadSession(user.id, uploadId, {
        state: 'failed',
        actualSize,
        errorCode: 'SIZE_MISMATCH',
        errorMessage: 'Uploaded byte count did not match the declared length.',
      });
      throw tusError(400, 'حجم فایل دریافتی با حجم اعلام‌شده مطابقت ندارد؛ لطفاً دوباره آپلود کنید.');
    }

    const expected = durable.checksumExpected || expectedChecksum(upload.metadata || {});
    if (expected) {
      const actualChecksum = await hashFile(dataPath as string);
      if (actualChecksum !== expected) {
        updateUploadSession(user.id, uploadId, {
          state: 'failed',
          actualSize,
          checksumActual: actualChecksum,
          verificationStatus: 'mismatch',
          verifiedAt: new Date().toISOString(),
          errorCode: 'CHECKSUM_MISMATCH',
          errorMessage: 'Uploaded bytes did not match the expected SHA-256 checksum.',
        });
        // خطای دائمی: تکرار همین بایت‌ها نتیجه را عوض نمی‌کند.
        throw tusError(400, 'چک‌سام فایل با مقدار مورد انتظار مطابقت ندارد؛ لطفاً فایل را دوباره ارسال کنید.');
      }
      updateUploadSession(user.id, uploadId, {
        state: 'completed',
        actualSize,
        checksumActual: actualChecksum,
        verificationStatus: 'verified',
        verifiedAt: new Date().toISOString(),
        errorCode: null,
        errorMessage: null,
      });
    } else {
      updateUploadSession(user.id, uploadId, {
        state: 'completed',
        actualSize,
        verificationStatus: 'pending',
        errorCode: null,
        errorMessage: null,
      });
    }

    // توجه: فایل داده و متادیتای جانبی TUS عمداً باقی می‌مانند تا اگر پاسخ
    // «۲۰۴» پایانی در شبکه گم شود، HEAD همان آپلود را کامل ببیند و کلاینت
    // دوباره از صفر آپلود نکند. پاک‌سازی هنگام ساخت ویدیو انجام می‌شود.

    console.log(`[TUS] Upload ${uploadId} completed (${size} bytes).`);
    return {};
  },
});

/**
 * روتر Express: احراز هویت و کنترل نقش، سپس تحویل درخواست به سرور TUS.
 * (Express مسیر mount را از req.url حذف می‌کند؛ @tus/server شناسه را از آخرین
 *  بخش مسیر می‌خواند و Location پاسخ را با path تنظیم‌شده above می‌سازد.)
 */
const router = Router();
router.use(authenticate, requireRole(UPLOAD_ROLES));
router.use((req: Request, res: Response): void => {
  tusServer.handle(req, res).catch((err: any) => {
    console.error('[TUS] handle error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'خطا در پردازش آپلود؛ لطفاً دوباره تلاش کنید.' });
    }
  });
});

export default router;
