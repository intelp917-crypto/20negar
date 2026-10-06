import { db } from '../db/database.ts';
import { UserEntity, UserRole } from './auth.service.ts';
import { AuditService } from './audit.service.ts';
import { NotificationService } from './notification.service.ts';
import { TranscoderService } from './transcoder.service.ts';

export interface VideoQualityDto {
  id: number;
  quality: 'Original' | '1080p' | '720p' | '480p' | '360p';
  width: number;
  height: number;
  bitrate: number;
  fileSize: number;
}

export interface VideoReviewDto {
  id: number;
  videoId: number;
  supervisorId: number;
  supervisorName: string;
  editorId: number;
  editorName: string;
  action: 'Approved' | 'Rejected';
  comment: string;
  createdAt: string;
}

export interface VideoDto {
  id: number;
  title: string;
  originalFilename: string;
  originalPath: string;
  thumbnailPath: string | null;
  editorId: number;
  editorName: string;
  editorUsername: string;
  supervisorId: number;
  supervisorName: string;
  supervisorUsername: string;
  status: 'Uploaded' | 'PendingReview' | 'Approved' | 'Rejected';
  processingStatus: 'Uploading' | 'Processing' | 'Ready' | 'ProcessingFailed';
  duration: number;
  originalResolution: string | null;
  fileSize: number;
  versionNumber: number;
  parentVideoId: number | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  qualities?: VideoQualityDto[];
  reviews?: VideoReviewDto[];
  processingDetails?: any;
}

export interface VideoFilters {
  status?: string;
  editorId?: number;
  supervisorId?: number;
  search?: string;
  sort?: 'newest' | 'oldest' | 'largest' | 'smallest';
  onlyApproved?: boolean;
}

export class VideoService {
  /**
   * Strict segmented query: each user only sees videos and queues belonging strictly to them.
   */
  public static getVideos(user: { id: number; role: UserRole }, filters: VideoFilters = {}): VideoDto[] {
    let sql = `
      SELECT 
        v.id, v.title, v.original_filename as originalFilename, v.original_path as originalPath,
        v.thumbnail_path as thumbnailPath, v.editor_id as editorId,
        ed.display_name as editorName, ed.username as editorUsername,
        v.supervisor_id as supervisorId,
        sp.display_name as supervisorName, sp.username as supervisorUsername,
        v.status, v.processing_status as processingStatus, v.duration,
        v.original_resolution as originalResolution, v.file_size as fileSize,
        v.version_number as versionNumber, v.parent_video_id as parentVideoId,
        v.rejection_reason as rejectionReason, v.created_at as createdAt,
        v.updated_at as updatedAt, v.approved_at as approvedAt, v.rejected_at as rejectedAt
      FROM videos v
      JOIN users ed ON v.editor_id = ed.id
      JOIN users sp ON v.supervisor_id = sp.id
      WHERE 1=1
    `;
    const params: any[] = [];

    // STRICT USER DATA ISOLATION (هر کسی فقط ویدیوهای خودش را می‌بیند)
    if (user.role === 'Editor') {
      // Editor ONLY sees their own videos, regardless of filters
      sql += ` AND v.editor_id = ?`;
      params.push(user.id);
    } else if (user.role === 'Supervisor') {
      // Supervisor ONLY sees videos assigned to them
      sql += ` AND v.supervisor_id = ?`;
      params.push(user.id);
    } else if (user.role === 'Admin') {
      // Admin sees approved videos in the studio catalog
      sql += ` AND v.status = 'Approved'`;
    } else if (user.role === 'SuperAdmin') {
      // SuperAdmin has global visibility and can filter by editor/supervisor if specified
      if (filters.editorId) {
        sql += ` AND v.editor_id = ?`;
        params.push(filters.editorId);
      }
      if (filters.supervisorId) {
        sql += ` AND v.supervisor_id = ?`;
        params.push(filters.supervisorId);
      }
      if (filters.onlyApproved) {
        sql += ` AND v.status = 'Approved'`;
      }
    }

    if (filters.status && filters.status !== 'all') {
      sql += ` AND v.status = ?`;
      params.push(filters.status);
    }

    if (filters.search && filters.search.trim()) {
      const s = `%${filters.search.trim()}%`;
      sql += ` AND (v.title LIKE ? OR v.original_filename LIKE ? OR ed.display_name LIKE ? OR sp.display_name LIKE ?)`;
      params.push(s, s, s, s);
    }

    // High performance indexed sorting
    switch (filters.sort) {
      case 'oldest':
        sql += ` ORDER BY v.id ASC`;
        break;
      case 'largest':
        sql += ` ORDER BY v.file_size DESC`;
        break;
      case 'smallest':
        sql += ` ORDER BY v.file_size ASC`;
        break;
      case 'newest':
      default:
        sql += ` ORDER BY v.id DESC`;
        break;
    }

    const videos = db.query<VideoDto>(sql, params);

    // Attach available qualities for each video
    for (const v of videos) {
      v.qualities = db.query<VideoQualityDto>(
        `SELECT id, quality, width, height, bitrate, file_size as fileSize FROM video_qualities WHERE video_id = ? ORDER BY height DESC`,
        [v.id]
      );
    }

    return videos;
  }

