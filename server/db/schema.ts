import { db } from './database.ts';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('SuperAdmin', 'Admin', 'Editor', 'Supervisor')),
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  original_path TEXT NOT NULL,
  thumbnail_path TEXT,
  editor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  supervisor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('Uploaded', 'PendingReview', 'Approved', 'Rejected')) DEFAULT 'Uploaded',
  processing_status TEXT NOT NULL CHECK(processing_status IN ('Uploading', 'Processing', 'Ready', 'ProcessingFailed')) DEFAULT 'Processing',
  duration REAL DEFAULT 0,
  original_resolution TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  version_number INTEGER NOT NULL DEFAULT 1,
  parent_video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  rejected_at TEXT
);

CREATE TABLE IF NOT EXISTS video_qualities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  quality TEXT NOT NULL CHECK(quality IN ('Original', '1080p', '720p', '480p', '360p')),
  file_path TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bitrate INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS video_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  supervisor_id INTEGER NOT NULL REFERENCES users(id),
  editor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('Approved', 'Rejected')),
  comment TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  description TEXT NOT NULL,
  ip_address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  is_read INTEGER NOT NULL DEFAULT 0,
  link TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  current_step TEXT NOT NULL DEFAULT 'Queued',
  details TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- High-performance compound indexes for large-scale video library
CREATE INDEX IF NOT EXISTS idx_videos_editor_status ON videos(editor_id, status);
CREATE INDEX IF NOT EXISTS idx_videos_supervisor_status ON videos(supervisor_id, status);
CREATE INDEX IF NOT EXISTS idx_videos_admin_status ON videos(admin_id, status);
CREATE INDEX IF NOT EXISTS idx_videos_status_created ON videos(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_qualities_comp ON video_qualities(video_id, quality);
CREATE INDEX IF NOT EXISTS idx_video_reviews_comp ON video_reviews(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_comp ON processing_jobs(video_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_comp ON audit_logs(user_id, created_at DESC);
`;

export function runMigrations(): void {
  // Check if users table needs migration for SuperAdmin
  try {
    const tableInfo = db.queryOne<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
    if (tableInfo && !tableInfo.sql.includes('SuperAdmin')) {
      console.log('[Migration] Migrating users table to support SuperAdmin role...');
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE users_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('SuperAdmin', 'Admin', 'Editor', 'Supervisor')),
          display_name TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO users_migrated SELECT * FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrated RENAME TO users;
        PRAGMA foreign_keys = ON;
      `);
      console.log('[Migration] users table migrated successfully to include SuperAdmin.');
    }
  } catch (err) {
    console.warn('[Migration] Notice on schema check:', err);
  }

  // Migration: videos.admin_id (انتساب ویدیو به ادمین مشخص)
  try {
    db.query('SELECT admin_id FROM videos LIMIT 1');
  } catch {
    try {
      console.log('[Migration] Adding videos.admin_id column for admin assignment...');
      db.exec('ALTER TABLE videos ADD COLUMN admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
      console.log('[Migration] videos.admin_id column added successfully.');
    } catch (err) {
      console.warn('[Migration] Could not add videos.admin_id:', err);
    }
  }

  db.exec(SCHEMA_SQL);
}
