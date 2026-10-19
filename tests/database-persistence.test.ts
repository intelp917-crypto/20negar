import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { RelationalDatabase } from '../server/db/database.ts';
import { runMigrations } from '../server/db/schema.ts';

test('database persistence fsyncs a temporary file and keeps the previous database as a backup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-database-'));
  const databasePath = path.join(root, 'database.sqlite');
  const backupPath = `${databasePath}.bak`;

  try {
    const database = new RelationalDatabase(databasePath);
    await database.initialize();
    database.exec('CREATE TABLE entries (value TEXT NOT NULL)');
    database.persistImmediate();
    const firstVersion = fs.readFileSync(databasePath);

    database.run('INSERT INTO entries (value) VALUES (?)', ['durable']);
    database.persistImmediate();

    assert.ok(fs.existsSync(backupPath));
    assert.notDeepEqual(fs.readFileSync(databasePath), firstVersion);
    assert.deepEqual(fs.readFileSync(backupPath), firstVersion);
    assert.equal(fs.readdirSync(root).some((entry) => entry.endsWith('.tmp')), false);

    const SQL = await initSqlJs();
    const recovered = new SQL.Database(fs.readFileSync(backupPath));
    const rows = recovered.exec('SELECT value FROM entries');
    assert.equal(rows.length, 0);
    recovered.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('versioned migrations create upload sessions and are repeatable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '20negar-migrations-'));
  try {
    const database = new RelationalDatabase(path.join(root, 'database.sqlite'));
    await database.initialize();
    runMigrations(database);
    runMigrations(database);

    const migration = database.queryOne<{ version: number }>('SELECT MAX(version) as version FROM schema_migrations');
    const uploadTable = database.queryOne<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name='upload_sessions'");
    assert.equal(migration?.version, 5);
    assert.equal(uploadTable?.name, 'upload_sessions');
    const videoColumns = database.query<{ name: string; notnull: number }>('PRAGMA table_info(videos)');
    const column = (name: string) => videoColumns.find((entry) => entry.name === name);
    assert.equal(column('project_id')?.name, 'project_id');
    assert.equal(column('is_raw')?.name, 'is_raw');
    assert.equal(column('editing_claimed_by_id')?.name, 'editing_claimed_by_id');
    // A raw upload has no supervisor until its edited replacement is published.
    assert.equal(column('supervisor_id')?.notnull, 0);
    database.persistImmediate();
    database.dispose();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
