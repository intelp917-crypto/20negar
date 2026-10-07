import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { VideoService } from '../services/video.service.ts';
import { TranscoderService } from '../services/transcoder.service.ts';
import { fileStorage } from '../storage/local.storage.ts';
import { authenticate, requireRole } from '../middleware/auth.middleware.ts';
import { videoUpload } from '../middleware/upload.middleware.ts';
import { PRIVATE_VIDEOS_DIR, PRIVATE_HLS_DIR } from '../config.ts';
import { AuditService } from '../services/audit.service.ts';
import { loadSession as loadChunkSession, dataFile as chunkDataFile, cleanupSession as cleanupChunkSession } from './upload.routes.ts';

const router = Router();

/**
 * فایل آپلودشده با سیستم چانکی موازی را به فایل موقت استاندارد تبدیل می‌کند
 * تا ادامه پایپ‌لاین ساخت ویدیو بدون تغییر اجرا شود.
 */
function resolveChunkedUpload(uploadId: string, userId: number): { tempPath: string; originalName: string; size: number } | null {
  const session = loadChunkSession(uploadId);
  if (!session || session.userId !== userId) return null;
  const src = chunkDataFile(uploadId);
  if (!fs.existsSync(src)) return null;

  // اعتبارسنجی سخت‌گیرانه: همه چانک‌ها باید دریافت شده و حجم نهایی درست باشد
  if (session.received.length !== session.totalChunks) return null;
  for (let i = 0; i < session.totalChunks; i++) {
    if (!session.received.includes(i)) return null;
  }
  const stat = fs.statSync(src);
  if (stat.size !== session.fileSize) return null;

  // فایل نهایی همان فایل چانکی است؛ نیازی به کپی مجدد نیست (storeLocalFile آن را جابه‌جا می‌کند)
  return { tempPath: src, originalName: session.originalName, size: session.fileSize };
}

// GET /api/videos/stats - Dashboard statistics scoped per role
router.get('/stats', authenticate, (req: Request, res: Response): void => {
  try {
    const stats = VideoService.getStats(req.user!);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت آمار استودیو.' });
  }
});

// GET /api/videos - Query videos with filters and strict role isolation
router.get('/', authenticate, (req: Request, res: Response): void => {
  try {
    const { status, editorId, supervisorId, search, sort, onlyApproved } = req.query;

    const videos = VideoService.getVideos(req.user!, {
      status: status as string,
      editorId: editorId ? parseInt(editorId as string, 10) : undefined,
      supervisorId: supervisorId ? parseInt(supervisorId as string, 10) : undefined,
      search: search as string,
      sort: sort as any,
      onlyApproved: onlyApproved === 'true',
    });

    res.json(videos);
  } catch (err: any) {
    console.error('[VideoRoutes] Fetch error:', err);
    res.status(500).json({ error: 'خطا در دریافت لیست ویدیوها.' });
  }
});

// GET /api/videos/:id - Single video details
router.get('/:id', authenticate, (req: Request, res: Response): void => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const video = VideoService.getVideoById(videoId, req.user!);
    if (!video) {
      res.status(404).json({ error: 'ویدیو یافت نشد یا شما دسترسی مشاهده آن را ندارید.' });
      return;
    }
    res.json(video);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت جزئیات ویدیو.' });
  }
});

// GET /api/videos/:id/job-status - Real-time processing progress
router.get('/:id/job-status', authenticate, (req: Request, res: Response): void => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const video = VideoService.getVideoById(videoId, req.user!);
    if (!video) {
      res.status(404).json({ error: 'دسترسی غیرمجاز.' });
      return;
    }

    const job = TranscoderService.getJobStatus(videoId);
    if (!job) {
      res.json({ status: 'Ready', progress: 100, details: null });
      return;
    }
    let parsedDetails = null;
    try {
      parsedDetails = JSON.parse(job.details);
    } catch {}

    res.json({
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      currentStep: job.current_step,
      details: parsedDetails,
      errorMessage: job.error_message,
      updatedAt: job.updated_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در بررسی وضعیت آماده‌سازی ویدیو.' });
  }
});

