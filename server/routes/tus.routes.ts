import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'node:crypto';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { authenticate, requireRole, AuthenticatedUser } from '../middleware/auth.middleware.ts';
import { AuthService } from '../services/auth.service.ts';
import { STORAGE_DIR } from '../config.ts';
import { createSessionFromCompletedFile } from './upload.routes.ts';
import { decideUploadFinish, getUploadSession, isUploadSessionOwner, normalizeUploadFilename, upsertUploadSession, updateUploadSession } from '../services/upload.service.ts';

/**
 * سیستم آپلود TUS (پروتکل استاندارد آپلود ازسره‌گیر — tus.io)
 * -------------------------------------------------------------------
 * پیاده‌سازی رسمی سرور TUS (@tus/server از تیم tusd/tus-node-server):
 *  - ارسال پشت‌سرهم به تکه‌های بزرگ (۱۶ مگابایتی) با تلاش مجدد خودکار
 *  - ازسره‌گیری (Resume) بعد از قطعی اینترنت یا رفرش صفحه
 *  - اعتبارسنجی سمت سرور (حجم، فرمت، احراز هویت)
 * پس از پایان آپلود، فایل به «نشست آپلود» استاندارد سیستم تبدیل می‌شود تا
 * ساخت ویدیو (POST /api/videos با uploadId) بدون تغییر انجام شود.
 */

const TUS_DIR = path.resolve(STORAGE_DIR, 'temp', 'tus');
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4 GB
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 ساعت
// همه فرمت‌های ویدیویی پذیرفته می‌شوند؛ تبدیل به فرمت استریم را FFmpeg سمت سرور انجام می‌دهد

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

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** پاک‌سازی نشست‌های نیمه‌کاره TUS که بیش از ۲۴ ساعت مانده‌اند */
function cleanupExpiredTus(): void {
  try {
    for (const f of fs.readdirSync(TUS_DIR)) {
      const full = path.join(TUS_DIR, f);
      try {
        const st = fs.statSync(full);
        if (Date.now() - st.mtimeMs > SESSION_TTL) fs.unlinkSync(full);
      } catch {}
    }
  } catch {}
}
cleanupExpiredTus();
setInterval(cleanupExpiredTus, 60 * 60 * 1000).unref?.();

