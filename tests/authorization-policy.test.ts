import test from 'node:test';
import assert from 'node:assert/strict';
import { canCreateRole, canReviewVideo } from '../server/authorization/policy.ts';

const readyReview = {
  status: 'PendingReview',
  processing_status: 'Ready',
  supervisor_id: 10,
  editor_id: 20,
};

test('only SuperAdmin can create another SuperAdmin', () => {
  assert.equal(canCreateRole({ id: 1, role: 'Admin' }, 'SuperAdmin'), false);
  assert.equal(canCreateRole({ id: 1, role: 'SuperAdmin' }, 'SuperAdmin'), true);
  assert.equal(canCreateRole({ id: 1, role: 'Admin' }, 'Editor'), true);
});

test('review policy requires ready state, assignment, and prevents self-review', () => {
  assert.equal(canReviewVideo({ id: 10, role: 'Supervisor' }, readyReview), true);
  assert.equal(canReviewVideo({ id: 11, role: 'Supervisor' }, readyReview), false);
  assert.equal(canReviewVideo({ id: 20, role: 'Editor' }, readyReview), false);
  assert.equal(canReviewVideo({ id: 10, role: 'Supervisor' }, { ...readyReview, status: 'Approved' }), false);
  assert.equal(canReviewVideo({ id: 1, role: 'SuperAdmin' }, readyReview), true);
});
