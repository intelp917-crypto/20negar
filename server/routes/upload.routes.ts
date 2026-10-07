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
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB
const MAX_CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 ساعت
const VALID_EXTS = ['.mp4', '.mov', '.mkv', '.webm', '.avi'];

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
  fs.writeFileSync(metaFile(meta.id), JSON.stringify(meta));
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

// POST /api/chunked-uploads - ایجاد نشست آپلود (Editor only)
router.post('/', authenticate, requireRole(['Editor']), (req: Request, res: Response): void => {
  try {
    const { fileName, fileSize, mimeType, chunkSize } = req.body || {};
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
      res.status(400).json({ error: 'حجم فایل از سقف مجاز (۵۰۰ مگابایت) بیشتر است.' });
      return;
    }
    const ext = path.extname(String(fileName)).toLowerCase();
    if (!VALID_EXTS.includes(ext)) {
      res.status(400).json({ error: `فرمت فایل (${ext}) پشتیبانی نمی‌شود. فرمت‌های مجاز: MP4, MOV, MKV, WebM, AVI` });
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
router.get('/:id', authenticate, requireRole(['Editor']), (req: Request, res: Response): void => {
  const meta = loadSession(req.params.id);
  if (!meta || meta.userId !== req.user!.id) {
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
  });
});

// PUT /api/chunked-uploads/:id/chunk/:index - ارسال یک چانک (قابل فراخوانی موازی)
router.put(
  '/:id/chunk/:index',
  authenticate,
  requireRole(['Editor']),
  express.raw({ type: '*/*', limit: MAX_CHUNK_SIZE + 1024 }),
  (req: Request, res: Response): void => {
    try {
      const meta = loadSession(req.params.id);
      if (!meta || meta.userId !== req.user!.id) {
        res.status(404).json({ error: 'نشست آپلود یافت نشد یا منقضی شده است.' });
        return;
      }

      const index = parseInt(req.params.index, 10);
      if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
        res.status(400).json({ error: 'شماره چانک نامعتبر است.' });
        return;
      }

      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
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
// (ادغام نهایی و ساخت رکورد ویدیو در video.routes انجام می‌شود)
router.post('/:id/complete', authenticate, requireRole(['Editor']), (req: Request, res: Response): void => {
  const meta = loadSession(req.params.id);
  if (!meta || meta.userId !== req.user!.id) {
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

  res.json({
    ok: true,
    uploadId: meta.id,
    fileSize: meta.fileSize,
    originalName: meta.originalName,
    meta: meta.meta,
  });
});

export default router;
