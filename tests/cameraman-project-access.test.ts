import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Config reads env at import time, so the temp database must be selected first.
const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-cameraman-proj-'));
process.env.NEGAR_DATA_DIR = root;
process.env.NEGAR_DB_FILE_PATH = path.join(root, 'database.sqlite');
process.env.NEGAR_STORAGE_DIR = path.join(root, 'storage');

const { db } = await import('../server/db/database.ts');
const { runMigrations } = await import('../server/db/schema.ts');
const { getProject, listProjects } = await import('../server/services/project.service.ts');

test('cameraman can access a non-confidential project created by an editor', async () => {
  await db.initialize();
  runMigrations(db);

  const now = '2026-01-01T00:00:00.000Z';
  db.run(
    `INSERT INTO users (id, username, password_hash, role, display_name, is_active, created_at, updated_at)
     VALUES (1, 'editor', 'hash', 'Editor', 'Editor', 1, ?, ?)`,
    [now, now]
  );
  db.run(
    `INSERT INTO users (id, username, password_hash, role, display_name, is_active, created_at, updated_at)
     VALUES (2, 'camera', 'hash', 'Cameraman', 'Camera', 1, ?, ?)`,
    [now, now]
  );
  db.run(
    `INSERT INTO projects (id, name, description, client_name, project_code, status, is_confidential, created_by_id, created_at, updated_at)
     VALUES (1, 'Open project', NULL, NULL, NULL, 'active', 0, 1, ?, ?)`,
    [now, now]
  );
  db.run(
    `INSERT INTO projects (id, name, description, client_name, project_code, status, is_confidential, created_by_id, created_at, updated_at)
     VALUES (2, 'Secret project', NULL, NULL, NULL, 'active', 1, 1, ?, ?)`,
    [now, now]
  );

  try {
    const accessible = getProject({ id: 2, role: 'Cameraman' }, 1);
    assert.notEqual(accessible, null);
    assert.equal(accessible?.name, 'Open project');

    const secret = getProject({ id: 2, role: 'Cameraman' }, 2);
    assert.equal(secret, null);

    const listed = listProjects({ id: 2, role: 'Cameraman' }).map((p) => p.id);
    assert.deepEqual(listed, [1]);

    db.dispose();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
