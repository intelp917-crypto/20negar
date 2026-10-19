import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Config reads these paths at import time, so the temporary database must be
// selected before any server module is loaded.
const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-raw-'));
process.env.NEGAR_DATA_DIR = root;
process.env.NEGAR_DB_FILE_PATH = path.join(root, 'database.sqlite');
process.env.NEGAR_STORAGE_DIR = path.join(root, 'storage');

const { db } = await import('../server/db/database.ts');
const { runMigrations } = await import('../server/db/schema.ts');
const { VideoService, VideoWorkflowError } = await import('../server/services/video.service.ts');

const editorA = { id: 20, role: 'Editor' as const, displayName: 'Editor One' };
const editorB = { id: 21, role: 'Editor' as const, displayName: 'Editor Two' };
const cameraman = { id: 10, role: 'Cameraman' as const, displayName: 'Camera One' };
const supervisorA = { id: 30, role: 'Supervisor' as const, displayName: 'Supervisor One' };
const supervisorB = { id: 31, role: 'Supervisor' as const, displayName: 'Supervisor Two' };
const admin = { id: 40, role: 'Admin' as const, displayName: 'Admin One' };
const superAdmin = { id: 1, role: 'SuperAdmin' as const, displayName: 'Root' };

function seedUsers(): void {
  const now = '2026-01-01T00:00:00.000Z';
  const insert = (id: number, username: string, role: string, displayName: string) =>
    db.run(
      `INSERT INTO users (id, username, password_hash, role, display_name, is_active, created_at, updated_at)
       VALUES (?, ?, 'hash', ?, ?, 1, ?, ?)`,
      [id, username, role, displayName, now, now]
    );

  insert(1, 'root', 'SuperAdmin', 'Root');
  insert(10, 'camera1', 'Cameraman', 'Camera One');
  insert(20, 'editor1', 'Editor', 'Editor One');
  insert(21, 'editor2', 'Editor', 'Editor Two');
  insert(30, 'supervisor1', 'Supervisor', 'Supervisor One');
  insert(31, 'supervisor2', 'Supervisor', 'Supervisor Two');
  insert(40, 'admin1', 'Admin', 'Admin One');

  db.run(
    `INSERT INTO projects (id, name, status, is_confidential, created_by_id, created_at, updated_at)
     VALUES (1, 'Raw Project', 'active', 0, 1, ?, ?)`,
    [now, now]
  );
}

