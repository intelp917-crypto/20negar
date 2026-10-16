import { UserRole } from '../services/auth.service.ts';

export interface PolicyUser {
  id: number;
  role: UserRole;
}

export interface ReviewableVideo {
  status: string;
  processing_status: string;
  supervisor_id: number;
  editor_id: number;
}

export function canCreateRole(actor: PolicyUser, requestedRole: UserRole): boolean {
  return requestedRole !== 'SuperAdmin' || actor.role === 'SuperAdmin';
}

export function canReviewVideo(actor: PolicyUser, video: ReviewableVideo): boolean {
  if (video.status !== 'PendingReview' || video.processing_status !== 'Ready') return false;
  if (actor.role === 'SuperAdmin') return true;
  return actor.role === 'Supervisor' && video.supervisor_id === actor.id && video.editor_id !== actor.id;
}
