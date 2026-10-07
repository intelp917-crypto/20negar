import { Router, Request, Response } from 'express';
import { AuthService } from '../services/auth.service.ts';
import { AuditService } from '../services/audit.service.ts';
import { authenticate, requireRole } from '../middleware/auth.middleware.ts';
import { db } from '../db/database.ts';
import { STORAGE_DIR } from '../config.ts';
import { UpdateService } from '../services/update.service.ts';
import fs from 'fs';

const router = Router();

// GET /api/editors - Active editors list
router.get('/editors', authenticate, (_req: Request, res: Response): void => {
  try {
    const editors = AuthService.getUsersByRole('Editor');
    res.json(editors);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت لیست تدوین‌گران.' });
  }
});

// GET /api/supervisors - Active supervisors list
router.get('/supervisors', authenticate, (_req: Request, res: Response): void => {
  try {
    const supervisors = AuthService.getUsersByRole('Supervisor');
    res.json(supervisors);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت لیست ناظران.' });
  }
});

// GET /api/admins - Active admins list (برای انتساب ادمین مقصد ویدیو)
router.get('/admins', authenticate, requireRole(['Admin', 'SuperAdmin']), (_req: Request, res: Response): void => {
  try {
    const admins = AuthService.getUsersByRole('Admin');
    res.json(admins);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت لیست ادمین‌ها.' });
  }
});

// GET /api/users - All users (Admin & SuperAdmin)
router.get('/users', authenticate, requireRole(['Admin', 'SuperAdmin']), (_req: Request, res: Response): void => {
  try {
    const users = AuthService.getAllUsers();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در دریافت لیست کاربران.' });
  }
});

// POST /api/users - Create User (SuperAdmin & Admin)
router.post('/users', authenticate, requireRole(['SuperAdmin', 'Admin']), async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password, role, displayName } = req.body;
    if (!username || !password || !role || !displayName) {
      res.status(400).json({ error: 'تمامی فیلدها (نام کاربری، رمز عبور، نقش و نام نمایشی) الزامی هستند.' });
      return;
    }

    if (!['SuperAdmin', 'Admin', 'Editor', 'Supervisor'].includes(role)) {
      res.status(400).json({ error: 'نقش کاربری وارد شده معتبر نیست.' });
      return;
    }

    const created = await AuthService.createUser({
      username: username.trim(),
      password: password.trim(),
      role,
      displayName: displayName.trim(),
    });

    AuditService.log(
      req.user!.id,
      'ایجاد کاربر جدید',
      'User',
      created.id,
      `کاربر جدید "${created.username}" با نقش ${created.role} توسط ${req.user!.displayName} ایجاد شد.`,
      req.ip
    );

    res.status(201).json(created);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'خطا در ایجاد کاربر.' });
  }
});

// PUT /api/users/:id - Update User (SuperAdmin only)
router.put('/users/:id', authenticate, requireRole(['SuperAdmin']), (req: Request, res: Response): void => {
  try {
    const id = parseInt(req.params.id, 10);
    const { displayName, role, isActive } = req.body;

    const updated = AuthService.updateUser(id, { displayName, role, isActive });

    AuditService.log(
      req.user!.id,
      'ویرایش مشخصات کاربر',
      'User',
      id,
      `مشخصات کاربر "${updated.username}" توسط سوپریوزر به‌روزرسانی شد.`,
      req.ip
    );

    res.json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'خطا در به‌روزرسانی کاربر.' });
  }
});

// PUT /api/users/:id/password - Reset Password (SuperAdmin only)
router.put('/users/:id/password', authenticate, requireRole(['SuperAdmin']), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      res.status(400).json({ error: 'رمز عبور جدید باید حداقل ۴ کاراکتر باشد.' });
      return;
    }

    await AuthService.resetPassword(id, newPassword);

    AuditService.log(
      req.user!.id,
      'تغییر رمز عبور کاربر',
      'User',
      id,
      `رمز عبور کاربر شناسه #${id} توسط سوپریوزر تغییر یافت.`,
      req.ip
    );

    res.json({ success: true, message: 'رمز عبور با موفقیت به‌روزرسانی شد.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'خطا در تغییر رمز عبور.' });
  }
});