test('raw cameraman footage is shared with editors, claimable, and published only to the chosen supervisor', async () => {
  await db.initialize();
  runMigrations(db);
  seedUsers();

  try {
    const raw = VideoService.createVideo({
      title: 'Raw Footage',
      originalFilename: 'raw.mp4',
      originalPath: 'videos/raw.mp4',
      fileSize: 1024,
      editorId: cameraman.id,
      uploadedById: cameraman.id,
      projectId: 1,
      isRaw: true,
    });

    assert.equal(raw.isRaw, true);
    assert.equal(raw.supervisorId, null);
    assert.equal(raw.status, 'Uploaded');
    assert.equal(raw.versionNumber, 1);

    // Raw files are visible to every editor, the uploader, and SuperAdmin only.
    assert.equal(VideoService.getVideos(editorA).length, 1);
    assert.equal(VideoService.getVideos(editorB).length, 1);
    assert.equal(VideoService.getVideos(cameraman).length, 1);
    assert.equal(VideoService.getVideos(supervisorA).length, 0);
    assert.equal(VideoService.getVideos(supervisorB).length, 0);
    assert.equal(VideoService.getVideos(admin).length, 0);
    assert.equal(VideoService.getVideos(superAdmin).length, 1);

    assert.equal(VideoService.getVideoById(raw.id, supervisorA), null);
    assert.equal(VideoService.getVideoById(raw.id, admin), null);
    assert.notEqual(VideoService.getVideoById(raw.id, editorB), null);
    assert.notEqual(VideoService.getVideoById(raw.id, superAdmin), null);

    // First editor claims the file; the second editor sees who is editing it.
    const claimed = VideoService.claimVideo(raw.id, editorA);
    assert.equal(claimed.editingClaimedById, editorA.id);
    assert.equal(claimed.editingClaimedByName, editorA.displayName);

    const seenByOther = VideoService.getVideos(editorB).find((video) => video.id === raw.id)!;
    assert.equal(seenByOther.editingClaimedById, editorA.id);
    assert.equal(seenByOther.editingClaimedByName, editorA.displayName);

    assert.throws(
      () => VideoService.claimVideo(raw.id, editorB),
      (error: any) => error instanceof VideoWorkflowError && error.status === 409
    );
    assert.throws(
      () => VideoService.replaceRawVideo(
        raw.id,
        editorB,
        {
          originalFilename: 'edited-by-b.mp4',
          originalPath: 'videos/edited-by-b.mp4',
          fileSize: 2048,
          supervisorId: supervisorA.id,
        }
      ),
      (error: any) => error instanceof VideoWorkflowError && error.status === 409
    );

    // The claiming editor publishes the edited replacement on the same record.
    const replacement = VideoService.replaceRawVideo(
      raw.id,
      editorA,
      {
        originalFilename: 'edited.mp4',
        originalPath: 'videos/edited.mp4',
        fileSize: 4096,
        supervisorId: supervisorA.id,
        title: 'Edited Cut',
      }
    );

    assert.equal(replacement.previousPath, 'videos/raw.mp4');
    assert.equal(replacement.video.isRaw, false);
    assert.equal(replacement.video.status, 'PendingReview');
    assert.equal(replacement.video.supervisorId, supervisorA.id);
    assert.equal(replacement.video.supervisorName, supervisorA.displayName);
    assert.equal(replacement.video.versionNumber, 2);
    assert.equal(replacement.video.editingClaimedById, null);
    assert.equal(replacement.video.originalPath, 'videos/edited.mp4');

    // Published cut goes to the chosen supervisor only; other editors lose access.
    assert.equal(VideoService.getVideos(editorA).length, 1);
    assert.equal(VideoService.getVideos(editorB).length, 0);
    assert.equal(VideoService.getVideos(supervisorA).length, 1);
    assert.equal(VideoService.getVideos(supervisorB).length, 0);
    assert.equal(VideoService.getVideos(cameraman).length, 0);
    assert.equal(VideoService.getVideos(superAdmin).length, 1);
    assert.equal(VideoService.getVideoById(raw.id, editorB), null);
    assert.equal(VideoService.getVideoById(raw.id, supervisorB), null);
    assert.notEqual(VideoService.getVideoById(raw.id, supervisorA), null);
    assert.throws(
      () => VideoService.claimVideo(raw.id, editorB),
      (error: any) => error instanceof VideoWorkflowError
    );

    // Approval can then route the video to a specific admin panel.
    VideoService.approveVideo(raw.id, supervisorA, 'approved', admin.id);
    assert.equal(VideoService.getVideos(admin).length, 1);
    assert.equal(VideoService.getVideos(supervisorB).length, 0);

    // Releasing a claim returns the raw file to the shared editor pool.
    const raw2 = VideoService.createVideo({
      title: 'Second Raw',
      originalFilename: 'raw2.mp4',
      originalPath: 'videos/raw2.mp4',
      fileSize: 512,
      editorId: cameraman.id,
      uploadedById: cameraman.id,
      projectId: 1,
      isRaw: true,
    });

    assert.equal(VideoService.getVideos(editorA).length, 2);
    const claimedByB = VideoService.claimVideo(raw2.id, editorB);
    assert.equal(claimedByB.editingClaimedById, editorB.id);

    VideoService.releaseClaim(raw2.id, editorB);
    const released = VideoService.getVideoById(raw2.id, editorA)!;
    assert.equal(released.editingClaimedById, null);

    const claimedByA = VideoService.claimVideo(raw2.id, editorA);
    assert.equal(claimedByA.editingClaimedById, editorA.id);
    assert.equal(VideoService.getVideoById(raw2.id, editorB)!.editingClaimedByName, editorA.displayName);
  } finally {
    db.dispose();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
