import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { LocalFileStorage } from '../server/storage/local.storage.ts';
import { SessionMeta, verifySessionIntegrity } from '../server/routes/upload.routes.ts';

function sessionFor(filePath: string, expectedChecksum?: string): SessionMeta {
  return {
    id: '0123456789abcdef0123456789abcdef',
    userId: 1,
    originalName: 'example.bin',
    mimeType: 'application/octet-stream',
    fileSize: fs.statSync(filePath).size,
    chunkSize: fs.statSync(filePath).size,
    totalChunks: 1,
    received: [0],
    createdAt: Date.now(),
    meta: {},
    expectedChecksum,
    verificationResult: 'pending',
  };
}

test('LocalFileStorage rejects absolute and escaping keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-storage-'));
  const storage = new LocalFileStorage(root);

  assert.throws(() => storage.getPhysicalPath('../outside.txt'), /escapes/);
  assert.throws(() => storage.getPhysicalPath('nested/../../outside.txt'), /escapes/);
  assert.throws(() => storage.getPhysicalPath(path.join(root, 'outside.txt')), /relative/);

  fs.rmSync(root, { recursive: true, force: true });
});

test('LocalFileStorage permits nested keys inside the configured root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-storage-'));
  const storage = new LocalFileStorage(root);

  await storage.saveFile('videos/example.bin', Buffer.from('preserved'));
  assert.equal(fs.readFileSync(path.join(root, 'videos', 'example.bin'), 'utf8'), 'preserved');

  fs.rmSync(root, { recursive: true, force: true });
});

test('chunked completion verifies and persists a matching SHA-256 checksum', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-upload-'));
  const filePath = path.join(root, 'payload.bin');
  const content = Buffer.from('integrity-protected upload');
  fs.writeFileSync(filePath, content);
  const checksum = crypto.createHash('sha256').update(content).digest('hex');
  const session = sessionFor(filePath, checksum);
  let saves = 0;

  const result = verifySessionIntegrity(session, filePath, () => saves++);

  assert.equal(result.actualChecksum, checksum);
  assert.equal(result.verificationResult, 'verified');
  assert.equal(typeof result.verifiedAt, 'number');
  assert.equal(typeof result.finalizedAt, 'number');
  assert.equal(saves, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('chunked completion rejects and persists a mismatching SHA-256 checksum', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-upload-'));
  const filePath = path.join(root, 'payload.bin');
  fs.writeFileSync(filePath, 'tampered payload');
  const session = sessionFor(filePath, '0'.repeat(64));
  let saves = 0;

  const result = verifySessionIntegrity(session, filePath, () => saves++);

  assert.notEqual(result.actualChecksum, result.expectedChecksum);
  assert.equal(result.verificationResult, 'mismatch');
  assert.equal(saves, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('repeated chunked completion is idempotent after verification', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-upload-'));
  const filePath = path.join(root, 'payload.bin');
  const content = Buffer.from('same completed payload');
  fs.writeFileSync(filePath, content);
  const checksum = crypto.createHash('sha256').update(content).digest('hex');
  const session = sessionFor(filePath, checksum);
  let saves = 0;

  const first = verifySessionIntegrity(session, filePath, () => saves++);
  const second = verifySessionIntegrity(first, filePath, () => saves++);

  assert.equal(second.verificationResult, 'verified');
  assert.equal(second.actualChecksum, checksum);
  assert.equal(second.verifiedAt, first.verifiedAt);
  assert.equal(saves, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
