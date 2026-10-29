import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Config reads these paths at import time, so the temporary database must be
// selected before any server module is loaded.
const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-tus-'));
process.env.NEGAR_DATA_DIR = root;
process.env.NEGAR_DB_FILE_PATH = path.join(root, 'database.sqlite');
process.env.NEGAR_STORAGE_DIR = path.join(root, 'storage');
process.env.NEGAR_TRANSFER_ENABLED = 'false';

const express = (await import('express')).default;
const { db } = await import('../server/db/database.ts');
const { runMigrations } = await import('../server/db/schema.ts');
const { AuthService } = await import('../server/services/auth.service.ts');
const { default: tusRouter } = await import('../server/routes/tus.routes.ts');
const { getUploadSession } = await import('../server/services/upload.service.ts');
const {
  TUS_DIR,
  cleanupUploadArtifacts,
  completeUploadFinalization,
  resolveCompletedUpload,
} = await import('../server/services/upload-finalize.service.ts');
const { VideoService } = await import('../server/services/video.service.ts');

await db.initialize();
runMigrations(db);

const now = '2026-01-01T00:00:00.000Z';
function insertUser(id: number, username: string, role: string): void {
  db.run(
    `INSERT INTO users (id, username, password_hash, role, display_name, is_active, created_at, updated_at)
     VALUES (?, ?, 'hash', ?, ?, 1, ?, ?)`,
    [id, username, role, username, now, now]
  );
}
insertUser(20, 'editor1', 'Editor');
insertUser(21, 'editor2', 'Editor');

const tokenFor = (id: number, username: string) =>
  AuthService.generateToken({ id, username, role: 'Editor', display_name: username } as any);

const editorToken = tokenFor(20, 'editor1');
const otherToken = tokenFor(21, 'editor2');

const app = express();
app.use('/api/tus', tusRouter);
const server = http.createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = typeof address === 'object' && address ? address.port : 0;
const base = `http://127.0.0.1:${port}`;

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

function tusHeaders(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Tus-Resumable': '1.0.0', ...extra };
}

const metadata = (entries: Record<string, string>) =>
  Object.entries(entries)
    .map(([key, value]) => `${key} ${Buffer.from(value, 'utf8').toString('base64')}`)
    .join(',');

function createUpload(payload: Buffer): Promise<Response> {
  return fetch(`${base}/api/tus`, {
    method: 'POST',
    headers: tusHeaders(editorToken, {
      'Upload-Length': String(payload.length),
      'Upload-Metadata': metadata({ filename: 'clip.mp4', filetype: 'video/mp4' }),
    }),
  });
}

function patch(url: string, offset: number, chunk: Buffer, token = editorToken): Promise<Response> {
  return fetch(url, {
    method: 'PATCH',
    headers: tusHeaders(token, {
      'Upload-Offset': String(offset),
      'Content-Type': 'application/offset+octet-stream',
      'Content-Length': String(chunk.length),
    }),
    body: chunk,
  });
}

