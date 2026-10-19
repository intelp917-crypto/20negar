import { UserRole } from '../services/auth.service.ts';

export interface PolicyUser {
  id: number;
  role: UserRole;
}

export interface ReviewableVideo {
  status: string;
  processing_status: string;
  supervisor_id: number | null;
  editor_id: number;
  is_raw?: number | boolean;
}

export function canCreateRole(actor: PolicyUser, requestedRole: UserRole): boolean {
  return requestedRole !== 'SuperAdmin' || actor.role === 'SuperAdmin';
}

export function canReviewVideo(actor: PolicyUser, video: ReviewableVideo): boolean {
  // فایل خام تصویربردار تا انتشار نسخه ادیت‌شده وارد چرخه بازبینی نمی‌شود.
  if (video.is_raw) return false;
  if (video.status !== 'PendingReview' || video.processing_status !== 'Ready') return false;
  if (actor.role === 'SuperAdmin') return true;
  return actor.role === 'Supervisor' && video.supervisor_id === actor.id && video.editor_id !== actor.id;
}
