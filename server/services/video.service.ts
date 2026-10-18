import { db } from '../db/database.ts';
import { UserEntity, UserRole } from './auth.service.ts';
import { AuditService } from './audit.service.ts';
import { NotificationService } from './notification.service.ts';
import { canReviewVideo } from '../authorization/policy.ts';
import { TranscoderService } from './transcoder.service.ts';
import { ProjectDto } from './project.service.ts';

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
  adminId: number | null;
  adminName: string | null;
  adminUsername: string | null;
  uploadedById: number | null;
  uploadedByName: string | null;
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
  projectId: number | null;
  project: ProjectDto | null;
}

export interface VideoFilters {
  status?: string;
  editorId?: number;
  supervisorId?: number;
  /** عدد = یک پروژه مشخص، 'none' = ویدیوهای بدون پروژه */
  projectId?: number | 'none';
  search?: string;
  sort?: 'newest' | 'oldest' | 'largest' | 'smallest';
  onlyApproved?: boolean;
}

export interface ProjectFolderDto {
  projectId: number | null;
  name: string;
  description: string | null;
  clientName: string | null;
  projectCode: string | null;
  status: 'active' | 'archived';
  isConfidential: boolean;
  videoCount: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  lastVideoAt: string | null;
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
        v.admin_id as adminId, ad.display_name as adminName, ad.username as adminUsername,
        v.uploaded_by_id as uploadedById, ub.display_name as uploadedByName,
        v.status, v.processing_status as processingStatus, v.duration,
        v.original_resolution as originalResolution, v.file_size as fileSize,
        v.version_number as versionNumber, v.parent_video_id as parentVideoId,
        v.rejection_reason as rejectionReason, v.created_at as createdAt,
         v.updated_at as updatedAt, v.approved_at as approvedAt, v.rejected_at as rejectedAt,
         p.id as projectId, p.name as projectName, p.description as projectDescription,
         p.client_name as projectClientName, p.project_code as projectCode, p.status as projectStatus,
         p.is_confidential as projectIsConfidential, p.created_by_id as projectCreatedById,
         p.created_at as projectCreatedAt, p.updated_at as projectUpdatedAt
      FROM videos v
      JOIN users ed ON v.editor_id = ed.id
      JOIN users sp ON v.supervisor_id = sp.id
      LEFT JOIN users ad ON v.admin_id = ad.id
      LEFT JOIN users ub ON v.uploaded_by_id = ub.id
      LEFT JOIN projects p ON v.project_id = p.id
      WHERE 1=1
    `;
    // STRICT USER DATA ISOLATION (هر کسی فقط ویدیوهای خودش را می‌بیند)
    const scope = this.roleScope(user);
    sql += scope.clause;
    const params: any[] = [...scope.params];

    if (user.role === 'SuperAdmin') {
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

    if (filters.projectId === 'none') {
      sql += ` AND v.project_id IS NULL`;
    } else if (typeof filters.projectId === 'number' && Number.isSafeInteger(filters.projectId) && filters.projectId > 0) {
      sql += ` AND v.project_id = ?`;
      params.push(filters.projectId);
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

    const videos = db.query<any>(sql, params).map((video) => this.withProject(video));

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
        v.admin_id as adminId, ad.display_name as adminName, ad.username as adminUsername,
        v.uploaded_by_id as uploadedById, ub.display_name as uploadedByName,
        v.status, v.processing_status as processingStatus, v.duration,
        v.original_resolution as originalResolution, v.file_size as fileSize,
        v.version_number as versionNumber, v.parent_video_id as parentVideoId,
        v.rejection_reason as rejectionReason, v.created_at as createdAt,
         v.updated_at as updatedAt, v.approved_at as approvedAt, v.rejected_at as rejectedAt,
         p.id as projectId, p.name as projectName, p.description as projectDescription,
         p.client_name as projectClientName, p.project_code as projectCode, p.status as projectStatus,
         p.is_confidential as projectIsConfidential, p.created_by_id as projectCreatedById,
         p.created_at as projectCreatedAt, p.updated_at as projectUpdatedAt
      FROM videos v
      JOIN users ed ON v.editor_id = ed.id
      JOIN users sp ON v.supervisor_id = sp.id
      LEFT JOIN users ad ON v.admin_id = ad.id
      LEFT JOIN users ub ON v.uploaded_by_id = ub.id
      LEFT JOIN projects p ON v.project_id = p.id
      WHERE v.id = ?
    `;
    const rawVideo = db.queryOne<any>(sql, [videoId]);
    const video = rawVideo ? this.withProject(rawVideo) : null;
    if (!video) return null;