test('a TUS upload resumes after a lost final response and finalizes exactly once', async () => {
  const payload = Buffer.alloc(64 * 1024 + 777);
  for (let index = 0; index < payload.length; index += 1) payload[index] = index % 251;

  const created = await createUpload(payload);
  assert.equal(created.status, 201, `create failed: ${await created.clone().text()}`);
  const location = created.headers.get('location');
  assert.ok(location, 'the server must return an upload location');
  const uploadUrl = new URL(location!, base).toString();
  const uploadId = uploadUrl.split('/').filter(Boolean).pop()!;

  const session = getUploadSession(20, uploadId);
  assert.ok(session, 'the durable session row is created before the bytes arrive');
  assert.equal(session!.expectedSize, payload.length);

  // First half.
  const first = payload.subarray(0, 40_000);
  const patched = await patch(uploadUrl, 0, first);
  assert.equal(patched.status, 204, `patch failed: ${await patched.clone().text()}`);
  assert.equal(Number(patched.headers.get('upload-offset')), first.length);

  // HEAD reports the resume point the browser would use after a reconnect.
  // (tus.io specifies 200 OK for HEAD.)
  const head = await fetch(uploadUrl, { method: 'HEAD', headers: tusHeaders(editorToken) });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('upload-offset')), first.length);
  assert.equal(Number(head.headers.get('upload-length')), payload.length);

  // Second half: the client "loses" this response and has to check the offset again.
  const second = payload.subarray(first.length);
  const finished = await patch(uploadUrl, first.length, second);
  assert.equal(finished.status, 204, `final patch failed: ${await finished.clone().text()}`);
  assert.equal(Number(finished.headers.get('upload-offset')), payload.length);

  const resumedHead = await fetch(uploadUrl, { method: 'HEAD', headers: tusHeaders(editorToken) });
  assert.equal(resumedHead.status, 200);
  assert.equal(
    Number(resumedHead.headers.get('upload-offset')),
    payload.length,
    'a lost 204 must still look complete, so the client never re-uploads the file'
  );

  const completed = getUploadSession(20, uploadId);
  assert.equal(completed?.state, 'completed');
  assert.equal(completed?.actualSize, payload.length);

  const storedPath = path.join(TUS_DIR, uploadId);
  assert.equal(fs.statSync(storedPath).size, payload.length);
  assert.deepEqual(fs.readFileSync(storedPath), payload);

  // Finalization resolves the exact bytes for the owner only.
  const resolved = resolveCompletedUpload(uploadId, 20);
  assert.ok(resolved);
  assert.equal(resolved!.size, payload.length);
  assert.equal(resolved!.originalName, 'clip.mp4');
  assert.equal(resolved!.alreadyFinalizedVideoId, null);
  assert.equal(resolveCompletedUpload(uploadId, 21), null, 'another user cannot claim the upload');

  const video = VideoService.createVideo({
    title: 'Clip',
    originalFilename: 'clip.mp4',
    originalPath: 'videos/clip.mp4',
    fileSize: payload.length,
    editorId: 20,
    isRaw: true,
    projectId: null,
  });

  completeUploadFinalization(20, uploadId, video.id, 'videos/clip.mp4');
  cleanupUploadArtifacts(uploadId);

  assert.equal(fs.existsSync(storedPath), false, 'temp bytes are removed after the video exists');
  const afterFinalize = resolveCompletedUpload(uploadId, 20);
  assert.equal(afterFinalize?.alreadyFinalizedVideoId, video.id);
  assert.equal(getUploadSession(20, uploadId)?.state, 'finalized');
});

test('upload metadata and ownership are enforced before any byte is written', async () => {
  const payload = Buffer.alloc(1024);

  const missingName = await fetch(`${base}/api/tus`, {
    method: 'POST',
    headers: tusHeaders(editorToken, {
      'Upload-Length': String(payload.length),
      'Upload-Metadata': metadata({ filetype: 'video/mp4' }),
    }),
  });
  assert.equal(missingName.status, 400);
  assert.match(await missingName.text(), /نام فایل/);

  const created = await createUpload(payload);
  assert.equal(created.status, 201);
  const uploadUrl = new URL(created.headers.get('location')!, base).toString();

  const foreignHead = await fetch(uploadUrl, { method: 'HEAD', headers: tusHeaders(otherToken) });
  assert.equal(foreignHead.status, 404, 'uploads are invisible to other users');

  const foreignPatch = await patch(uploadUrl, 0, payload, otherToken);
  assert.equal(foreignPatch.status, 404);

  const anonymous = await fetch(`${base}/api/tus`, {
    method: 'POST',
    headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': '10' },
  });
  assert.equal(anonymous.status, 401);

  const wrongOffset = await patch(uploadUrl, 5, payload);
  assert.equal(wrongOffset.status, 409, 'a mismatched offset is rejected without touching the file');
});