// POST /api/videos - Upload video (Editor only)
router.post(
  '/',
  authenticate,
  requireRole(['Editor']),
  videoUpload.single('video'),
  async (req: Request, res: Response): Promise<void> => {
    let chunkTempPath: string | null = null;
    try {
      const { title, supervisorId } = req.body;
      if (!title || !title.trim()) {
        res.status(400).json({ error: 'عنوان پروژه ویدیویی الزامی است.' });
        return;
      }

      if (!supervisorId) {
        res.status(400).json({ error: 'انتخاب ناظر کیفی الزامی است.' });
        return;
      }

      let tempPath: string;
      let originalName: string;
      let fileSize: number;

      if (req.body.uploadId) {
        // مسیر جدید: آپلود چانکی موازی (فیچر ۳)
        const assembled = resolveChunkedUpload(String(req.body.uploadId), req.user!.id);
        if (!assembled) {
          res.status(400).json({ error: 'نشست آپلود چانکی یافت نشد یا ناقص است؛ لطفاً دوباره تلاش کنید.' });
          return;
        }
        tempPath = assembled.tempPath;
        originalName = assembled.originalName;
        fileSize = assembled.size;
        chunkTempPath = assembled.tempPath;
      } else if (req.file) {
        tempPath = req.file.path;
        originalName = req.file.originalname;
        fileSize = req.file.size;
      } else {
        res.status(400).json({ error: 'هیچ فایل ویدیویی ارسال نشده است.' });
        return;
      }

      const targetFileName = `orig_${Date.now()}_${path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const destinationKey = `videos/${targetFileName}`;

      // Move uploaded file from temp to private storage
      await fileStorage.storeLocalFile(tempPath, destinationKey);
      if (req.body.uploadId) cleanupChunkSession(String(req.body.uploadId));

      const created = VideoService.createVideo({
        title: title.trim(),
        originalFilename: originalName,
        originalPath: destinationKey,
        fileSize,
        editorId: req.user!.id,
        supervisorId: parseInt(supervisorId, 10),
        ipAddress: req.ip,
      });

      res.status(201).json(created);
    } catch (err: any) {
      console.error('[VideoRoutes] Upload error:', err);
      if (chunkTempPath && fs.existsSync(chunkTempPath)) {
        try {
          fs.unlinkSync(chunkTempPath);
        } catch {}
      }
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {}
      }
      res.status(500).json({ error: err.message || 'خطا در بارگذاری ویدیو.' });
    }
  }
);

// POST /api/videos/:id/versions - Upload revised cut (Editor only)
router.post(
  '/:id/versions',
  authenticate,
  requireRole(['Editor']),
  videoUpload.single('video'),
  async (req: Request, res: Response): Promise<void> => {
    let chunkTempPath: string | null = null;
    try {
      const parentId = parseInt(req.params.id, 10);
      const parentVideo = VideoService.getVideoById(parentId, req.user!);
      if (!parentVideo) {
        res.status(404).json({ error: 'ویدیوی مبدا جهت بارگذاری نسخه جدید یافت نشد.' });
        return;
      }

      let tempPath: string;
      let originalName: string;
      let fileSize: number;

      if (req.body.uploadId) {
        const assembled = resolveChunkedUpload(String(req.body.uploadId), req.user!.id);
        if (!assembled) {
          res.status(400).json({ error: 'نشست آپلود چانکی یافت نشد یا ناقص است؛ لطفاً دوباره تلاش کنید.' });
          return;
        }
        tempPath = assembled.tempPath;
        originalName = assembled.originalName;
        fileSize = assembled.size;
        chunkTempPath = assembled.tempPath;
      } else if (req.file) {
        tempPath = req.file.path;
        originalName = req.file.originalname;
        fileSize = req.file.size;
      } else {
        res.status(400).json({ error: 'لطفا فایل نسخه جدید را انتخاب کنید.' });
        return;
      }

      const targetFileName = `orig_v${parentVideo.versionNumber + 1}_${Date.now()}_${path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const destinationKey = `videos/${targetFileName}`;

      await fileStorage.storeLocalFile(tempPath, destinationKey);
      if (req.body.uploadId) cleanupChunkSession(String(req.body.uploadId));

      const title = req.body.title?.trim() || `${parentVideo.title} (نسخه ${parentVideo.versionNumber + 1})`;
      const supervisorId = req.body.supervisorId ? parseInt(req.body.supervisorId, 10) : parentVideo.supervisorId;

      const newVersion = VideoService.createVideo({
        title,
        originalFilename: originalName,
        originalPath: destinationKey,
        fileSize,
        editorId: req.user!.id,
        supervisorId,
        parentVideoId: parentId,
        versionNumber: parentVideo.versionNumber + 1,
        ipAddress: req.ip,
      });

      res.status(201).json(newVersion);
    } catch (err: any) {
      console.error('[VideoRoutes] Version upload error:', err);
      if (chunkTempPath && fs.existsSync(chunkTempPath)) {
        try {
          fs.unlinkSync(chunkTempPath);
        } catch {}
      }
      if (req.file && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {}
      }
      res.status(500).json({ error: err.message || 'خطا در بارگذاری نسخه اصلاح‌شده.' });
    }
  }
);

// POST /api/videos/:id/approve - Supervisor or SuperAdmin approval
router.post('/:id/approve', authenticate, requireRole(['Supervisor', 'SuperAdmin']), (req: Request, res: Response): void => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const { comment } = req.body;
    const updated = VideoService.approveVideo(
      videoId,
      { id: req.user!.id, displayName: req.user!.displayName, ipAddress: req.ip, role: req.user!.role },
      comment
    );
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'خطا در تایید ویدیو.' });
  }
});

