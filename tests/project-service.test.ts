import test from 'node:test';
import assert from 'node:assert/strict';
import { canCreateProject } from '../server/services/project.service.ts';

test('project creation policy allows SuperAdmin, Editor, and Cameraman only', () => {
  assert.equal(canCreateProject({ id: 1, role: 'SuperAdmin' }), true);
  assert.equal(canCreateProject({ id: 2, role: 'Editor' }), true);
  assert.equal(canCreateProject({ id: 3, role: 'Cameraman' }), true);
  assert.equal(canCreateProject({ id: 4, role: 'Supervisor' }), false);
  assert.equal(canCreateProject({ id: 5, role: 'Admin' }), false);
});
