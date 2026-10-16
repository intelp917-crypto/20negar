import { Router, Request, Response } from 'express';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { authenticate, requireRole } from '../middleware/auth.middleware.ts';
import { STORAGE_DIR } from '../config.ts';

/**
 * سیستم آپلود موازی و مقاوم در برابر قطعی (Parallel Chunked Upload)
 * -------------------------------------------------------------------
 * فایل به تکه‌هایی (چانک) تقسیم می‌شود که همزمان و موازی ارسال می‌شوند.
 * هر چانک مستقل است و در صورت قطعی اینترنت فقط همان تکه دوباره ارسال می‌شود
 * (Resume) — برخلاف آپلود سنتی که کل فایل از صفر شروع می‌شد.
 *
 * چرخه کار:
 *  1) POST   /api/chunked-uploads              → ایجاد نشست آپلود
 *  2) PUT    /api/chunked-uploads/:id/chunk/:n  → ارسال موازی چانک‌ها
 *  3) GET    /api/chunked-uploads/:id           → وضعیت/رزوم (کدام چانک رسیده)
 *  4) POST   /api/chunked-uploads/:id/complete  → ادغام چانک‌ها + ساخت ویدیو
 */

const router = Router();

const CHUNK_DIR = path.resolve(STORAGE_DIR, 'temp', 'chunked');
const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4 GB
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB (faster throughput)
const MAX_CHUNK_SIZE = 32 * 1024 * 1024; // 32 MB
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 ساعت
// همه فرمت‌های ویدیویی پذیرفته می‌شوند (تبدیل نهایی را FFmpeg انجام می‌دهد)

if (!fs.existsSync(CHUNK_DIR)) {
  fs.mkdirSync(CHUNK_DIR, { recursive: true });
}

export interface SessionMeta {
  id: string;
  userId: number;
  originalName: string;
  mimeType: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  received: number[];
  createdAt: number;
  meta: Record<string, string>; // عنوان/ناظر و... که کلاینت همراه چانک‌ها می‌فرستد
  expectedChecksum?: string;
  actualChecksum?: string;
  verifiedAt?: number;
  verificationResult?: 'pending' | 'verified' | 'mismatch' | 'not_provided';
  finalizedAt?: number;
}

export function sessionPath(id: string): string {
  return path.join(CHUNK_DIR, id);
}
export function metaFile(id: string): string {
  return path.join(CHUNK_DIR, `${id}.json`);
}
export function dataFile(id: string): string {
  return path.join(CHUNK_DIR, `${id}.data`);
}

export function loadSession(id: string): SessionMeta | null {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  try {
    const raw = fs.readFileSync(metaFile(id), 'utf8');
    const meta = JSON.parse(raw) as SessionMeta;
    if (Date.now() - meta.createdAt > SESSION_TTL) {
      cleanupSession(id);
      return null;
    }
    return meta;
  } catch {
    return null;
  }
}

function saveSession(meta: SessionMeta): void {
  const destination = metaFile(meta.id);
  const temporary = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(meta));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temporary, destination);
  } catch (err) {
    try {
      fs.unlinkSync(temporary);
    } catch {}
    throw err;
  }
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

export function verifySessionIntegrity(
  meta: SessionMeta,
  filePath: string = dataFile(meta.id),
  persist: (session: SessionMeta) => void = saveSession,
): SessionMeta {
  if (meta.verificationResult === 'verified' || meta.verificationResult === 'mismatch' || meta.verificationResult === 'not_provided') {
    return meta;
  }

  const actualChecksum = hashFile(filePath);
  const now = Date.now();
  meta.actualChecksum = actualChecksum;
  meta.verifiedAt = now;
  meta.finalizedAt = now;
  if (!meta.expectedChecksum) {
    meta.verificationResult = 'not_provided';
  } else {
    meta.verificationResult = meta.expectedChecksum === actualChecksum ? 'verified' : 'mismatch';
  }
  persist(meta);
  return meta;
}

function readExpectedChecksum(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const checksum = String(value).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum)) return undefined;
  return checksum;
}

/**
 * ساخت نشست آپلود از یک فایل کامل و آماده (مثلاً خروجی آپلود TUS)
 * تا ادامه پایپ‌لاین ساخت ویدیو (POST /api/videos با uploadId) بدون تغییر کار کند.
 * شناسه به همان فرمت ۳۲ کاراکتری هگز ساخته می‌شود.
 */