// POST /api/videos/:id/reject - Supervisor or SuperAdmin rejection
router.post('/:id/reject', authenticate, requireRole(['Supervisor', 'SuperAdmin']), (req: Request, res: Response): void => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      res.status(400).json({ error: 'ثبت دلیل رد پروژه الزامی است.' });
      return;
    }
    const updated = VideoService.rejectVideo(
      videoId,
      { id: req.user!.id, displayName: req.user!.displayName, ipAddress: req.ip, role: req.user!.role },
      reason.trim()
    );
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'خطا در رد ویدیو.' });
  }
});

// POST /api/videos/:id/assign-editor - Supervisor, Admin or SuperAdmin
router.post('/:id/assign-editor', authenticate, requireRole(['Supervisor', 'Admin', 'SuperAdmin']), (req: Request, res: Response): void => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const { editorId } = req.body;
    if (!editorId) {
      res.status(400).json({ error: 'شناسه تدوین‌گر الزامی است.' });
      return;
    }
    const updated = VideoService.assignEditor(videoId, parseInt(editorId, 10), {
      id: req.user!.id,
      role: req.user!.role,
      displayName: req.user!.displayName,
      ipAddress: req.ip,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'خطا در انتساب تدوین‌گر.' });
  }
});

// POST /api/videos/:id/assign-supervisor - Editor, Admin or SuperAdmin
router.post('/:id/assign-supervisor', authenticate, requireRole(['Editor', 'Admin', 'SuperAdmin']), (req: Request, res: Response): void => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const { supervisorId } = req.body;
    if (!supervisorId) {
      res.status(400).json({ error: 'شناسه ناظر کیفی الزامی است.' });
      return;
    }
    const updated = VideoService.assignSupervisor(videoId, parseInt(supervisorId, 10), {
      id: req.user!.id,
      role: req.user!.role,
      displayName: req.user!.displayName,
      ipAddress: req.ip,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'خطا در انتساب ناظر کیفی.' });
  }
});