  public static getVideoById(videoId: number, user: { id: number; role: UserRole }): VideoDto | null {
    const sql = `
      SELECT 
        v.id, v.title, v.original_filename as originalFilename, v.original_path as originalPath,
        v.thumbnail_path as thumbnailPath, v.editor_id as editorId,
        ed.display_name as editorName, ed.username as editorUsername,
        v.supervisor_id as supervisorId,
        sp.display_name as supervisorName, sp.username as supervisorUsername,
        v.status, v.processing_status as processingStatus, v.duration,
        v.original_resolution as originalResolution, v.file_size as fileSize,
        v.version_number as versionNumber, v.parent_video_id as parentVideoId,
        v.rejection_reason as rejectionReason, v.created_at as createdAt,
        v.updated_at as updatedAt, v.approved_at as approvedAt, v.rejected_at as rejectedAt
      FROM videos v
      JOIN users ed ON v.editor_id = ed.id
      JOIN users sp ON v.supervisor_id = sp.id
      WHERE v.id = ?
    `;
    const video = db.queryOne<VideoDto>(sql, [videoId]);
    if (!video) return null;

    // Strict Authorization Check:
    if (user.role === 'Editor' && video.editorId !== user.id) {
      return null;
    }
    if (user.role === 'Supervisor' && video.supervisorId !== user.id) {
      return null;
    }
    if (user.role === 'Admin' && video.status !== 'Approved') {
      return null;
    }

    // Attach qualities
    video.qualities = db.query<VideoQualityDto>(
      `SELECT id, quality, width, height, bitrate, file_size as fileSize FROM video_qualities WHERE video_id = ? ORDER BY height DESC`,
      [videoId]
    );

    // Attach reviews
    video.reviews = db.query<VideoReviewDto>(
      `SELECT 
        r.id, r.video_id as videoId, r.supervisor_id as supervisorId,
        sp.display_name as supervisorName, r.editor_id as editorId,
        ed.display_name as editorName, r.action, r.comment, r.created_at as createdAt
       FROM video_reviews r
       JOIN users sp ON r.supervisor_id = sp.id
       JOIN users ed ON r.editor_id = ed.id
       WHERE r.video_id = ?
       ORDER BY r.id DESC`,
      [videoId]
    );

    // Attach processing details
    const job = TranscoderService.getJobStatus(videoId);
    if (job) {
      try {
        video.processingDetails = {
          status: job.status,
          progress: job.progress,
          currentStep: job.current_step,
          details: JSON.parse(job.details),
          errorMessage: job.error_message,
        };
      } catch {
        video.processingDetails = {
          status: job.status,
          progress: job.progress,
          currentStep: job.current_step,
          details: null,
          errorMessage: job.error_message,
        };
      }
    }

    return video;
  }

