import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCreateUploadSessionInput } from '../server/services/upload.service.ts';

// The production db wrapper is a process singleton backed by the configured file.
// These tests intentionally cover the pure validation boundary without touching it.
const valid = {
  ownerId: 7,
  filename: 'movie.mp4',
  expectedSize: 1024,
  mime: 'video/mp4',
  expiresAt: '2030-01-01T00:00:00.000Z',
};

test('upload session validation accepts a valid request', () => {
  assert.doesNotThrow(() => validateCreateUploadSessionInput(valid));
});

test('upload session validation rejects invalid ownership and size', () => {
  assert.throws(() => validateCreateUploadSessionInput({ ...valid, ownerId: 0 }), /ownerId/);
  assert.throws(() => validateCreateUploadSessionInput({ ...valid, expectedSize: -1 }), /expectedSize/);
});

test('upload session validation rejects missing metadata and invalid expiry', () => {
  assert.throws(() => validateCreateUploadSessionInput({ ...valid, filename: ' ' }), /filename/);
  assert.throws(() => validateCreateUploadSessionInput({ ...valid, mime: '' }), /mime/);
  assert.throws(() => validateCreateUploadSessionInput({ ...valid, expiresAt: 'later' }), /expiresAt/);
});
