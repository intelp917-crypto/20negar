import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_SIZE_DESKTOP,
  CHUNK_SIZE_MOBILE,
  CHUNK_SIZE_SLOW,
  chooseChunkSize,
  chooseConcurrency,
  describeUploadFailure,
  isMobileClient,
  isRetryableStatus,
  nextRetryDelay,
} from '../src/upload/policy.ts';
import {
  CHECKPOINT_TTL_MS,
  clearCheckpoint,
  fileFingerprint,
  getCheckpoint,
  readCheckpoints,
  saveCheckpoint,
  type CheckpointStorage,
} from '../src/upload/checkpoint.ts';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function memoryStorage(): CheckpointStorage & { dump: () => Map<string, string> } {
  const data = new Map<string, string>();
  return {
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    dump: () => data,
  };
}

test('mobile clients upload in small chunks on a single connection', () => {
  assert.equal(isMobileClient({ userAgent: IPHONE_UA }), true);
  assert.equal(isMobileClient({ userAgent: ANDROID_UA }), true);
  assert.equal(isMobileClient({ userAgent: WINDOWS_UA }), false);

  assert.equal(chooseChunkSize({ userAgent: IPHONE_UA }), CHUNK_SIZE_MOBILE);
  assert.equal(chooseChunkSize({ userAgent: ANDROID_UA }), CHUNK_SIZE_MOBILE);
  assert.equal(chooseChunkSize({ userAgent: WINDOWS_UA }), CHUNK_SIZE_DESKTOP);

  assert.equal(chooseConcurrency({ userAgent: IPHONE_UA }), 1);
  assert.equal(chooseConcurrency({ userAgent: WINDOWS_UA }), 2);
});

test('slow or metered connections get the smallest chunks', () => {
  assert.equal(chooseChunkSize({ userAgent: WINDOWS_UA, saveData: true }), CHUNK_SIZE_SLOW);
  assert.equal(chooseChunkSize({ userAgent: WINDOWS_UA, effectiveType: '2g' }), CHUNK_SIZE_SLOW);
  assert.equal(chooseChunkSize({ userAgent: WINDOWS_UA, effectiveType: 'slow-2g' }), CHUNK_SIZE_SLOW);
  assert.equal(chooseChunkSize({ userAgent: WINDOWS_UA, effectiveType: '3g' }), CHUNK_SIZE_MOBILE);
});

test('transient failures are retried and permanent client errors are not', () => {
  for (const status of [0, 408, 409, 423, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableStatus(status), true, `status ${status} should be retryable`);
  }
  for (const status of [400, 401, 403, 404, 413, 415, 422]) {
    assert.equal(isRetryableStatus(status), false, `status ${status} must not be retried`);
  }
});

test('retry backoff grows, stays bounded and is jittered', () => {
  const fixed = () => 0.5;
  let previous = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const delay = nextRetryDelay(attempt, { random: fixed });
    assert.ok(delay >= 250, 'delay is never below the floor');
    assert.ok(delay <= 30_000, 'delay is capped');
    assert.ok(delay >= previous, 'delay never shrinks while attempts increase');
    previous = delay;
  }
  const low = nextRetryDelay(4, { random: () => 0 });
  const high = nextRetryDelay(4, { random: () => 1 });
  assert.ok(low < high, 'jitter spreads clients out');
});

test('permanent upload failures produce actionable Persian messages', () => {
  assert.match(describeUploadFailure(401), /نشست/);
  assert.match(describeUploadFailure(413), /حجم/);
  assert.match(describeUploadFailure(507), /دیسک/);
  assert.match(describeUploadFailure(503), /تلاش مجدد|خودکار/);
});

test('checkpoint survives a reload so a finished upload is not sent again', () => {
  const storage = memoryStorage();
  const file = { name: 'clip.mp4', size: 4096, lastModified: 1_700_000_000_000, type: 'video/mp4' };
  const uploadId = '0123456789abcdef0123456789abcdef';
  const now = 1_700_000_100_000;

  assert.equal(getCheckpoint(file, storage, now), null);
  saveCheckpoint(file, uploadId, storage, now);

  const stored = getCheckpoint(file, storage, now);
  assert.equal(stored?.uploadId, uploadId);
  assert.equal(readCheckpoints(storage, now)[fileFingerprint(file)]?.name, 'clip.mp4');

  clearCheckpoint(file, storage, now);
  assert.equal(getCheckpoint(file, storage, now), null);
});

test('stale or malformed checkpoints are ignored', () => {
  const storage = memoryStorage();
  const file = { name: 'clip.mp4', size: 10, lastModified: 1 };
  const now = 1_700_000_000_000;
  saveCheckpoint(file, '0123456789abcdef0123456789abcdef', storage, now);
  assert.equal(getCheckpoint(file, storage, now + CHECKPOINT_TTL_MS + 1), null);

  storage.setItem(
    '20negar_upload_checkpoints_v1',
    JSON.stringify({ [fileFingerprint(file)]: { uploadId: '../../etc/passwd', createdAt: now } })
  );
  assert.equal(getCheckpoint(file, storage, now), null);
});

test('checkpoint store tolerates disabled browser storage', () => {
  assert.doesNotThrow(() => saveCheckpoint({ name: 'a.mp4', size: 1, lastModified: 1 }, '0123456789abcdef', null));
  assert.equal(getCheckpoint({ name: 'a.mp4', size: 1, lastModified: 1 }, null), null);
});