  public static createVideo(params: {
    title: string;
    originalFilename: string;
    originalPath: string;
    fileSize: number;
    editorId: number;
    supervisorId: number;
    parentVideoId?: number | null;
    versionNumber?: number;
    ipAddress?: string;
  }): VideoDto {
    const now = new Date().toISOString();
    const status = 'PendingReview';
    const processingStatus = 'Processing';

    // Verify supervisor exists
    const supervisor = db.queryOne<{ id: number; display_name: string }>(
      'SELECT id, display_name FROM users WHERE id = ? AND role = ? AND is_active = 1',
      [params.supervisorId, 'Supervisor']
    );
    if (!supervisor) {
      throw new Error('ناظر کیفی انتخاب شده یافت نشد یا غیرفعال است.');
    }

    const editor = db.queryOne<{ id: number; display_name: string }>(
      'SELECT id, display_name FROM users WHERE id = ?',
      [params.editorId]
    );

    const res = db.run(
      `INSERT INTO videos (
        title, original_filename, original_path, editor_id, supervisor_id,
        status, processing_status, file_size, version_number, parent_video_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.title,
        params.originalFilename,
        params.originalPath,
        params.editorId,
        params.supervisorId,
        status,
        processingStatus,
        params.fileSize,
        params.versionNumber || 1,
        params.parentVideoId || null,
        now,
        now,
      ]
    );

    const newVideoId = res.lastInsertRowid;

    // Queue for transcoding background job
    TranscoderService.queueVideo(newVideoId);

    // Audit log
    AuditService.log(
      params.editorId,
      'بارگذاری ویدیو',
      'Video',
      newVideoId,
      `تدوین‌گر ویدیوی "${params.title}" (نسخه ${params.versionNumber || 1}) را بارگذاری کرد و به ناظر کیفی ${supervisor.display_name} اختصاص داد.`,
      params.ipAddress
    );

    // Notification to Supervisor
    NotificationService.create(
      params.supervisorId,
      'ویدیوی جدید برای بازبینی',
      `${editor?.display_name || 'تدوین‌گر'} پروژه "${params.title}" را جهت بازبینی ارسال نمود.`,
      'info',
      `/videos/${newVideoId}`
    );

    return this.getVideoById(newVideoId, { id: params.editorId, role: 'Editor' })!;
  }

  public static approveVideo(videoId: number, supervisor: { id: number; displayName: string; ipAddress?: string; role?: UserRole }, comment?: string): VideoDto {
    const video = db.queryOne<any>('SELECT * FROM videos WHERE id = ?', [videoId]);
    if (!video) throw new Error('ویدیو یافت نشد.');
    
    // Authorization: only the assigned supervisor or SuperAdmin can approve
    if (supervisor.role !== 'SuperAdmin' && video.supervisor_id !== supervisor.id) {
      throw new Error('شما مجاز به تایید این ویدیو نیستید. این پروژه به ناظر کیفی دیگری محول شده است.');
    }

    const now = new Date().toISOString();
    db.run(
      `UPDATE videos SET status = 'Approved', approved_at = ?, updated_at = ?, rejection_reason = NULL WHERE id = ?`,
      [now, now, videoId]
    );

    // Record review
    db.run(
      `INSERT INTO video_reviews (video_id, supervisor_id, editor_id, action, comment, created_at)
       VALUES (?, ?, ?, 'Approved', ?, ?)`,
      [videoId, supervisor.id, video.editor_id, comment || 'تایید شده توسط ناظر کیفی استودیو ۲۰نگار', now]
    );

    // Log audit
    AuditService.log(
      supervisor.id,
      'تایید ویدیو',
      'Video',
      videoId,
      `ناظر کیفی ${supervisor.displayName} ویدیوی "${video.title}" را تایید کرد: ${comment || 'بدون توضیح'}`,
      supervisor.ipAddress
    );

    // Notify Editor
    NotificationService.create(
      video.editor_id,
      'ویدیو تایید شد',
      `پروژه "${video.title}" توسط ${supervisor.displayName} تایید گردید!`,
      'success',
      `/videos/${videoId}`
    );

    // Notify Admins
    NotificationService.notifyAllAdmins(
      'ویدیوی تایید شده جدید',
      `پروژه "${video.title}" توسط ${supervisor.displayName} تایید شد و آماده تحویل در آرشیو استودیو ۲۰نگار است.`,
      'success',
      `/videos/${videoId}`
    );

    return this.getVideoById(videoId, { id: supervisor.id, role: supervisor.role || 'Supervisor' })!;
  }

  public static rejectVideo(
    videoId: number,
    supervisor: { id: number; displayName: string; ipAddress?: string; role?: UserRole },
    rejectionReason: string
  ): VideoDto {
    if (!rejectionReason || !rejectionReason.trim()) {
      throw new Error('ثبت دلیل رد پروژه الزامی است.');
    }

    const video = db.queryOne<any>('SELECT * FROM videos WHERE id = ?', [videoId]);
    if (!video) throw new Error('ویدیو یافت نشد.');
    
    // Authorization: only the assigned supervisor or SuperAdmin can reject
    if (supervisor.role !== 'SuperAdmin' && video.supervisor_id !== supervisor.id) {
      throw new Error('شما مجاز به رد این ویدیو نیستید. این پروژه به ناظر کیفی دیگری محول شده است.');
    }

    const now = new Date().toISOString();
    db.run(
      `UPDATE videos SET status = 'Rejected', rejected_at = ?, rejection_reason = ?, updated_at = ? WHERE id = ?`,
      [now, rejectionReason.trim(), now, videoId]
    );

    // Record review
    db.run(
      `INSERT INTO video_reviews (video_id, supervisor_id, editor_id, action, comment, created_at)
       VALUES (?, ?, ?, 'Rejected', ?, ?)`,
      [videoId, supervisor.id, video.editor_id, rejectionReason.trim(), now]
    );

    // Log audit
    AuditService.log(
      supervisor.id,
      'رد ویدیو جهت اصلاح',
      'Video',
      videoId,
      `ناظر کیفی ${supervisor.displayName} ویدیوی "${video.title}" را رد کرد. دلیل: ${rejectionReason.trim()}`,
      supervisor.ipAddress
    );

    // Notify Editor
    NotificationService.create(
      video.editor_id,
      'درخواست اصلاح ویدیو',
      `ناظر کیفی ${supervisor.displayName} برای ویدیوی "${video.title}" درخواست اصلاح داد: "${rejectionReason.trim()}"`,
      'warning',
      `/videos/${videoId}`
    );

    return this.getVideoById(videoId, { id: supervisor.id, role: supervisor.role || 'Supervisor' })!;
  }

  public static assignEditor(videoId: number, newEditorId: number, user: { id: number; role: UserRole; displayName: string; ipAddress?: string }): VideoDto {
    const video = db.queryOne<any>('SELECT * FROM videos WHERE id = ?', [videoId]);
    if (!video) throw new Error('ویدیو یافت نشد.');

    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && video.supervisor_id !== user.id) {
      throw new Error('تنها ناظر کیفی مسئول پروژه یا مدیر ارشد امکان تغییر تدوین‌گر را دارد.');
    }

    const newEditor = db.queryOne<UserEntity>('SELECT * FROM users WHERE id = ? AND role = ? AND is_active = 1', [newEditorId, 'Editor']);
    if (!newEditor) throw new Error('تدوین‌گر مورد نظر یافت نشد یا غیرفعال است.');

    const now = new Date().toISOString();
    db.run('UPDATE videos SET editor_id = ?, updated_at = ? WHERE id = ?', [newEditorId, now, videoId]);

    AuditService.log(
      user.id,
      'تغییر تدوین‌گر',
      'Video',
      videoId,
      `${user.displayName} تدوین‌گر ویدیوی "${video.title}" را به ${newEditor.display_name} تغییر داد.`,
      user.ipAddress
    );

    NotificationService.create(
      newEditorId,
      'پروژه جدید به شما محول شد',
      `شما به عنوان تدوین‌گر پروژه "${video.title}" منصوب شدید.`,
      'info',
      `/videos/${videoId}`
    );

    return this.getVideoById(videoId, user)!;
  }

  public static assignSupervisor(videoId: number, newSupervisorId: number, user: { id: number; role: UserRole; displayName: string; ipAddress?: string }): VideoDto {
    const video = db.queryOne<any>('SELECT * FROM videos WHERE id = ?', [videoId]);
    if (!video) throw new Error('ویدیو یافت نشد.');

    if (user.role !== 'Admin' && user.role !== 'SuperAdmin' && video.editor_id !== user.id) {
      throw new Error('تنها تدوین‌گر ایجادکننده ویدیو یا مدیر ارشد امکان انتساب ناظر کیفی را دارد.');
    }

    const newSupervisor = db.queryOne<UserEntity>('SELECT * FROM users WHERE id = ? AND role = ? AND is_active = 1', [newSupervisorId, 'Supervisor']);
    if (!newSupervisor) throw new Error('ناظر کیفی مورد نظر یافت نشد یا غیرفعال است.');

    const now = new Date().toISOString();
    db.run('UPDATE videos SET supervisor_id = ?, updated_at = ? WHERE id = ?', [newSupervisorId, now, videoId]);

    AuditService.log(
      user.id,
      'تغییر ناظر کیفی',
      'Video',
      videoId,
      `${user.displayName} ناظر کیفی پروژه "${video.title}" را به ${newSupervisor.display_name} تغییر داد.`,
      user.ipAddress
    );

    NotificationService.create(
      newSupervisorId,
      'پروژه جدید برای بازبینی محول شد',
      `ویدیوی "${video.title}" جهت بازبینی به شما محول شد.`,
      'info',
      `/videos/${videoId}`
    );

    return this.getVideoById(videoId, user)!;
  }

  /**
   * Scoped statistics: each role only sees counts for their own segmented scope.
   */
  public static getStats(user: { id: number; role: UserRole }) {
    if (user.role === 'Editor') {
      const totalVideos = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos WHERE editor_id = ?', [user.id])?.c as number) || 0;
      const pendingVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE editor_id = ? AND status = 'PendingReview'", [user.id])?.c as number) || 0;
      const approvedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE editor_id = ? AND status = 'Approved'", [user.id])?.c as number) || 0;
      const rejectedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE editor_id = ? AND status = 'Rejected'", [user.id])?.c as number) || 0;
      return { totalVideos, pendingVideos, approvedVideos, rejectedVideos, totalEditors: 1, totalSupervisors: 1 };
    }

    if (user.role === 'Supervisor') {
      const totalVideos = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos WHERE supervisor_id = ?', [user.id])?.c as number) || 0;
      const pendingVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE supervisor_id = ? AND status = 'PendingReview'", [user.id])?.c as number) || 0;
      const approvedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE supervisor_id = ? AND status = 'Approved'", [user.id])?.c as number) || 0;
      const rejectedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE supervisor_id = ? AND status = 'Rejected'", [user.id])?.c as number) || 0;
      return { totalVideos, pendingVideos, approvedVideos, rejectedVideos, totalEditors: 1, totalSupervisors: 1 };
    }

    // Admin & SuperAdmin
    const totalVideos = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos')?.c as number) || 0;
    const pendingVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE status = 'PendingReview'")?.c as number) || 0;
    const approvedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE status = 'Approved'")?.c as number) || 0;
    const rejectedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE status = 'Rejected'")?.c as number) || 0;
    const totalEditors = (db.queryOne<any>("SELECT COUNT(*) as c FROM users WHERE role = 'Editor' AND is_active = 1")?.c as number) || 0;
    const totalSupervisors = (db.queryOne<any>("SELECT COUNT(*) as c FROM users WHERE role = 'Supervisor' AND is_active = 1")?.c as number) || 0;

    return {
      totalVideos,
      pendingVideos,
      approvedVideos,
      rejectedVideos,
      totalEditors,
      totalSupervisors,
    };
  }
}