// POST /api/videos/:id/assign-admin - SuperAdmin only (انتخاب ادمین مقصد ویدیو پس از تایید ناظر)
router.post('/:id/assign-admin', authenticate, requireRole(['SuperAdmin']), (req: Request, res: Response): void => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const raw = req.body.adminId;
    const adminId = raw === null || raw === undefined || raw === '' ? null : parseInt(raw, 10);
    if (adminId !== null && Number.isNaN(adminId)) {
      res.status(400).json({ error: 'شناسه ادمین نامعتبر است.' });
      return;
    }

    const updated = VideoService.assignAdmin(videoId, adminId, {
      id: req.user!.id,
      role: req.user!.role,
      displayName: req.user!.displayName,
      ipAddress: req.ip,
    });
    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'خطا در انتساب ادمین.' });
  }
});

// DELETE /api/videos/:id - Delete video and renditions (SuperAdmin or Admin)
router.delete('/:id', authenticate, requireRole(['SuperAdmin', 'Admin']), async (req: Request, res: Response): Promise<void> => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const video = VideoService.getVideoById(videoId, req.user!);
    if (!video) {
      res.status(404).json({ error: 'ویدیو یافت نشد.' });
      return;
    }

    // Delete physical files
    try {
      await fileStorage.deleteFile(video.originalPath);
      if (video.thumbnailPath) await fileStorage.deleteFile(video.thumbnailPath);
      if (video.qualities) {
        for (const q of video.qualities) {
          const qFile = path.join(PRIVATE_VIDEOS_DIR, `video_${videoId}_${q.quality}.mp4`);
          if (fs.existsSync(qFile)) fs.unlinkSync(qFile);
        }
      }
    } catch (fErr) {
      console.warn('Physical file deletion warning:', fErr);
    }

    // Delete from DB (cascades to qualities, reviews, jobs)
    const { db } = await import('../db/database.ts');
    db.run('DELETE FROM videos WHERE id = ?', [videoId]);

    AuditService.log(
      req.user!.id,
      'حذف ویدیو',
      'Video',
      videoId,
      `ویدیوی "${video.title}" توسط ${req.user!.displayName} از سیستم حذف شد.`,
      req.ip
    );

    res.json({ success: true, message: 'ویدیو با موفقیت حذف شد.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'خطا در حذف ویدیو.' });
  }
});

// GET /api/videos/:id/thumbnail - Secure thumbnail delivery
router.get('/:id/thumbnail', authenticate, (req: Request, res: Response): void => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const video = VideoService.getVideoById(videoId, req.user!);
    if (!video || !video.thumbnailPath) {
      res.status(404).json({ error: 'تصویر بندانگشتی یافت نشد.' });
      return;
    }

    const fullPath = fileStorage.getPhysicalPath(video.thumbnailPath);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'فایل بندانگشتی در حافظه سرور موجود نیست.' });
      return;
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    fs.createReadStream(fullPath).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت تصویر بندانگشتی.' });
  }
});

// GET /api/videos/:id/stream - Secure Video Streaming with HTTP Range Support & Quality Selection
router.get('/:id/stream', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const requestedQuality = (req.query.quality as string) || 'Original';

    const video = VideoService.getVideoById(videoId, req.user!);
    if (!video) {
      res.status(404).json({ error: 'ویدیو یافت نشد یا دسترسی غیرمجاز است.' });
      return;
    }

    let relativeFilePath = video.originalPath;
    if (requestedQuality !== 'Original' && requestedQuality !== 'Auto' && video.qualities) {
      const match = video.qualities.find((q) => q.quality === requestedQuality);
      if (match) {
        const qualityFilename = `video_${videoId}_${match.quality}.mp4`;
        const testPath = path.join(PRIVATE_VIDEOS_DIR, qualityFilename);
        if (fs.existsSync(testPath)) {
          relativeFilePath = `videos/${qualityFilename}`;
        }
      }
    }

    const fullPath = fileStorage.getPhysicalPath(relativeFilePath);
    const targetFile = fs.existsSync(fullPath) ? fullPath : fileStorage.getPhysicalPath(video.originalPath);

    if (!fs.existsSync(targetFile)) {
      res.status(404).json({ error: 'فایل ویدیو در حافظه ذخیره‌سازی یافت نشد.' });
      return;
    }

    const stat = fs.statSync(targetFile);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(targetFile, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(targetFile).pipe(res);
    }
  } catch (err: any) {
    console.error('[VideoRoutes] Stream error:', err);
    res.status(500).json({ error: 'خطا در استریم ویدیو.' });
  }
});