export function createSessionFromCompletedFile(opts: {
  userId: number;
  originalName: string;
  mimeType: string;
  fileSize: number;
  sourcePath: string;
  meta?: Record<string, string>;
  expectedChecksum?: string;
  /** در صورت ارائه، از همین شناسه به‌عنوان شناسه نشست استفاده می‌شود (فرمت ۳۲ کاراکتری هگز) */
  id?: string;
}): string | null {
  try {
    if (!opts.userId || opts.fileSize <= 0) return null;
    if (!fs.existsSync(opts.sourcePath)) return null;
    const stat = fs.statSync(opts.sourcePath);
    if (stat.size !== opts.fileSize) return null; // فایل ناقص است

    const id = opts.id && /^[a-f0-9]{32}$/.test(opts.id) ? opts.id : crypto.randomBytes(16).toString('hex');
    const dest = dataFile(id);
    if (fs.existsSync(dest)) return null; // جلوگیری از بازنویسی نشست موجود
    try {
      fs.renameSync(opts.sourcePath, dest);
    } catch {
      // در صورت نبود امکان rename (_volume متفاوت) کپی می‌کنیم
      fs.copyFileSync(opts.sourcePath, dest);
      try {
        fs.unlinkSync(opts.sourcePath);
      } catch {}
    }

    const session: SessionMeta = {
      id,
      userId: opts.userId,
      originalName: opts.originalName,
      mimeType: opts.mimeType,
      fileSize: opts.fileSize,
      chunkSize: opts.fileSize,
      totalChunks: 1,
      received: [0],
      createdAt: Date.now(),
      meta: opts.meta || {},
      expectedChecksum: readExpectedChecksum(opts.expectedChecksum),
      verificationResult: 'pending',
    };
    saveSession(session);
    return id;
  } catch (err) {
    console.error('[Upload] createSessionFromCompletedFile failed:', err);
    return null;
  }
}

export function cleanupSession(id: string): void {
  for (const f of [metaFile(id), dataFile(id)]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
  }
}

/** پاک‌سازی نشست‌های منقضی (به‌صورت دوره‌ای) */
function cleanupExpired(): void {
  try {
    for (const f of fs.readdirSync(CHUNK_DIR)) {
      const full = path.join(CHUNK_DIR, f);
      try {
        const st = fs.statSync(full);
        if (Date.now() - st.mtimeMs > SESSION_TTL) fs.unlinkSync(full);
      } catch {}
    }
  } catch {}
}
cleanupExpired();
setInterval(cleanupExpired, 60 * 60 * 1000).unref?.();

