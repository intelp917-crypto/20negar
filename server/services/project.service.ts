import { db } from '../db/database.ts';
import { UserRole } from './auth.service.ts';

export interface ProjectUser { id: number; role: UserRole; }

export interface VideoProjectSelection {
  projectId?: number | string | null;
  projectName?: string;
  projectDescription?: string;
  clientName?: string;
  projectCode?: string;
  isConfidential?: boolean | string;
}

export class ProjectSelectionError extends Error {
  constructor(public readonly message: string, public readonly code: 'missing_selection' | 'project_access_denied', public readonly status: number) {
    super(message);
    this.name = 'ProjectSelectionError';
  }
}

export interface ProjectDto {
  id: number;
  name: string;
  description: string | null;
  clientName: string | null;
  projectCode: string | null;
  status: 'active' | 'archived';
  isConfidential: boolean;
  createdById: number;
  createdAt: string;
  updatedAt: string;
}

function toProject(row: any): ProjectDto {
  return {
    id: Number(row.id), name: row.name, description: row.description ?? null,
    clientName: row.clientName ?? null, projectCode: row.projectCode ?? null,
    status: row.status, isConfidential: Boolean(row.isConfidential),
    createdById: Number(row.createdById), createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export function canCreateProject(user: ProjectUser): boolean {
  return ['SuperAdmin', 'Editor', 'Cameraman'].includes(user.role);
}

export function canManageProject(user: ProjectUser, project: ProjectDto): boolean {
  return user.role === 'SuperAdmin' || project.createdById === user.id || user.role === 'Admin';
}

export function resolveVideoProject(user: ProjectUser, input: VideoProjectSelection, dependencies: {
  getProject?: (user: ProjectUser, id: number) => ProjectDto | null;
  createProject?: (user: ProjectUser, input: { name: string; description?: string; clientName?: string; projectCode?: string; isConfidential?: boolean }) => ProjectDto;
} = {}): ProjectDto {
  const rawProjectId = input.projectId;
  if (rawProjectId !== undefined && rawProjectId !== null && String(rawProjectId).trim() !== '') {
    const projectId = Number(rawProjectId);
    const project = Number.isSafeInteger(projectId) && projectId > 0
      ? (dependencies.getProject || getProject)(user, projectId)
      : null;
    if (!project) throw new ProjectSelectionError('پروژه انتخاب‌شده یافت نشد یا شما به آن دسترسی ندارید.', 'project_access_denied', 403);
    return project;
  }

  const name = String(input.projectName || '').trim();
  if (!name) throw new ProjectSelectionError('انتخاب پروژه یا نام پروژه جدید الزامی است.', 'missing_selection', 400);
  return (dependencies.createProject || createProject)(user, {
    name,
    description: input.projectDescription,
    clientName: input.clientName,
    projectCode: input.projectCode,
    isConfidential: input.isConfidential === true || input.isConfidential === 'true',
  });
}

export function createProject(user: ProjectUser, input: { name: string; description?: string; clientName?: string; projectCode?: string; isConfidential?: boolean }): ProjectDto {
  if (!canCreateProject(user)) throw new Error('شما مجاز به ایجاد پروژه نیستید.');
  const name = String(input.name || '').trim();
  if (!name || name.length > 200) throw new Error('نام پروژه الزامی و حداکثر ۲۰۰ کاراکتر است.');
  const now = new Date().toISOString();
  const result = db.run(
    `INSERT INTO projects (name, description, client_name, project_code, is_confidential, created_by_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, input.description?.trim() || null, input.clientName?.trim() || null, input.projectCode?.trim() || null, input.isConfidential ? 1 : 0, user.id, now, now]
  );
  db.run('INSERT INTO project_members (project_id, user_id, access_level, created_at) VALUES (?, ?, ?, ?)', [result.lastInsertRowid, user.id, 'manager', now]);
  return getProject(user, result.lastInsertRowid)!;
}

export function getProject(user: ProjectUser, id: number): ProjectDto | null {
  const row = db.queryOne<any>(
    `SELECT p.id, p.name, p.description, p.client_name as clientName, p.project_code as projectCode,
            p.status, p.is_confidential as isConfidential, p.created_by_id as createdById,
            p.created_at as createdAt, p.updated_at as updatedAt
       FROM projects p
      WHERE p.id = ? AND (p.created_by_id = ? OR p.is_confidential = 0 AND (? IN ('SuperAdmin', 'Admin', 'Editor')) OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?))`,
    [id, user.id, user.role, user.id]
  );
  return row ? toProject(row) : null;
}

export function listProjects(user: ProjectUser): ProjectDto[] {
  return db.query<any>(
    `SELECT p.id, p.name, p.description, p.client_name as clientName, p.project_code as projectCode,
            p.status, p.is_confidential as isConfidential, p.created_by_id as createdById,
            p.created_at as createdAt, p.updated_at as updatedAt
       FROM projects p
      WHERE p.is_confidential = 0 AND p.status = 'active'
         OR p.created_by_id = ?
         OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?)
      ORDER BY p.updated_at DESC`, [user.id, user.id]
  ).map(toProject);
}

export function addMember(actor: ProjectUser, projectId: number, userId: number, accessLevel: 'manager' | 'member' | 'viewer' = 'member'): void {
  const project = getProject(actor, projectId);
  if (!project || !canManageProject(actor, project)) throw new Error('دسترسی مدیریت پروژه ندارید.');
  const target = db.queryOne('SELECT id FROM users WHERE id = ? AND is_active = 1', [userId]);
  if (!target) throw new Error('کاربر فعال یافت نشد.');
  db.run('INSERT INTO project_members (project_id, user_id, access_level, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, user_id) DO UPDATE SET access_level = excluded.access_level', [projectId, userId, accessLevel, new Date().toISOString()]);
}