// GET /api/videos/:id/hls/* - Secure HLS Playlist & Segments Delivery
router.get(
  '/:id/hls/*',
  (req: Request, res: Response, next: any): void => {
    const subPath = req.params[0] || 'master.m3u8';
    if (subPath.endsWith('.ts')) {
      return next();
    }
    authenticate(req, res, next);
  },
  (req: Request, res: Response): void => {
    try {
      const videoId = parseInt(req.params.id, 10);
      if (req.user) {
        const video = VideoService.getVideoById(videoId, req.user);
        if (!video) {
          res.status(404).json({ error: 'ویدیو یافت نشد یا دسترسی غیرمجاز است.' });
          return;
        }
      }

      const subPath = req.params[0] || 'master.m3u8';
      const cleanSubPath = path.normalize(subPath).replace(/^(\.\.[\/\\])+/, '');
      const hlsFilePath = path.join(PRIVATE_HLS_DIR, `video_${videoId}`, cleanSubPath);

      if (!fs.existsSync(hlsFilePath)) {
        res.status(404).json({ error: 'فایل HLS مورد نظر هنوز آماده نشده است.' });
        return;
      }

      if (cleanSubPath.endsWith('.m3u8')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
      } else if (cleanSubPath.endsWith('.ts')) {
        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }

      fs.createReadStream(hlsFilePath).pipe(res);
    } catch (err: any) {
      res.status(500).json({ error: 'خطا در ارسال فایل استریم تطبیقی.' });
    }
  }
);

// GET /api/videos/:id/download - Secure Quality Download
router.get('/:id/download', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const videoId = parseInt(req.params.id, 10);
    const requestedQuality = (req.query.quality as string) || 'Original';

    const video = VideoService.getVideoById(videoId, req.user!);
    if (!video) {
      res.status(404).json({ error: 'ویدیو یافت نشد یا دسترسی غیرمجاز است.' });
      return;
    }

    let relativeFilePath = video.originalPath;
    let downloadFilename = video.originalFilename;

    if (requestedQuality !== 'Original' && requestedQuality !== 'Auto' && video.qualities) {
      const match = video.qualities.find((q) => q.quality === requestedQuality);
      if (match) {
        const qualityFilename = `video_${videoId}_${match.quality}.mp4`;
        const testPath = path.join(PRIVATE_VIDEOS_DIR, qualityFilename);
        if (fs.existsSync(testPath)) {
          relativeFilePath = `videos/${qualityFilename}`;
          const baseNoExt = video.title.replace(/[^a-zA-Z0-9\u0600-\u06FF._-]/g, '_');
          downloadFilename = `${baseNoExt}_${match.quality}.mp4`;
        }
      }
    }

    const fullPath = fileStorage.getPhysicalPath(relativeFilePath);
    const targetFile = fs.existsSync(fullPath) ? fullPath : fileStorage.getPhysicalPath(video.originalPath);

    if (!fs.existsSync(targetFile)) {
      res.status(404).json({ error: 'فایل ویدیو در حافظه ذخیره‌سازی یافت نشد.' });
      return;
    }

    AuditService.log(
      req.user!.id,
      'دانلود ویدیو',
      'Video',
      videoId,
      `کاربر ${req.user!.displayName} نسخه ${requestedQuality} ویدیوی "${video.title}" را دانلود کرد.`,
      req.ip
    );

    const stat = fs.statSync(targetFile);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadFilename)}"`);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', stat.size);

    fs.createReadStream(targetFile).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دانلود ویدیو.' });
  }
});

export default router;
