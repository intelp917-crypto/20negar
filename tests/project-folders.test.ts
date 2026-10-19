import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RelationalDatabase } from '../server/db/database.ts';
import { runMigrations } from '../server/db/schema.ts';
import { VideoService } from '../server/services/video.service.ts';

function seed(database: RelationalDatabase): void {
  const now = '2026-01-01T00:00:00.000Z';
  const user = (id: number, username: string, role: string) =>
    database.run(
      `INSERT INTO users (id, username, password_hash, role, display_name, is_active, created_at, updated_at)
       VALUES (?, ?, 'hash', ?, ?, 1, ?, ?)`,
      [id, username, role, username, now, now]
    );

  user(1, 'editor', 'Editor');
  user(2, 'supervisor', 'Supervisor');
  user(3, 'other-editor', 'Editor');
  user(4, 'cameraman', 'Cameraman');
  user(5, 'admin', 'Admin');

  database.run(
    `INSERT INTO projects (id, name, description, client_name, project_code, status, is_confidential, created_by_id, created_at, updated_at)
     VALUES (1, 'کلینیک دندان‌پزشکی', 'مجموعه تبلیغاتی', 'کلینیک آرام', 'DENT-1', 'active', 0, 1, ?, ?)`,
    [now, now]
  );
  database.run(
    `INSERT INTO projects (id, name, description, client_name, project_code, status, is_confidential, created_by_id, created_at, updated_at)
     VALUES (2, 'کمپین فروشگاه', NULL, NULL, 'SHOP-1', 'active', 1, 1, ?, ?)`,
    [now, now]
  );

  const video = (params: {
    id: number;
    title: string;
    projectId: number | null;
    editorId: number;
    uploadedById?: number | null;
    adminId?: number | null;
    isRaw?: boolean;
    status: 'Approved' | 'PendingReview' | 'Rejected';
    createdAt: string;
  }) =>
    database.run(
      `INSERT INTO videos (
         id, title, original_filename, original_path, editor_id, supervisor_id, admin_id, uploaded_by_id,
         is_raw, status, processing_status, file_size, version_number, project_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'videos/test.mp4', ?, ?, ?, ?, ?, ?, 'Ready', 1024, 1, ?, ?, ?)`,
      [
        params.id,
        params.title,
        `${params.title}.mp4`,
        params.editorId,
        params.isRaw ? null : 2,
        params.adminId ?? null,
        params.uploadedById ?? null,
        params.isRaw ? 1 : 0,
        params.status,
        params.projectId,
        params.createdAt,
        params.createdAt,
      ]
    );

  video({ id: 1, title: 'تیزر دندان‌پزشکی', projectId: 1, editorId: 1, adminId: 5, status: 'Approved', createdAt: '2026-01-02T00:00:00.000Z' });
  // ویدیوی تدوین‌گر دیگر با پروژه محرمانه — نباید در پوشه‌های تدوین‌گر ۱ شمرده شود
  video({ id: 2, title: 'تیزر فروشگاه', projectId: 2, editorId: 3, status: 'PendingReview', createdAt: '2026-01-03T00:00:00.000Z' });
  // فایل خام تصویربردار در همان پروژه دندان‌پزشکی
  video({ id: 3, title: 'فایل خام دندان‌پزشکی', projectId: 1, editorId: 1, uploadedById: 4, isRaw: true, status: 'PendingReview', createdAt: '2026-01-04T00:00:00.000Z' });
  // ویدیوی قدیمی بدون پروژه
  video({ id: 4, title: 'ویدیوی آرشیوی', projectId: null, editorId: 1, status: 'Rejected', createdAt: '2026-01-05T00:00:00.000Z' });
}

test('project folders group visible videos per project and roll up legacy videos', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-folders-'));
  try {
    const database = new RelationalDatabase(path.join(root, 'database.sqlite'));
    await database.initialize();
    runMigrations(database);
    seed(database);

    const editorFolders = VideoService.getProjectFolders({ id: 1, role: 'Editor' }, database);
    // مرتب‌سازی بر اساس آخرین فعالیت: ویدیوی بدون پروژه جدیدتر است
    assert.deepEqual(editorFolders.map((folder) => folder.projectId), [null, 1]);

    const dental = editorFolders[1];
    assert.equal(dental.name, 'کلینیک دندان‌پزشکی');
    assert.equal(dental.clientName, 'کلینیک آرام');
    assert.equal(dental.videoCount, 2);
    assert.equal(dental.approvedCount, 1);
    assert.equal(dental.pendingCount, 1);
    assert.equal(dental.rejectedCount, 0);

    const legacy = editorFolders[0];
    assert.equal(legacy.name, 'بدون پروژه');
    assert.equal(legacy.videoCount, 1);
    assert.equal(legacy.rejectedCount, 1);

    // پروژه محرمانه‌ای که هیچ ویدیوی قابل‌مشاهده برای این تدوین‌گر ندارد، پوشه نمی‌سازد
    assert.equal(editorFolders.some((folder) => folder.name === 'کمپین فروشگاه'), false);

    database.dispose();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('project folders respect cameraman and admin visibility scopes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-folders-scope-'));
  try {
    const database = new RelationalDatabase(path.join(root, 'database.sqlite'));
    await database.initialize();
    runMigrations(database);
    seed(database);

    const cameramanFolders = VideoService.getProjectFolders({ id: 4, role: 'Cameraman' }, database);
    assert.equal(cameramanFolders.length, 1);
    assert.equal(cameramanFolders[0].projectId, 1);
    assert.equal(cameramanFolders[0].videoCount, 1);

    const adminFolders = VideoService.getProjectFolders({ id: 5, role: 'Admin' }, database);
    assert.equal(adminFolders.length, 1);
    assert.equal(adminFolders[0].projectId, 1);
    assert.equal(adminFolders[0].approvedCount, 1);
    assert.equal(adminFolders[0].videoCount, 1);

    database.dispose();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