// DELETE /api/users/:id - Delete / Deactivate User (SuperAdmin only)
router.delete('/users/:id', authenticate, requireRole(['SuperAdmin']), (req: Request, res: Response): void => {
  try {
    const id = parseInt(req.params.id, 10);
    AuthService.deleteUser(id);

    AuditService.log(
      req.user!.id,
      'حذف/غیرفعال‌سازی کاربر',
      'User',
      id,
      `کاربر با شناسه #${id} توسط سوپریوزر حذف یا غیرفعال شد.`,
      req.ip
    );

    res.json({ success: true, message: 'کاربر با موفقیت حذف یا غیرفعال شد.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'خطا در حذف کاربر.' });
  }
});

// GET /api/system/stats - Storage, Database and System telemetry
router.get('/system/stats', authenticate, requireRole(['SuperAdmin', 'Admin']), (_req: Request, res: Response): void => {
  try {
    let totalStorageBytes = 0;
    const calcFolderSize = (folderPath: string) => {
      if (!fs.existsSync(folderPath)) return;
      const files = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const file of files) {
        const full = `${folderPath}/${file.name}`;
        if (file.isDirectory()) {
          calcFolderSize(full);
        } else {
          totalStorageBytes += fs.statSync(full).size;
        }
      }
    };
    calcFolderSize(STORAGE_DIR);

    const videoCount = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos')?.c as number) || 0;
    const userCount = (db.queryOne<any>('SELECT COUNT(*) as c FROM users')?.c as number) || 0;
    const reviewCount = (db.queryOne<any>('SELECT COUNT(*) as c FROM video_reviews')?.c as number) || 0;
    const logCount = (db.queryOne<any>('SELECT COUNT(*) as c FROM audit_logs')?.c as number) || 0;
    const dbTelemetry = db.getDatabaseStats();

    res.json({
      totalStorageBytes,
      videoCount,
      userCount,
      reviewCount,
      logCount,
      serverTime: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      dbTelemetry,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در محاسبه آمار سیستم.' });
  }
});

// POST /api/system/optimize-db - Run vacuum, index re-indexing & optimization (SuperAdmin only)
router.post('/system/optimize-db', authenticate, requireRole(['SuperAdmin']), (req: Request, res: Response): void => {
  try {
    const result = db.optimize();
    AuditService.log(
      req.user!.id,
      'بهینه‌سازی پایگاه داده',
      'System',
      null,
      `عملیات بازسازی شاخص‌ها و بهینه‌سازی دیتابیس توسط ${req.user!.displayName} با موفقیت اجرا شد.`,
      req.ip
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'خطا در بهینه‌سازی دیتابیس.' });
  }
});

// GET /api/system/export-db - Download .sqlite file backup (SuperAdmin only)
router.get('/system/export-db', authenticate, requireRole(['SuperAdmin']), (req: Request, res: Response): void => {
  try {
    const backupBuffer = db.exportBackup();
    const filename = `20negar_db_backup_${new Date().toISOString().split('T')[0]}.sqlite`;
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', backupBuffer.length);
    res.send(backupBuffer);

    AuditService.log(
      req.user!.id,
      'پشتیبان‌گیری پایگاه داده',
      'System',
      null,
      `فایل پشتیبان کامل دیتابیس استودیو توسط ${req.user!.displayName} دانلود شد.`,
      req.ip
    );
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در تهیه فایل پشتیبان پایگاه داده.' });
  }
});

// GET /api/system/transcode-jobs - Live queue of transcode jobs (SuperAdmin & Admin)
router.get('/system/transcode-jobs', authenticate, requireRole(['SuperAdmin', 'Admin']), (_req: Request, res: Response): void => {
  try {
    const jobs = db.query<any>(
      `SELECT 
        j.id, j.video_id as videoId, j.status, j.progress, j.current_step as currentStep,
        j.details, j.error_message as errorMessage, j.created_at as createdAt, j.updated_at as updatedAt,
        v.title as videoTitle, v.original_filename as originalFilename, ed.display_name as editorName
       FROM processing_jobs j
       JOIN videos v ON j.video_id = v.id
       JOIN users ed ON v.editor_id = ed.id
       ORDER BY j.id DESC
       LIMIT 30`
    );

    const formatted = jobs.map((job) => {
      let parsed = null;
      try {
        parsed = JSON.parse(job.details);
      } catch {}
      return {
        ...job,
        details: parsed,
      };
    });

    res.json(formatted);
  } catch (err: any) {
    res.status(500).json({ error: 'خطا در بارگذاری صف تبدیل ویدیوها.' });
  }
});

// GET /api/system/update-status - بررسی وجود نسخه جدید در ریپوزیتوری (SuperAdmin only)
router.get('/system/update-status', authenticate, requireRole(['SuperAdmin']), (_req: Request, res: Response): void => {
  try {
    res.json(UpdateService.getStatus());
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'خطا در بررسی وضعیت بروزرسانی.' });
  }
});

// POST /api/system/update - بروزرسانی اجباری از ریپوزیتوری + ری‌استارت سرور (SuperAdmin only)
router.post('/system/update', authenticate, requireRole(['SuperAdmin']), async (_req: Request, res: Response): Promise<void> => {
  try {
    AuditService.log(
      _req.user!.id,
      'بروزرسانی اجباری وب‌اپ',
      'System',
      null,
      `بروزرسانی اجباری وب‌اپ از ریپوزیتوری توسط ${_req.user!.displayName} آغاز شد.`,
      _req.ip
    );
    const result = await UpdateService.forceUpdate();
    res.json({
      success: !result.error,
      changed: result.changed,
      filesChanged: result.filesChanged,
      npmInstalled: result.npmInstalled,
      restarting: result.restarting,
      error: result.error,
      message: result.error
        ? result.error
        : result.changed
          ? `بروزرسانی اعمال شد (${result.filesChanged} فایل). سرور در حال ری‌استارت است...`
          : 'نسخه وب‌اپ از قبل به‌روز است.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'خطا در بروزرسانی وب‌اپ.' });
  }
});

export default router;
