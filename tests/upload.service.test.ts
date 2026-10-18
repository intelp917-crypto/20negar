import test from 'node:test';
import assert from 'node:assert/strict';
import { decideUploadFinish, isUploadSessionOwner, normalizeUploadFilename, validateCreateUploadSessionInput } from '../server/services/upload.service.ts';

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

test('upload filename normalization removes paths and bounds long metadata without losing extension', () => {
  const normalized = normalizeUploadFilename(`C:\\uploads\\${'x'.repeat(400)}.mp4`);
  assert.equal(normalized.length, 255);
  assert.match(normalized, /\.mp4$/);
  assert.equal(normalizeUploadFilename('  folder/video.mp4  '), 'video.mp4');
  assert.equal(normalizeUploadFilename('\u0000  '), '');
});

test('upload session ownership is scoped to the authenticated owner', () => {
  assert.equal(isUploadSessionOwner({ ownerId: 7 }, 7), true);
  assert.equal(isUploadSessionOwner({ ownerId: 7 }, 8), false);
  assert.equal(isUploadSessionOwner(null, 7), false);
});

test('upload finish decision records verification and is idempotent after completion', () => {
  const checksum = 'a'.repeat(64);
  assert.deepEqual(decideUploadFinish({ expectedChecksum: checksum, actualChecksum: checksum, actualSize: 10 }), {
    idempotent: false, state: 'completed', verificationStatus: 'verified', verified: true,
    errorCode: null, errorMessage: null,
  });
  assert.equal(decideUploadFinish({ expectedChecksum: checksum, actualChecksum: checksum, actualSize: 10, existingState: 'completed' }).idempotent, true);
  assert.equal(decideUploadFinish({ expectedChecksum: checksum, actualChecksum: 'b'.repeat(64), actualSize: 10 }).state, 'failed');
});