    // Strict Authorization Check:
    if (user.role === 'Editor' && video.editorId !== user.id && video.uploadedById === null) {
      return null;
    }
    if (user.role === 'Cameraman' && video.uploadedById !== user.id) {
      return null;
    }
    if (user.role === 'Supervisor' && video.supervisorId !== user.id) {
      return null;
    }
    if (user.role === 'Admin' && (video.status !== 'Approved' || video.adminId !== user.id)) {
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
    uploadedById?: number | null;
    parentVideoId?: number | null;
    projectId?: number | null;
    versionNumber?: number;
    ipAddress?: string;
  }): VideoDto {
    const now = new Date().toISOString();
    const status = 'PendingReview';
    // Original files are streamed as uploaded. Do not enqueue FFmpeg/transcoding
    // jobs: playback must not depend on a server-side quality ladder.
    const processingStatus = 'Ready';

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
         title, original_filename, original_path, editor_id, supervisor_id, uploaded_by_id, project_id,
        status, processing_status, file_size, version_number, parent_video_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.title,
        params.originalFilename,
        params.originalPath,
        params.editorId,
        params.supervisorId,
        params.uploadedById ?? null,
        params.projectId ?? null,
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

    const uploadedByCameraman = Boolean(params.uploadedById);
    const uploaderLabel = uploadedByCameraman ? 'تصویربردار' : 'تدوین‌گر';

    // Audit log
    AuditService.log(
      params.editorId,
      uploadedByCameraman ? 'بارگذاری فایل خام توسط تصویربردار' : 'بارگذاری ویدیو',
      'Video',
      newVideoId,
      `${uploaderLabel} ویدیوی "${params.title}" (نسخه ${params.versionNumber || 1}) را بارگذاری کرد و به ناظر کیفی ${supervisor.display_name} اختصاص داد.`,
      params.ipAddress
    );

    // Notification to Supervisor
    NotificationService.create(
      params.supervisorId,
      'ویدیوی جدید برای بازبینی',
      `${editor?.display_name || uploaderLabel} پروژه "${params.title}" را جهت بازبینی ارسال نمود.`,
      'info',
      `/videos/${newVideoId}`
    );

    return this.getVideoById(newVideoId, {
      id: params.editorId,
      role: uploadedByCameraman ? 'Cameraman' : 'Editor',
    })!;
  }

  /**
   * همان محدوده دسترسی لیست ویدیوها، برای گروه‌بندی سبک پوشه‌های پروژه.
   * هیچ ردیفی از ویدیوها به فرانت‌اند نمی‌رود؛ فقط شمارش تجمیعی.
   */
  private static roleScope(user: { id: number; role: UserRole }): { clause: string; params: any[] } {
    switch (user.role) {
      case 'Editor':
        // Editor sees their own videos plus raw footage uploaded by cameramen.
        return { clause: ' AND (v.editor_id = ? OR v.uploaded_by_id IS NOT NULL)', params: [user.id] };
      case 'Cameraman':
        return { clause: ' AND v.uploaded_by_id = ?', params: [user.id] };
      case 'Supervisor':
        return { clause: ' AND v.supervisor_id = ?', params: [user.id] };
      case 'Admin':
        return { clause: " AND v.status = 'Approved' AND v.admin_id = ?", params: [user.id] };
      default:
        return { clause: '', params: [] };
    }
  }

  /**
   * فهرست پوشه‌های پروژه برای پنل کاربر جاری.
   * فقط پروژه‌هایی برمی‌گردند که کاربر حداقل یک ویدیوی قابل‌مشاهده در آن‌ها دارد،
   * به‌همراه یک پوشه مجازی «بدون پروژه» برای ویدیوهای قدیمی.
   */
  public static getProjectFolders(
    user: { id: number; role: UserRole },
    database: { query: <T = any>(sql: string, params?: any[]) => T[] } = db
  ): ProjectFolderDto[] {
    const scope = this.roleScope(user);
    const rows = database.query<any>(
      `SELECT
         v.project_id as projectId,
         p.name as name, p.description as description, p.client_name as clientName,
         p.project_code as projectCode, p.status as projectStatus,
         p.is_confidential as isConfidential,
         COUNT(*) as videoCount,
         SUM(CASE WHEN v.status = 'Approved' THEN 1 ELSE 0 END) as approvedCount,
         SUM(CASE WHEN v.status = 'PendingReview' THEN 1 ELSE 0 END) as pendingCount,
         SUM(CASE WHEN v.status = 'Rejected' THEN 1 ELSE 0 END) as rejectedCount,
         MAX(v.created_at) as lastVideoAt
       FROM videos v
       LEFT JOIN projects p ON v.project_id = p.id
      WHERE 1=1${scope.clause}
      GROUP BY v.project_id, p.name, p.description, p.client_name, p.project_code, p.status, p.is_confidential
      ORDER BY lastVideoAt DESC, name COLLATE NOCASE ASC`,
      scope.params
    );

    return rows.map((row) => {
      const projectId = row.projectId == null ? null : Number(row.projectId);
      return {
        projectId,
        name: projectId === null ? 'بدون پروژه' : String(row.name || 'پروژه بدون نام'),
        description: projectId === null ? null : row.description ?? null,
        clientName: projectId === null ? null : row.clientName ?? null,
        projectCode: projectId === null ? null : row.projectCode ?? null,
        status: projectId === null ? 'active' : (row.projectStatus === 'archived' ? 'archived' : 'active'),
        isConfidential: projectId === null ? false : Boolean(row.isConfidential),
        videoCount: Number(row.videoCount) || 0,
        approvedCount: Number(row.approvedCount) || 0,
        pendingCount: Number(row.pendingCount) || 0,
        rejectedCount: Number(row.rejectedCount) || 0,
        lastVideoAt: row.lastVideoAt ?? null,
      };
    });
  }

  private static withProject(video: any): VideoDto {
    const projectId = video.projectId == null ? null : Number(video.projectId);
    video.projectId = projectId;
    video.project = projectId === null ? null : {
      id: projectId, name: video.projectName, description: video.projectDescription ?? null,
      clientName: video.projectClientName ?? null, projectCode: video.projectCode ?? null,
      status: video.projectStatus, isConfidential: Boolean(video.projectIsConfidential),
      createdById: Number(video.projectCreatedById), createdAt: video.projectCreatedAt, updatedAt: video.projectUpdatedAt,
    };
    delete video.projectName; delete video.projectDescription; delete video.projectClientName;
    delete video.projectCode; delete video.projectStatus; delete video.projectIsConfidential;
    delete video.projectCreatedById; delete video.projectCreatedAt; delete video.projectUpdatedAt;
    return video as VideoDto;
  }

  public static approveVideo(
    videoId: number,
    supervisor: { id: number; displayName: string; ipAddress?: string; role?: UserRole },
    comment?: string,
    adminId?: number | null
  ): VideoDto {
    const video = db.queryOne<any>('SELECT * FROM videos WHERE id = ?', [videoId]);
    if (!video) throw new Error('ویدیو یافت نشد.');

    if (!canReviewVideo({ id: supervisor.id, role: supervisor.role || 'Supervisor' }, video)) {
      throw new Error('تنها ویدیوی آماده و در وضعیت انتظار بازبینی قابل تایید است.');
    }
    
    // Authorization: only the assigned supervisor or SuperAdmin can approve
    if (!canReviewVideo({ id: supervisor.id, role: supervisor.role || 'Supervisor' }, video)) {
      throw new Error('شما مجاز به تایید این ویدیو نیستید. این پروژه به ناظر کیفی دیگری محول شده است.');
    }

    const now = new Date().toISOString();
    let targetAdminId: number | null = null;
    let targetAdminName: string | null = null;

    if (adminId && adminId > 0) {
      const admin = db.queryOne<UserEntity>(
        'SELECT * FROM users WHERE id = ? AND role = ? AND is_active = 1',
        [adminId, 'Admin']
      );
      if (admin) {
        targetAdminId = admin.id;
        targetAdminName = admin.display_name;
      }
    }

    db.run(
      `UPDATE videos SET status = 'Approved', approved_at = ?, rejected_at = NULL, updated_at = ?, rejection_reason = NULL, admin_id = COALESCE(?, admin_id) WHERE id = ?`,
      [now, now, targetAdminId, videoId]
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
      `ناظر کیفی ${supervisor.displayName} ویدیوی "${video.title}" را تایید کرد` +
        (targetAdminName ? ` و به ادمین ${targetAdminName} اختصاص داد.` : ': ' + (comment || 'بدون توضیح')),
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
    if (targetAdminId) {
      NotificationService.create(
        targetAdminId,
        'ویدیوی تایید شده جدید در پنل شما',
        `پروژه "${video.title}" توسط ${supervisor.displayName} تایید شد و اختصاصاً به پنل شما واگذار گردید.`,
        'success',
        `/videos/${videoId}`
      );
    } else {
      NotificationService.notifyAllAdmins(
        'ویدیوی تایید شده جدید',
        `پروژه "${video.title}" توسط ${supervisor.displayName} تایید شد و آماده تحویل در آرشیو استودیو ۲۰نگار است.`,
        'success',
        `/videos/${videoId}`
      );
    }

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

    if (!canReviewVideo({ id: supervisor.id, role: supervisor.role || 'Supervisor' }, video)) {
      throw new Error('تنها ویدیوی آماده و در وضعیت انتظار بازبینی قابل رد است.');
    }
    
    // Authorization: only the assigned supervisor or SuperAdmin can reject
    if (!canReviewVideo({ id: supervisor.id, role: supervisor.role || 'Supervisor' }, video)) {
      throw new Error('شما مجاز به رد این ویدیو نیستید. این پروژه به ناظر کیفی دیگری محول شده است.');
    }

    const now = new Date().toISOString();
    db.run(
      `UPDATE videos SET status = 'Rejected', rejected_at = ?, rejection_reason = ?, approved_at = NULL, admin_id = NULL, updated_at = ? WHERE id = ?`,
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

  public static assignEditor(_videoId: number, _newEditorId: number, _user: { id: number; role: UserRole; displayName: string; ipAddress?: string }): VideoDto {
    throw new Error('امکان تغییر تدوین‌گر ویدیو وجود ندارد. سازنده/تدوین‌گر ویدیو در هیچ پنلی قابل تغییر نیست.');
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
   * انتساب ویدیو به یک ادمین مشخص (توسط ناظر کیفی مسئول پروژه یا مدیرکل).
   * پس از تایید ناظر، ادمین انتخاب می‌شود و ویدیو فقط در پنل همان ادمین دیده می‌شود.
   */
  public static assignAdmin(
    videoId: number,
    adminId: number | null,
    user: { id: number; role: UserRole; displayName: string; ipAddress?: string }
  ): VideoDto {
    const video = db.queryOne<any>('SELECT * FROM videos WHERE id = ?', [videoId]);
    if (!video) throw new Error('ویدیو یافت نشد.');

    // Only SuperAdmin OR the assigned Supervisor can assign an Admin
    if (user.role !== 'SuperAdmin' && (user.role !== 'Supervisor' || video.supervisor_id !== user.id)) {
      throw new Error('تنها ناظر کیفی مسئول این پروژه یا مدیرکل امکان تعیین ادمین مقصد را دارند.');
    }

    let adminName: string | null = null;
    if (adminId !== null && adminId > 0) {
      const admin = db.queryOne<UserEntity>(
        'SELECT * FROM users WHERE id = ? AND role = ? AND is_active = 1',
        [adminId, 'Admin']
      );
      if (!admin) throw new Error('ادمین مورد نظر یافت نشد یا غیرفعال است.');
      adminName = admin.display_name;
    } else {
      adminId = null;
    }

    const now = new Date().toISOString();
    db.run('UPDATE videos SET admin_id = ?, updated_at = ? WHERE id = ?', [adminId, now, videoId]);

    AuditService.log(
      user.id,
      adminId ? 'انتساب ویدیو به ادمین' : 'لغو انتساب ادمین',
      'Video',
      videoId,
      adminId
        ? `${user.displayName} ویدیوی "${video.title}" را به ادمین ${adminName} منتقل کرد.`
        : `${user.displayName} انتساب ادمین ویدیوی "${video.title}" را لغو کرد.`,
      user.ipAddress
    );

    if (adminId) {
      NotificationService.create(
        adminId,
        'ویدیوی جدید به آرشیو شما اضافه شد',
        `پروژه "${video.title}" توسط ${user.displayName} به پنل شما منتقل شد.`,
        'info',
        `/videos/${videoId}`
      );
    }

    return this.getVideoById(videoId, user)!;
  }

  /**
   * حذف ویدیو توسط مدیرکل، تدوین‌گر یا ناظر کیفی (فیچر ۵)
   * - مدیرکل: حذف هر ویدیویی
   * - تدوین‌گر: فقط ویدیوهای بارگذاری‌شده توسط خود
   * - ناظر کیفی: فقط ویدیوهای محول‌شده به خود
   */
  public static async deleteVideo(
    videoId: number,
    user: { id: number; role: UserRole; displayName: string; ipAddress?: string }
  ): Promise<{ success: boolean; message: string }> {
    const video = db.queryOne<any>('SELECT * FROM videos WHERE id = ?', [videoId]);
    if (!video) {
      throw new Error('ویدیو یافت نشد.');
    }

    const isSuperAdmin = user.role === 'SuperAdmin';
    const isOwnerEditor = user.role === 'Editor' && video.editor_id === user.id;
    const isAssignedSupervisor = user.role === 'Supervisor' && video.supervisor_id === user.id;
    const isOwnerCameraman = user.role === 'Cameraman' && video.uploaded_by_id === user.id;

    if (!isSuperAdmin && !isOwnerEditor && !isAssignedSupervisor && !isOwnerCameraman) {
      throw new Error('شما دسترسی مجاز برای حذف این ویدیو را ندارید.');
    }

    // پاکسازی فایل‌های فیزیکی
    try {
      const { fileStorage } = await import('../storage/local.storage.ts');
      const { PRIVATE_VIDEOS_DIR, PRIVATE_HLS_DIR } = await import('../config.ts');
      const path = (await import('path')).default;
      const fs = (await import('fs')).default;

      if (video.original_path) {
        await fileStorage.deleteFile(video.original_path).catch(() => {});
      }
      if (video.thumbnail_path) {
        await fileStorage.deleteFile(video.thumbnail_path).catch(() => {});
      }

      const qualities = db.query<any>('SELECT quality FROM video_qualities WHERE video_id = ?', [videoId]);
      for (const q of qualities) {
        const qFile = path.join(PRIVATE_VIDEOS_DIR, `video_${videoId}_${q.quality}.mp4`);
        if (fs.existsSync(qFile)) {
          try { fs.unlinkSync(qFile); } catch {}
        }
      }

      // پوشه HLS واقعی: data/storage/hls/video_<id> (شامل زیرپوشه‌های نردبان کیفیت)
      const hlsDir = path.join(PRIVATE_HLS_DIR, `video_${videoId}`);
      if (fs.existsSync(hlsDir)) {
        try { fs.rmSync(hlsDir, { recursive: true, force: true }); } catch {}
      }
    } catch (fErr) {
      console.warn('Physical file deletion warning:', fErr);
    }

    // حذف رکوردها از پایگاه داده
    // (جدول واقعی processing_jobs است؛ جدولی به نام transcoding_jobs وجود ندارد)
    db.run('DELETE FROM video_reviews WHERE video_id = ?', [videoId]);
    db.run('DELETE FROM video_qualities WHERE video_id = ?', [videoId]);
    try {
      db.run('DELETE FROM processing_jobs WHERE video_id = ?', [videoId]);
    } catch (jobErr) {
      console.warn('processing_jobs cleanup warning:', jobErr);
    }
    db.run('DELETE FROM videos WHERE id = ?', [videoId]);

    AuditService.log(
      user.id,
      'حذف ویدیو',
      'Video',
      videoId,
      `ویدیوی "${video.title}" توسط ${user.displayName} (${user.role === 'SuperAdmin' ? 'مدیرکل' : user.role === 'Editor' ? 'تدوین‌گر' : 'ناظر کیفی'}) حذف شد.`,
      user.ipAddress
    );

    return { success: true, message: 'ویدیو با موفقیت حذف شد.' };
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

    if (user.role === 'Cameraman') {
      const totalVideos = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos WHERE uploaded_by_id = ?', [user.id])?.c as number) || 0;
      const pendingVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE uploaded_by_id = ? AND status = 'PendingReview'", [user.id])?.c as number) || 0;
      const approvedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE uploaded_by_id = ? AND status = 'Approved'", [user.id])?.c as number) || 0;
      const rejectedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE uploaded_by_id = ? AND status = 'Rejected'", [user.id])?.c as number) || 0;
      return { totalVideos, pendingVideos, approvedVideos, rejectedVideos, totalEditors: 1, totalSupervisors: 1 };
    }

    if (user.role === 'Supervisor') {
      const totalVideos = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos WHERE supervisor_id = ?', [user.id])?.c as number) || 0;
      const pendingVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE supervisor_id = ? AND status = 'PendingReview'", [user.id])?.c as number) || 0;
      const approvedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE supervisor_id = ? AND status = 'Approved'", [user.id])?.c as number) || 0;
      const rejectedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE supervisor_id = ? AND status = 'Rejected'", [user.id])?.c as number) || 0;
      return { totalVideos, pendingVideos, approvedVideos, rejectedVideos, totalEditors: 1, totalSupervisors: 1 };
    }

    const totalEditors = (db.queryOne<any>("SELECT COUNT(*) as c FROM users WHERE role = 'Editor' AND is_active = 1")?.c as number) || 0;
    const totalSupervisors = (db.queryOne<any>("SELECT COUNT(*) as c FROM users WHERE role = 'Supervisor' AND is_active = 1")?.c as number) || 0;

    // Admin: فقط ویدیوهایی که مدیرکل به همین ادمین انتساب داده است
    if (user.role === 'Admin') {
      const totalVideos = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos WHERE admin_id = ? AND status = ?', [user.id, 'Approved'])?.c as number) || 0;
      const pendingVideos = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos WHERE admin_id = ? AND status = ?', [user.id, 'PendingReview'])?.c as number) || 0;
      const approvedVideos = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos WHERE admin_id = ? AND status = ?', [user.id, 'Approved'])?.c as number) || 0;
      const rejectedVideos = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos WHERE admin_id = ? AND status = ?', [user.id, 'Rejected'])?.c as number) || 0;
      return { totalVideos, pendingVideos, approvedVideos, rejectedVideos, totalEditors, totalSupervisors };
    }

    // SuperAdmin: دیدگاه سراسری
    const totalVideos = (db.queryOne<any>('SELECT COUNT(*) as c FROM videos')?.c as number) || 0;
    const pendingVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE status = 'PendingReview'")?.c as number) || 0;
    const approvedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE status = 'Approved'")?.c as number) || 0;
    const rejectedVideos = (db.queryOne<any>("SELECT COUNT(*) as c FROM videos WHERE status = 'Rejected'")?.c as number) || 0;

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