export const tusServer = new TusServer({
  path: '/api/tus',
  datastore: new FileStore({ directory: TUS_DIR }),
  maxSize: MAX_FILE_SIZE,
  respectForwardedHeaders: true,
  // CORS پاسخ‌ها توسط middleware سراسری سرور انجام می‌شود تا هدر تکراری ساخته نشود
  allowedOrigins: [],

  // @tus/server invokes this for HEAD/GET/PATCH/DELETE as well as POST.
  onIncomingRequest: async (req: any, uploadId: string): Promise<void> => {
    const user = userFromTusRequest(req);
    const session = user ? getUploadSession(user.id, uploadId) : null;
    // POST receives a newly generated ID before onUploadCreate has inserted
    // the durable row; all existing upload IDs still require ownership.
    if (req.method === 'POST' && !session) return;
    if (!user || !isUploadSessionOwner(session, user.id)) {
      throw tusError(404, 'نشست آپلود یافت نشد.');
    }
  },

  // قبل از ساخت آپلود: احراز هویت + اعتبارسنجی فرمت و حجم
  onUploadCreate: async (req: any, upload: any): Promise<{ metadata?: Record<string, string> }> => {
    const user = userFromTusRequest(req);
    if (!user) {
      throw tusError(401, 'احراز هویت الزامی است. توکن نامعتبر یا منقضی شده است.');
    }
    if (user.role !== 'Editor' && user.role !== 'Cameraman' && user.role !== 'SuperAdmin' && user.role !== 'Admin') {
      throw tusError(403, `دسترسی غیرمجاز. نقش '${user.role}' دسترسی به بارگذاری ویدیو ندارد.`);
    }

    const meta: Record<string, string> = upload.metadata || {};
    const filename = normalizeUploadFilename(meta.filename);
    if (!filename) {
      throw tusError(400, 'نام فایل ارسال نشده است. لطفاً فایل را دوباره انتخاب کنید.');
    }
    if (Number(upload.size) <= 0) {
      throw tusError(400, 'فایل انتخاب‌شده خالی است.');
    }
    if (Number(upload.size) > MAX_FILE_SIZE) {
      throw tusError(400, 'حجم فایل از سقف مجاز (۴ گیگابایت) بیشتر است.');
    }

    const checksum = expectedChecksum(meta);
    if ((meta.checksum || meta.checksumExpected || meta.sha256) && !checksum) {
      throw tusError(400, 'چک‌سام SHA-256 نامعتبر است.');
    }
    upsertUploadSession({
      id: String(upload.id),
      ownerId: user.id,
      filename,
      expectedSize: Number(upload.size),
      mime: String(meta.fileType || 'video/mp4'),
      expiresAt: new Date(Date.now() + SESSION_TTL).toISOString(),
      tempKey: path.relative(STORAGE_DIR, path.join(TUS_DIR, String(upload.id))).replace(/\\/g, '/'),
      checksumExpected: checksum,
    });

    // مالک آپلود را سمت سرور ثبت می‌کنیم تا در پایان قابل تایید باشد
    return { metadata: { ...meta, userId: String(user.id) } };
  },

  // پس از پایان آپلود موفق: تبدیل فایل به نشست آپلود استاندارد سیستم
  onUploadFinish: async (req: any, upload: any): Promise<{}> => {
    try {
      const size = Number(upload.size);
      if (!size || Number(upload.offset) !== size) return {};

      const meta: Record<string, string> = upload.metadata || {};
      const user = userFromTusRequest(req);
      const userId = user?.id;
      if (!userId || Number.isNaN(userId)) {
        console.error('[TUS] Upload finished without a verifiable owner:', upload.id);
        return {};
      }

      const src = path.join(TUS_DIR, String(upload.id));
      const durable = getUploadSession(userId, String(upload.id));
      if (!durable || !isUploadSessionOwner(durable, userId)) throw tusError(404, 'نشست آپلود یافت نشد.');
      if (durable.state === 'completed' || durable.state === 'finalized') return {};
      const actualChecksum = await hashFile(src);
      const decision = decideUploadFinish({
        expectedChecksum: durable.checksumExpected || expectedChecksum(meta),
        actualChecksum,
        actualSize: size,
        existingState: durable.state,
      });
      if (decision.errorCode) {
        updateUploadSession(userId, String(upload.id), {
          state: decision.state,
          actualSize: size,
          checksumActual: actualChecksum,
          verificationStatus: decision.verificationStatus,
          verifiedAt: new Date().toISOString(),
          errorCode: decision.errorCode,
          errorMessage: decision.errorMessage,
        });
        throw tusError(400, decision.errorMessage || 'خطای اعتبارسنجی فایل.');
      }
      const sessionId = createSessionFromCompletedFile({
        // شناسه نشست = شناسه آپلود TUS تا کلاینت بتواند همان را به POST /api/videos بفرستد
        id: /^[a-f0-9]{32}$/.test(String(upload.id)) ? String(upload.id) : undefined,
        userId,
        originalName: normalizeUploadFilename(meta.filename) || 'video.mp4',
        mimeType: meta.fileType || 'video/mp4',
        fileSize: size,
        sourcePath: src,
        meta: { title: meta.title || '', supervisorId: meta.supervisorId || '' },
      });

      if (sessionId) {
        updateUploadSession(userId, String(upload.id), {
          state: decision.state,
          actualSize: size,
          checksumActual: actualChecksum,
          verificationStatus: decision.verificationStatus,
          verifiedAt: decision.verificationStatus === 'pending' ? null : new Date().toISOString(),
          finalKey: path.relative(STORAGE_DIR, path.join('temp', 'chunked', String(sessionId))).replace(/\\/g, '/'),
          errorCode: null,
          errorMessage: null,
        });
        console.log(`[TUS] Upload ${upload.id} completed (${size} bytes) → session ${sessionId}`);
      } else {
        console.error('[TUS] Failed to create upload session for', upload.id);
      }
    } catch (err: any) {
      // خطا را فقط گزارش می‌کنیم؛ فایل آپلودشده باقی می‌ماند و دوباره قابل امتحان است
      console.error('[TUS] onUploadFinish error:', err?.message || err);
    }
    return {};
  },
});

/**
 * روتر Express: احراز هویت و کنترل نقش، سپس تحویل درخواست به سرور TUS.
 * (Express مسیر mount را از req.url حذف می‌کند؛ @tus/server شناسه را از آخرین
 *  بخش مسیر می‌خواند و Location پاسخ را با path تنظیم‌شده above می‌سازد.)
 */
const router = Router();
router.use(authenticate, requireRole(['Editor', 'Cameraman', 'SuperAdmin', 'Admin']));
router.use((req: Request, res: Response): void => {
  tusServer.handle(req, res).catch((err: any) => {
    console.error('[TUS] handle error:', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'خطا در پردازش آپلود؛ لطفاً دوباره تلاش کنید.' });
    }
  });
});

export default router;
