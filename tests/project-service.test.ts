import test from 'node:test';
import assert from 'node:assert/strict';
import { canCreateProject, resolveVideoProject, ProjectSelectionError } from '../server/services/project.service.ts';

test('project creation policy allows SuperAdmin, Editor, and Cameraman only', () => {
  assert.equal(canCreateProject({ id: 1, role: 'SuperAdmin' }), true);
  assert.equal(canCreateProject({ id: 2, role: 'Editor' }), true);
  assert.equal(canCreateProject({ id: 3, role: 'Cameraman' }), true);
  assert.equal(canCreateProject({ id: 4, role: 'Supervisor' }), false);
  assert.equal(canCreateProject({ id: 5, role: 'Admin' }), false);
});

const project = (id: number, createdById = 1) => ({
  id, name: `Project ${id}`, description: null, clientName: null, projectCode: null,
  status: 'active' as const, isConfidential: false, createdById,
  createdAt: 'now', updatedAt: 'now',
});

test('upload can select an existing project the user can access', () => {
  const selected = resolveVideoProject({ id: 7, role: 'Editor' }, { projectId: '12' }, {
    getProject: (_user, id) => id === 12 ? project(id) : null,
  });
  assert.equal(selected.id, 12);
});

test('upload creates a project when project fields are supplied', () => {
  const created = resolveVideoProject({ id: 7, role: 'Editor' }, { projectName: 'New shoot', clientName: 'Client' }, {
    createProject: (_user, input) => ({ ...project(21, 7), name: input.name, clientName: input.clientName || null }),
  });
  assert.equal(created.id, 21);
  assert.equal(created.name, 'New shoot');
});

test('upload denies an existing project the user cannot access', () => {
  assert.throws(
    () => resolveVideoProject({ id: 7, role: 'Editor' }, { projectId: 99 }, { getProject: () => null }),
    (error: any) => error instanceof ProjectSelectionError && error.code === 'project_access_denied' && error.status === 403,
  );
});

test('upload rejects a missing project selection', () => {
  assert.throws(
    () => resolveVideoProject({ id: 7, role: 'Editor' }, {}, { createProject: () => { throw new Error('should not create'); } }),
    (error: any) => error instanceof ProjectSelectionError && error.code === 'missing_selection' && error.status === 400,
  );
});
