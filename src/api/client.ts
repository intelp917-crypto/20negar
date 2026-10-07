import { User, Video, AdminStats, AppNotification, AuditLog, SystemStats, UserRole } from '../types/index.ts';

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

const CHUNK_CONCURRENCY = 6; // تعداد چانک‌های همزمان ( موازی‌سازی = سرعت بسیار بالاتر )
const CHUNK_RETRY = 3;

async function authedFetch(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = getStoredToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...init, headers });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * آپلود چانکی موازی: فایل به تکه‌های ۴ مگابایتی تقسیم و ۶ تا همزمان ارسال می‌شود.
 * با قطعی اینترنت از همان‌جا که مانده ادامه می‌دهد (Resume) و هر چانک جداگانه retry می‌شود.
 */
async function chunkedUpload(
  file: File,
  fields: Record<string, string>,
  onProgress?: (percent: number) => void
): Promise<string> {
  const createRes = await authedFetch('/api/chunked-uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'video/mp4',
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(err.error || 'خطا در شروع آپلود.');
  }
  const session = await createRes.json();
  const uploadId: string = session.uploadId;
  const chunkSize: number = session.chunkSize;
  const totalChunks: number = session.totalChunks;
  const received: number[] = Array.isArray(session.received) ? session.received : [];

  const pending: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!received.includes(i)) pending.push(i);
  }

  let doneCount = totalChunks - pending.length;
  const metaHeader = btoa(unescape(encodeURIComponent(JSON.stringify(fields))));

  const report = () => {
    if (onProgress) onProgress(Math.min(99, Math.round((doneCount / totalChunks) * 100)));
  };
  report();

  const sendChunk = async (index: number): Promise<void> => {
    const start = index * chunkSize;
    const blob = file.slice(start, Math.min(start + chunkSize, file.size));
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= CHUNK_RETRY; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/octet-stream',
          'X-Upload-Meta': metaHeader,
        };
        const res = await authedFetch(`/api/chunked-uploads/${uploadId}/chunk/${index}`, {
          method: 'PUT',
          headers,
          body: blob,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `چانک ${index} رد شد (کد ${res.status}).`);
        }
        doneCount++;
        report();
        return;
      } catch (err: any) {
        lastError = err;
        if (attempt < CHUNK_RETRY) await sleep(500 * attempt); // backoff
      }
    }
    throw lastError || new Error(`ارسال چانک ${index} ناموفق بود.`);
  };

  // صف موازی با N worker همزمان
  const queue = [...pending];
  const workers = Array.from({ length: Math.min(CHUNK_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const index = queue.shift();
      if (index === undefined) break;
      await sendChunk(index);
    }
  });
  await Promise.all(workers);

  // تکمیل نشست
  const completeRes = await authedFetch(`/api/chunked-uploads/${uploadId}/complete`, { method: 'POST' });
  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({}));
    throw new Error(err.error || 'تکمیل آپلود ناموفق بود.');
  }
  if (onProgress) onProgress(100);
  return uploadId;
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

  // ---- آپلود چانکی موازی (فیچر ۳: آپلود فوق‌سریع، مقاوم در برابر قطعی) ----
  uploadVideo: (formData: FormData, onProgress?: (percent: number) => void) => {
    const file = formData.get('video');
    if (!(file instanceof File)) {
      return Promise.reject(new Error('فایل ویدیو یافت نشد.'));
    }
    const fields: Record<string, string> = {};
    formData.forEach((value, key) => {
      if (typeof value === 'string') fields[key] = value;
    });
    return chunkedUpload(file, fields, onProgress).then((uploadId) =>
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
    return chunkedUpload(file, fields, onProgress).then((uploadId) =>
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

