import { User, Video, AdminStats, AppNotification, AuditLog, SystemStats, UserRole, Project, ProjectFolder } from '../types/index.ts';
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

export interface InternalAccessConfig {
  enabled: boolean;
  url: string | null;
  lastHealthStatus: 'unknown' | 'healthy' | 'unavailable' | 'invalid';
  lastSuccessfulHealthCheck: string | null;
  instructions: string;
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
    const error = new Error(errorMessage) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return response.json();
}

/**
 * مسیر اصلی آپلود از TUS استفاده می‌کند. TUS فایل را به تکه‌های مستقل ارسال
 * می‌کند و سرور همان بایت‌ها را در offset درست بازسازی و قبل از نهایی‌سازی
 * SHA-256 می‌کند؛ هیچ فشرده‌سازی یا تبدیل رسانه‌ای در مسیر original انجام نمی‌شود.
 */
const FAST_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB
const FAST_PARALLELISM = 4;
const FAST_MAX_RETRIES = 4;
// Mobile connections can leave a fetch pending forever after a radio handoff.
// Bound each chunk request so the retry loop (and eventual TUS fallback) can
// make progress instead of freezing at the last completed chunk.
const FAST_CHUNK_TIMEOUT_MS = 45_000;
let transferBasesPromise: Promise<string[]> | null = null;

async function transferBases(): Promise<string[]> {
  if (transferBasesPromise) return transferBasesPromise;
  const sameOrigin = `${window.location.origin}/api/transfer`;
  transferBasesPromise = fetch('/api/health', { credentials: 'same-origin', signal: AbortSignal.timeout(3000) })
    .then(async (response) => {
      if (!response.ok) return [sameOrigin];
      const body = await response.json();
      const routes = Array.isArray(body.transferRoutes) ? body.transferRoutes.filter((route: unknown) => typeof route === 'string') : [];
      // Probe without Authorization first. Only send the bearer token after the
      // candidate proves it is the same server instance as our current origin.
      const reachable = await Promise.all(routes.map(async (route: string) => {
        try {
          const url = new URL(route);
          if (url.protocol !== window.location.protocol || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) return null;
          const probe = await fetch(`${url.origin}/api/health`, { credentials: 'omit', signal: AbortSignal.timeout(1500) });
          if (!probe.ok || (await probe.json()).instanceId !== body.instanceId) return null;
          return route;
        } catch { return null; }
      }));
      return [...reachable.filter((route): route is string => !!route && route !== sameOrigin), sameOrigin];
    })
    .catch(() => [sameOrigin]);
  return transferBasesPromise;
}

async function transferFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const bases = await transferBases();
  let lastError: unknown;
  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, { ...options, headers, signal: options.signal || AbortSignal.timeout(FAST_CHUNK_TIMEOUT_MS), mode: new URL(base).origin === window.location.origin ? 'same-origin' : 'cors' });
      // A reachable local engine returning an application error is authoritative;
      // only network failures should move to the next route.
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('مسیر انتقال در دسترس نیست.');
}

async function fastUpload(
  file: File,
  _fields: Record<string, string>,
  onProgress?: (percent: number) => void
): Promise<string> {
  const initRes = await transferFetch('/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'video/mp4',
      chunkSize: FAST_CHUNK_SIZE,
    }),
  });

  if (!initRes.ok) {
    throw new Error(`Fast upload init failed (${initRes.status}).`);
  }

  const init = await initRes.json();
  const uploadId: string = init.uploadId;
  const chunkSize: number = init.chunkSize || FAST_CHUNK_SIZE;
  const totalChunks: number = init.totalChunks;

  if (!uploadId || !totalChunks) {
    throw new Error('Fast upload session was rejected by the server.');
  }

  let nextIndex = 0;
  let completed = 0;
  let firstError: unknown = null;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex++;
      if (index >= totalChunks || firstError) return;

      const start = index * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const body = file.slice(start, end);

      let attempt = 0;
      for (;;) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FAST_CHUNK_TIMEOUT_MS);
        try {
          const res = await transferFetch(`/upload/${uploadId}/chunk/${index}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body,
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`chunk ${index} failed (${res.status})`);
          break;
        } catch (err) {
          attempt += 1;
          if (attempt > FAST_MAX_RETRIES) throw err;
          await new Promise((r) => setTimeout(r, 400 * attempt));
        } finally {
          clearTimeout(timeout);
        }
      }

      completed += 1;
      if (onProgress) {
        onProgress(Math.min(99, Math.round((completed / totalChunks) * 100)));
      }
    }
  };

  try {
    const workers = Array.from({ length: Math.min(FAST_PARALLELISM, totalChunks) }, worker);
    await Promise.all(workers);
  } catch (err) {
    firstError = err;
  }

  if (firstError) throw firstError;

  const completeRes = await transferFetch(`/upload/${uploadId}/complete`, { method: 'POST' });
  if (!completeRes.ok) {
    throw new Error(`Fast upload could not be finalized (${completeRes.status}).`);
  }

  if (onProgress) onProgress(100);
  return uploadId;
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
  getInternalAccess: () => request<InternalAccessConfig>('/api/internal-access'),
  updateInternalAccess: (config: { enabled: boolean; url: string; instructions?: string }) => request<InternalAccessConfig>('/api/internal-access', { method: 'PUT', body: JSON.stringify(config) }),
  verifyInternalAccess: () => request<InternalAccessConfig>('/api/internal-access/health-check', { method: 'POST' }),
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
  getCameramen: () => request<User[]>('/api/cameramen'),
  getSupervisors: () => request<User[]>('/api/supervisors'),
  getProjects: () => request<Project[]>('/api/projects'),
  getProjectFolders: () => request<ProjectFolder[]>('/api/projects/folders'),
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
    /** عدد = شناسه پروژه، 'none' = ویدیوهای بدون پروژه */
    projectId?: number | 'none';
    search?: string;
    sort?: string;
    onlyApproved?: boolean;
  } = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.projectId !== undefined) query.set('projectId', String(params.projectId));
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
    const upload = () => tusUpload(file, fields, onProgress);
    return upload().then((uploadId) =>
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
    const upload = () => tusUpload(file, fields, onProgress);
    return upload().then((uploadId) =>
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
  getStreamUrl: (videoId: number) => {
    const token = getStoredToken();
    return `/api/videos/${videoId}/stream?token=${encodeURIComponent(token || '')}`;
  },

  getHlsUrl: (videoId: number) => {
    const token = getStoredToken();
    return `/api/videos/${videoId}/hls/master.m3u8?token=${encodeURIComponent(token || '')}`;
  },

  getThumbnailUrl: (videoId: number) => {
    const token = getStoredToken();
    return `/api/videos/${videoId}/thumbnail?token=${encodeURIComponent(token || '')}`;
  },

  getDownloadUrl: (videoId: number) => {
    const token = getStoredToken();
    return `/api/videos/${videoId}/download?token=${encodeURIComponent(token || '')}`;
  },
};