// POST /api/chunked-uploads - ایجاد نشست آپلود
router.post('/', authenticate, requireRole(['Editor', 'Cameraman', 'SuperAdmin', 'Admin']), (req: Request, res: Response): void => {
  try {
    const { fileName, fileSize, mimeType, chunkSize, checksum, expectedChecksum, sha256 } = req.body || {};
    if (!fileName || !String(fileName).trim()) {
      res.status(400).json({ error: 'نام فایل الزامی است.' });
      return;
    }
    const size = parseInt(fileSize, 10);
    if (!Number.isFinite(size) || size <= 0) {
      res.status(400).json({ error: 'حجم فایل نامعتبر است.' });
      return;
    }
    if (size > MAX_FILE_SIZE) {
      res.status(400).json({ error: 'حجم فایل از سقف مجاز (۴ گیگابایت) بیشتر است.' });
      return;
    }
    const ext = path.extname(String(fileName)).toLowerCase();
    if (!ext) {
      res.status(400).json({ error: 'نام فایل باید پسوند داشته باشد (مثلاً mp4).' });
      return;
    }

    const requestedChecksum = checksum ?? expectedChecksum ?? sha256 ?? req.headers['x-upload-checksum'];
    if (requestedChecksum !== undefined && !readExpectedChecksum(requestedChecksum)) {
      res.status(400).json({ error: 'چک‌سام SHA-256 نامعتبر است.' });
      return;
    }

    const cs = Math.min(Math.max(parseInt(chunkSize, 10) || DEFAULT_CHUNK_SIZE, 64 * 1024), MAX_CHUNK_SIZE);
    const totalChunks = Math.ceil(size / cs);

    const meta: SessionMeta = {
      id: crypto.randomBytes(16).toString('hex'),
      userId: req.user!.id,
      originalName: String(fileName),
      mimeType: String(mimeType || 'video/mp4'),
      fileSize: size,
      chunkSize: cs,
      totalChunks,
      received: [],
      createdAt: Date.now(),
      meta: {},
      expectedChecksum: readExpectedChecksum(requestedChecksum),
      verificationResult: 'pending',
    };

    // ایجاد فایل با حجم نهایی (Sparse) تا چانک‌ها بتوانند موازی روی آن بنویسند
    const fd = fs.openSync(dataFile(meta.id), 'w');
    fs.ftruncateSync(fd, size);
    fs.closeSync(fd);

    saveSession(meta);
    res.status(201).json({
      uploadId: meta.id,
      chunkSize: meta.chunkSize,
      totalChunks: meta.totalChunks,
      received: [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'خطا در ایجاد نشست آپلود.' });
  }
});

// GET /api/chunked-uploads/:id - وضعیت و رزوم آپلود
router.get('/:id', authenticate, requireRole(['Editor', 'Cameraman', 'SuperAdmin', 'Admin']), (req: Request, res: Response): void => {
  const meta = loadSession(req.params.id);
  if (!meta || (meta.userId !== req.user!.id && req.user!.role !== 'SuperAdmin')) {
    res.status(404).json({ error: 'نشست آپلود یافت نشد یا منقضی شده است.' });
    return;
  }
  res.json({
    uploadId: meta.id,
    chunkSize: meta.chunkSize,
    totalChunks: meta.totalChunks,
    received: meta.received,
      fileSize: meta.fileSize,
      originalName: meta.originalName,
      expectedChecksum: meta.expectedChecksum,
      actualChecksum: meta.actualChecksum,
      verifiedAt: meta.verifiedAt,
      verificationResult: meta.verificationResult,
      finalizedAt: meta.finalizedAt,
    });
});

// PUT /api/chunked-uploads/:id/chunk/:index - ارسال یک چانک (قابل فراخوانی موازی)
router.put(
  '/:id/chunk/:index',
  authenticate,
  requireRole(['Editor', 'Cameraman', 'SuperAdmin', 'Admin']),
  express.raw({ type: '*/*', limit: MAX_CHUNK_SIZE + 1024 }),
  (req: Request, res: Response): void => {
    try {
      const meta = loadSession(req.params.id);
      if (!meta || (meta.userId !== req.user!.id && req.user!.role !== 'SuperAdmin')) {
        res.status(404).json({ error: 'نشست آپلود یافت نشد یا منقضی شده است.' });
        return;
      }

      const index = parseInt(req.params.index, 10);
      if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
        res.status(400).json({ error: 'شماره چانک نامعتبر است.' });
        return;
      }

      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (meta.finalizedAt) {
        res.status(409).json({ error: 'نشست آپلود قبلاً نهایی شده است.' });
        return;
      }
      if (body.length === 0) {
        res.status(400).json({ error: 'بدنه چانک خالی است.' });
        return;
      }

      const start = index * meta.chunkSize;
      const expected = Math.min(meta.chunkSize, meta.fileSize - start);
      if (body.length !== expected) {
        res.status(400).json({ error: `اندازه چانک نامعتبر است (${body.length} ≠ ${expected}).` });
        return;
      }

      // نوشتن موازی در جای درست فایل (بدون ادغام ترتیبی — سرعت بالا)
      const fd = fs.openSync(dataFile(meta.id), 'r+');
      try {
        fs.writeSync(fd, body, 0, body.length, start);
      } finally {
        fs.closeSync(fd);
      }

      if (!meta.received.includes(index)) {
        meta.received.push(index);
        meta.received.sort((a, b) => a - b);
        saveSession(meta);
      }

      // دریافت متادیتای فرم (عنوان، ناظر و...) همراه اولین چانک
      const incomingMeta = req.headers['x-upload-meta'];
      if (incomingMeta) {
        try {
          meta.meta = { ...meta.meta, ...JSON.parse(Buffer.from(String(incomingMeta), 'base64').toString('utf8')) };
          saveSession(meta);
        } catch {}
      }

      res.json({ ok: true, received: meta.received.length, total: meta.totalChunks });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'خطا در دریافت چانک.' });
    }
  }
);

// POST /api/chunked-uploads/:id/complete - تکمیل آپلود؛ فایل آماده است.
router.post('/:id/complete', authenticate, requireRole(['Editor', 'Cameraman', 'SuperAdmin', 'Admin']), (req: Request, res: Response): void => {
  const meta = loadSession(req.params.id);
  if (!meta || (meta.userId !== req.user!.id && req.user!.role !== 'SuperAdmin')) {
    res.status(404).json({ error: 'نشست آپلود یافت نشد یا منقضی شده است.' });
    return;
  }

  const missing: number[] = [];
  for (let i = 0; i < meta.totalChunks; i++) {
    if (!meta.received.includes(i)) missing.push(i);
  }
  if (missing.length > 0) {
    res.status(400).json({ error: 'آپلود کامل نشده است.', missing });
    return;
  }

  const stat = fs.statSync(dataFile(meta.id));
  if (stat.size !== meta.fileSize) {
    res.status(400).json({ error: `حجم فایل نهایی نامعتبر است (${stat.size} ≠ ${meta.fileSize}).` });
    return;
  }

  const verified = verifySessionIntegrity(meta);
  if (verified.verificationResult === 'mismatch') {
    res.status(400).json({
      error: 'چک‌سام فایل با مقدار مورد انتظار مطابقت ندارد.',
      uploadId: meta.id,
      expectedChecksum: meta.expectedChecksum,
      actualChecksum: meta.actualChecksum,
      verifiedAt: meta.verifiedAt,
      verificationResult: meta.verificationResult,
    });
    return;
  }

  res.json({
    ok: true,
    uploadId: meta.id,
    fileSize: meta.fileSize,
    originalName: meta.originalName,
    meta: meta.meta,
    expectedChecksum: verified.expectedChecksum,
    actualChecksum: verified.actualChecksum,
    verifiedAt: verified.verifiedAt,
    verificationResult: verified.verificationResult,
    finalizedAt: verified.finalizedAt,
  });
});

export default router;
