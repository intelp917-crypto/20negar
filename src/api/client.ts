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

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
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

  uploadVideo: (formData: FormData, onProgress?: (percent: number) => void) => {
    return new Promise<Video>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/videos');

      const token = getStoredToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error('پاسخ نامعتبر از سرور'));
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `بارگذاری با خطای ${xhr.status} متوقف شد.`));
          } catch {
            reject(new Error(`بارگذاری با خطای ${xhr.status} متوقف شد.`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('خطای ارتباط شبکه در حین بارگذاری فایل.'));
      xhr.send(formData);
    });
  },

  uploadNewVersion: (videoId: number, formData: FormData, onProgress?: (percent: number) => void) => {
    return new Promise<Video>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/videos/${videoId}/versions`);

      const token = getStoredToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error('پاسخ نامعتبر از سرور'));
          }
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            reject(new Error(err.error || `بارگذاری نسخه جدید با خطای ${xhr.status} متوقف شد.`));
          } catch {
            reject(new Error(`بارگذاری نسخه جدید با خطای ${xhr.status} متوقف شد.`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('خطای شبکه در حین ارسال نسخه جدید.'));
      xhr.send(formData);
    });
  },

  approveVideo: (videoId: number, comment?: string) =>
    request<Video>(`/api/videos/${videoId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
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

