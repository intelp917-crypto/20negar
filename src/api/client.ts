import { User, Video, AdminStats, AppNotification, AuditLog, SystemStats, UserRole } from '../types/index.ts';
import { Upload as TusUpload } from 'tus-js-client';

const TOKEN_KEY = 'cineflow_auth_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (!(options.body instanceof FormData) && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMessage = `خطای سرور: کد ${response.status}`;
    try {
      const errorJson = await response.json();
      if (errorJson.error) errorMessage = errorJson.error;
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

// آپلود TUS (tus.io): تکه‌های ۱۶ مگابایتی، ازسره‌گیری بعد از قطعی و تلاش مجدد خودکار
const TUS_CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB
const TUS_RETRY_DELAYS = [0, 1000, 2000, 5000, 10000, 30000];

/**
 * آپلود فایل با پروتکل TUS:
 * - سرور رسمی @tus/server سمت بک‌اند؛ کلاینت با تکه‌های بزرگ و تلاش مجدد خودکار
 * - اگر وسط کار اینترنت قطع شود از همان‌جا ادامه می‌دهد (Resume)
 * - خروجی: شناسه نشست آپلود که برای ساخت ویدیو به POST /api/videos می‌رود
 */
async function tusUpload(
  file: File,
  fields: Record<string, string>,
  onProgress?: (percent: number) => void
): Promise<string> {
  const token = getStoredToken();

  return new Promise<string>((resolve, reject) => {
    let upload: TusUpload;

    upload = new TusUpload(file, {
      endpoint: '/api/tus',
      chunkSize: TUS_CHUNK_SIZE,
      retryDelays: TUS_RETRY_DELAYS,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: true,
      metadata: {
        filename: file.name,
        fileType: file.type || 'video/mp4',
        ...fields,
      },
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      onProgress: (bytesSent: number, bytesTotal: number) => {
        if (onProgress && bytesTotal > 0) {
          onProgress(Math.min(100, Math.round((bytesSent / bytesTotal) * 100)));
        }
      },
      onSuccess: () => {
        const url = upload.url || '';
        const uploadId = url.split('/').filter(Boolean).pop() || '';
        if (!uploadId) {
          reject(new Error('آپلود کامل نشد؛ لطفاً دوباره تلاش کنید.'));
          return;
        }
        if (onProgress) onProgress(100);
        resolve(uploadId);
      },
      onError: (err: any) => {
        let message = 'آپلود با خطا متوقف شد؛ لطفاً دوباره تلاش کنید.';
        try {
          const body = err?.originalResponse?.getBody?.();
          if (typeof body === 'string' && body.trim()) {
            try {
              const parsed = JSON.parse(body);
              if (parsed?.error) message = parsed.error;
              else message = body.trim();
            } catch {
              message = body.trim();
            }
          } else if (err?.message) {
            message = String(err.message);
          }
        } catch {
          // keep default message
        }
        reject(new Error(message));
      },
    });

    upload.start();
  });
}

export const api = {
  // Auth
  login: (credentials: { username: string; password: string }) =>
    request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),

  getCurrentUser: () => request<User>('/api/auth/me'),

  logout: () =>
    request<{ message: string }>('/api/auth/logout', {
      method: 'POST',
    }),

  // Users
  getEditors: () => request<User[]>('/api/editors'),
  getSupervisors: () => request<User[]>('/api/supervisors'),
  getAdmins: () => request<User[]>('/api/admins'),
  getAllUsers: () => request<User[]>('/api/users'),

  // SuperAdmin User Management
  createUser: (data: { username: string; password: string; role: UserRole; displayName: string }) =>
    request<User>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateUser: (id: number, data: { displayName?: string; role?: UserRole; isActive?: boolean }) =>
    request<User>(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  resetUserPassword: (id: number, newPassword: string) =>
    request<{ success: boolean; message: string }>(`/api/users/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ newPassword }),
    }),

  deleteUser: (id: number) =>
    request<{ success: boolean; message: string }>(`/api/users/${id}`, {
      method: 'DELETE',
    }),

  // System Stats (SuperAdmin)
  getSystemStats: () => request<SystemStats>('/api/system/stats'),

  // Videos
  getVideos: (params: {
    status?: string;
    editorId?: number;
    supervisorId?: number;
    search?: string;
    sort?: string;
    onlyApproved?: boolean;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.editorId) query.set('editorId', String(params.editorId));
    if (params.supervisorId) query.set('supervisorId', String(params.supervisorId));
    if (params.search) query.set('search', params.search);
    if (params.sort) query.set('sort', params.sort);
    if (params.onlyApproved !== undefined) query.set('onlyApproved', String(params.onlyApproved));

    const qs = query.toString();
    return request<Video[]>(`/api/videos${qs ? `?${qs}` : ''}`);
  },

  getVideoById: (id: number) => request<Video>(`/api/videos/${id}`),

  deleteVideo: (id: number) =>
    request<{ success: boolean; message: string }>(`/api/videos/${id}`, {
      method: 'DELETE',
    }),

  getJobStatus: (videoId: number) => request<any>(`/api/videos/${videoId}/job-status`),

  getAdminStats: () => request<AdminStats>('/api/videos/stats'),

  // ---- آپلود TUS (پروتکل استاندارد tus.io: سریع، ازسره‌گیر، مقاوم در برابر قطعی) ----
  uploadVideo: (formData: FormData, onProgress?: (percent: number) => void) => {
    const file = formData.get('video');
    if (!(file instanceof File)) {
      return Promise.reject(new Error('فایل ویدیو یافت نشد.'));
    }
    const fields: Record<string, string> = {};
    formData.forEach((value, key) => {
      if (typeof value === 'string') fields[key] = value;
    });
    return tusUpload(file, fields, onProgress).then((uploadId) =>
      request<Video>('/api/videos', {
        method: 'POST',
        body: JSON.stringify({ uploadId, ...fields }),
      })
    );
  },

  uploadNewVersion: (videoId: number, formData: FormData, onProgress?: (percent: number) => void) => {
    const file = formData.get('video');
    if (!(file instanceof File)) {
      return Promise.reject(new Error('فایل ویدیو یافت نشد.'));
    }
    const fields: Record<string, string> = {};
    formData.forEach((value, key) => {
      if (typeof value === 'string') fields[key] = value;
    });
    return tusUpload(file, fields, onProgress).then((uploadId) =>
      request<Video>(`/api/videos/${videoId}/versions`, {
        method: 'POST',
        body: JSON.stringify({ uploadId, ...fields }),
      })
    );
  },

  approveVideo: (videoId: number, comment?: string, adminId?: number | null) =>
    request<Video>(`/api/videos/${videoId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comment, adminId }),
    }),

  rejectVideo: (videoId: number, reason: string) =>
    request<Video>(`/api/videos/${videoId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  assignEditor: (videoId: number, editorId: number) =>
    request<Video>(`/api/videos/${videoId}/assign-editor`, {
      method: 'POST',
      body: JSON.stringify({ editorId }),
    }),

  assignSupervisor: (videoId: number, supervisorId: number) =>
    request<Video>(`/api/videos/${videoId}/assign-supervisor`, {
      method: 'POST',
      body: JSON.stringify({ supervisorId }),
    }),

  assignAdmin: (videoId: number, adminId: number | null) =>
    request<Video>(`/api/videos/${videoId}/assign-admin`, {
      method: 'POST',
      body: JSON.stringify({ adminId }),
    }),

  // Notifications
  getNotifications: () => request<AppNotification[]>('/api/notifications'),
  markNotificationRead: (id: number) =>
    request<{ success: boolean }>(`/api/notifications/${id}/read`, { method: 'PUT' }),
  markAllNotificationsRead: () =>
    request<{ success: boolean }>('/api/notifications/read-all', { method: 'PUT' }),

  // Audit Logs
  getAuditLogs: (params: { limit?: number; action?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit) query.set('limit', String(params.limit));
    if (params.action) query.set('action', params.action);
    const qs = query.toString();
    return request<AuditLog[]>(`/api/audit-logs${qs ? `?${qs}` : ''}`);
  },

  // Transcode reprocessing
  reprocessVideo: (videoId: number) =>
    request<{ success: boolean; message: string }>(`/api/videos/${videoId}/reprocess`, {
      method: 'POST',
    }),

  // Database & Telemetry
  optimizeDatabase: () =>
    request<{ success: boolean; message: string }>('/api/system/optimize-db', {
      method: 'POST',
    }),

  getTranscodeJobs: () =>
    request<any[]>('/api/system/transcode-jobs'),

  // Self-update from GitHub repo (SuperAdmin)
  getUpdateStatus: () =>
    request<{ repo: string; gitAvailable: boolean; isRepo: boolean; localSha: string | null; remoteSha: string | null; upToDate: boolean | null; tokenConfigured: boolean; message: string }>(
      '/api/system/update-status'
    ),

  forceUpdate: () =>
    request<{ success: boolean; changed: boolean; filesChanged: number; npmInstalled: boolean; restarting: boolean; error?: string; message: string }>(
      '/api/system/update',
      { method: 'POST' }
    ),

  getExportDbUrl: () => {
    const token = getStoredToken();
    return `/api/system/export-db?token=${encodeURIComponent(token || '')}`;
  },

  // Media URL helper
  getStreamUrl: (videoId: number, quality?: string) => {
    const token = getStoredToken();
    const q = quality && quality !== 'Auto' ? `&quality=${encodeURIComponent(quality)}` : '';
    return `/api/videos/${videoId}/stream?token=${encodeURIComponent(token || '')}${q}`;
  },

  getHlsUrl: (videoId: number) => {
    const token = getStoredToken();
    return `/api/videos/${videoId}/hls/master.m3u8?token=${encodeURIComponent(token || '')}`;
  },

  getThumbnailUrl: (videoId: number) => {
    const token = getStoredToken();
    return `/api/videos/${videoId}/thumbnail?token=${encodeURIComponent(token || '')}`;
  },

  getDownloadUrl: (videoId: number, quality?: string) => {
    const token = getStoredToken();
    const q = quality ? `&quality=${encodeURIComponent(quality)}` : '';
    return `/api/videos/${videoId}/download?token=${encodeURIComponent(token || '')}${q}`;
  },
};

