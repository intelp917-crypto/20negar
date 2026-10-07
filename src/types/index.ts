export type UserRole = 'SuperAdmin' | 'Admin' | 'Editor' | 'Supervisor';

export interface User {
  id: number;
  username: string;
  role: UserRole;
  displayName: string;
  isActive: boolean;
  createdAt: string;
}

export type VideoStatus = 'Uploaded' | 'PendingReview' | 'Approved' | 'Rejected';
export type ProcessingStatus = 'Uploading' | 'Processing' | 'Ready' | 'ProcessingFailed';
export type QualityName = 'Original' | '1080p' | '720p' | '480p' | '360p';

export interface VideoQuality {
  id: number;
  quality: QualityName;
  width: number;
  height: number;
  bitrate: number;
  fileSize: number;
}

export interface VideoReview {
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

export interface ProcessingDetails {
  status: string;
  progress: number;
  currentStep: string;
  details: {
    original?: 'completed';
    thumbnail?: 'pending' | 'processing' | 'completed' | 'failed';
    '1080p'?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    '720p'?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    '480p'?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    '360p'?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
    hls?: 'pending' | 'processing' | 'completed' | 'failed';
  } | null;
  errorMessage?: string | null;
}

export interface Video {
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
  status: VideoStatus;
  processingStatus: ProcessingStatus;
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
  qualities?: VideoQuality[];
  reviews?: VideoReview[];
  processingDetails?: ProcessingDetails;
}

export interface AuditLog {
  id: number;
  userId: number | null;
  username?: string;
  userRole?: string;
  action: string;
  entityType: string;
  entityId: number | null;
  description: string;
  ipAddress: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: number;
  userId: number;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

export interface AdminStats {
  totalVideos: number;
  pendingVideos: number;
  approvedVideos: number;
  rejectedVideos: number;
  totalEditors: number;
  totalSupervisors: number;
}

export interface DatabaseTelemetry {
  engine: string;
  fileSizeBytes: number;
  cacheSizeMB: number;
  tables: { name: string; count: number }[];
  totalIndices: number;
  healthStatus: string;
}

export interface TranscodeJobItem {
  id: number;
  videoId: number;
  videoTitle: string;
  originalFilename: string;
  editorName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStep: string;
  details: any;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemStats {
  totalStorageBytes: number;
  videoCount: number;
  userCount: number;
  reviewCount: number;
  logCount: number;
  serverTime: string;
  uptimeSeconds: number;
  dbTelemetry?: DatabaseTelemetry;
}

