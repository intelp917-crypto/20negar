import { db, RelationalDatabase } from './database.ts';

type RelationalDatabaseLike = Pick<RelationalDatabase, 'exec' | 'run' | 'query' | 'queryOne'>;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('SuperAdmin', 'Admin', 'Editor', 'Supervisor', 'Cameraman')),
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
  -- Raw cameraman footage has no supervisor yet; the editor picks one when
  -- publishing the edited replacement.
  supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_raw INTEGER NOT NULL DEFAULT 0 CHECK(is_raw IN (0, 1)),
  editing_claimed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  editing_claimed_at TEXT,
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

/**
 * فایل خام تصویربردار تا زمانی که تدوین‌گر جایگزینش نکند، ناظر کیفی ندارد.
 * ستون supervisor_id در پایگاه‌های قدیمی NOT NULL است، بنابراین فقط در همان
 * حالت جدول videos یک‌بار بازسازی می‌شود. بقیه تغییرها افزایشی و تکرارپذیرند.
 */
function migrateVideosForRawFootage(database: RelationalDatabaseLike): void {
  const columns = database.query<{ name: string; notnull: number }>('PRAGMA table_info(videos)');
  const byName = new Map(columns.map((column) => [column.name, column]));

  if (!byName.has('is_raw')) {
    database.exec("ALTER TABLE videos ADD COLUMN is_raw INTEGER NOT NULL DEFAULT 0 CHECK(is_raw IN (0, 1))");
  }
  if (!byName.has('editing_claimed_by_id')) {
    database.exec('ALTER TABLE videos ADD COLUMN editing_claimed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
  }
  if (!byName.has('editing_claimed_at')) {
    database.exec('ALTER TABLE videos ADD COLUMN editing_claimed_at TEXT');
  }

  if (byName.get('supervisor_id')?.notnull === 1) {
    console.log('[Migration] Rebuilding videos table so raw footage can be unassigned...');
    database.exec('PRAGMA foreign_keys = OFF;');
    try {
      database.exec('BEGIN;');
      database.exec(`
        CREATE TABLE videos_raw_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          original_filename TEXT NOT NULL,
          original_path TEXT NOT NULL,
          thumbnail_path TEXT,
          editor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          supervisor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          uploaded_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          is_raw INTEGER NOT NULL DEFAULT 0 CHECK(is_raw IN (0, 1)),
          editing_claimed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          editing_claimed_at TEXT,
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
          rejected_at TEXT,
          project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL
        );
        INSERT INTO videos_raw_migrated (
          id, title, original_filename, original_path, thumbnail_path, editor_id,
          supervisor_id, admin_id, uploaded_by_id, is_raw, editing_claimed_by_id,
          editing_claimed_at, status, processing_status, duration, original_resolution,
          file_size, version_number, parent_video_id, rejection_reason, created_at,
          updated_at, approved_at, rejected_at, project_id
        )
        SELECT id, title, original_filename, original_path, thumbnail_path, editor_id,
               supervisor_id, admin_id, uploaded_by_id, is_raw, editing_claimed_by_id,
               editing_claimed_at, status, processing_status, duration, original_resolution,
               file_size, version_number, parent_video_id, rejection_reason, created_at,
               updated_at, approved_at, rejected_at, project_id
          FROM videos;
        DROP TABLE videos;
        ALTER TABLE videos_raw_migrated RENAME TO videos;
      `);
      database.exec('COMMIT;');
    } catch (error) {
      try { database.exec('ROLLBACK;'); } catch {}
      throw error;
    } finally {
      database.exec('PRAGMA foreign_keys = ON;');
    }
    console.log('[Migration] videos table rebuilt successfully.');
  }

  // آپلودهای قدیمی تصویربردار که هنوز تایید نشده‌اند، فایل خام محسوب می‌شوند.
  database.run(
    `UPDATE videos SET is_raw = 1, supervisor_id = NULL
      WHERE is_raw = 0 AND uploaded_by_id IS NOT NULL AND approved_at IS NULL`
  );

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_videos_editor_status ON videos(editor_id, status);
    CREATE INDEX IF NOT EXISTS idx_videos_supervisor_status ON videos(supervisor_id, status);
    CREATE INDEX IF NOT EXISTS idx_videos_admin_status ON videos(admin_id, status);
    CREATE INDEX IF NOT EXISTS idx_videos_status_created ON videos(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_project ON videos(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_videos_raw ON videos(is_raw, status);
    CREATE INDEX IF NOT EXISTS idx_videos_claimed ON videos(editing_claimed_by_id);
  `);
}

export function runMigrations(database = db): void {
  // Create missing base tables first so additive compatibility checks below
  // behave consistently on a fresh database and an existing legacy database.
  database.exec(SCHEMA_SQL);

  // Migration: users.role — ensure every supported role is allowed by the CHECK constraint.
  try {
    const tableInfo = database.queryOne<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
    const requiredRoles = ['SuperAdmin', 'Admin', 'Editor', 'Supervisor', 'Cameraman'];
    const missingRoles = tableInfo
      ? requiredRoles.filter((r) => !tableInfo.sql.includes(`'${r}'`))
      : [];

    if (tableInfo && missingRoles.length > 0) {
      console.log(`[Migration] Rebuilding users table to allow roles: ${missingRoles.join(', ')}`);
      database.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE users_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('SuperAdmin', 'Admin', 'Editor', 'Supervisor', 'Cameraman')),
          display_name TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO users_migrated (id, username, password_hash, role, display_name, is_active, created_at, updated_at)
          SELECT id, username, password_hash, role, display_name, is_active, created_at, updated_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrated RENAME TO users;
        PRAGMA foreign_keys = ON;
      `);
      console.log('[Migration] users table rebuilt successfully.');
    }
  } catch (err) {
    console.warn('[Migration] Notice on schema check:', err);
  }

  // Migration: videos.admin_id (assign a video to a specific admin).
  try {
    database.query('SELECT admin_id FROM videos LIMIT 1');
  } catch {
    try {
      console.log('[Migration] Adding videos.admin_id column for admin assignment...');
      database.exec('ALTER TABLE videos ADD COLUMN admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
      console.log('[Migration] videos.admin_id column added successfully.');
    } catch (err) {
      console.warn('[Migration] Could not add videos.admin_id:', err);
    }
  }

  // Migration: videos.uploaded_by_id (records the Cameraman uploader, if any).
  try {
    database.query('SELECT uploaded_by_id FROM videos LIMIT 1');
  } catch {
    try {
      console.log('[Migration] Adding videos.uploaded_by_id column for cameraman uploads...');
      database.exec('ALTER TABLE videos ADD COLUMN uploaded_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
      console.log('[Migration] videos.uploaded_by_id column added successfully.');
    } catch (err) {
      console.warn('[Migration] Could not add videos.uploaded_by_id:', err);
    }
  }

  // Versioned additive migrations. Each version is recorded only after its SQL
  // has completed, so startup can safely retry an interrupted migration.
  const currentVersion = database.queryOne<{ version: number }>(
    'SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations'
  )?.version ?? 0;
  const versionedMigrations: Array<{ version: number; sql: string }> = [
    {
      version: 1,
      sql: `
        CREATE TABLE IF NOT EXISTS upload_sessions (
          id TEXT PRIMARY KEY,
          owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          filename TEXT NOT NULL,
          expected_size INTEGER NOT NULL CHECK(expected_size >= 0),
          actual_size INTEGER CHECK(actual_size IS NULL OR actual_size >= 0),
          mime TEXT NOT NULL,
          temp_key TEXT,
          final_key TEXT,
          state TEXT NOT NULL CHECK(state IN ('pending', 'uploading', 'completed', 'finalizing', 'finalized', 'failed', 'expired', 'cancelled')) DEFAULT 'pending',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          checksum_expected TEXT,
          checksum_actual TEXT,
          verification_status TEXT NOT NULL CHECK(verification_status IN ('pending', 'verified', 'mismatch', 'failed')) DEFAULT 'pending',
          verified_at TEXT,
          finalized_video_id INTEGER REFERENCES videos(id) ON DELETE SET NULL,
          error_code TEXT,
          error_message TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_upload_sessions_owner_state ON upload_sessions(owner_id, state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_upload_sessions_expiry ON upload_sessions(expires_at);
      `,
    },
    {
      version: 2,
      sql: `
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          client_name TEXT,
          project_code TEXT UNIQUE,
          status TEXT NOT NULL CHECK(status IN ('active', 'archived')) DEFAULT 'active',
          is_confidential INTEGER NOT NULL DEFAULT 0 CHECK(is_confidential IN (0, 1)),
          created_by_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS project_members (
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          access_level TEXT NOT NULL CHECK(access_level IN ('manager', 'member', 'viewer')) DEFAULT 'member',
          created_at TEXT NOT NULL,
          PRIMARY KEY(project_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS project_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          parent_id INTEGER REFERENCES project_categories(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(project_id, parent_id, name)
        );
        CREATE TABLE IF NOT EXISTS publication_destinations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          platform TEXT NOT NULL,
          target_account TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(project_id, name)
        );
        CREATE TABLE IF NOT EXISTS publication_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          destination_id INTEGER NOT NULL REFERENCES publication_destinations(id) ON DELETE RESTRICT,
          video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE RESTRICT,
          assigned_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
          status TEXT NOT NULL CHECK(status IN ('assigned', 'downloaded', 'published', 'failed', 'cancelled')) DEFAULT 'assigned',
          instructions TEXT,
          published_url TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(destination_id, video_id)
        );
        CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id, project_id);
        CREATE INDEX IF NOT EXISTS idx_project_categories_project ON project_categories(project_id, parent_id);
        CREATE INDEX IF NOT EXISTS idx_publication_assignments_user ON publication_assignments(assigned_user_id, status);
      `,
    },
    {
      version: 3,
      sql: `
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          updated_at TEXT NOT NULL
        );
      `,
    },
    {
      version: 4,
      sql: `
        ALTER TABLE videos ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_videos_project ON videos(project_id, created_at DESC);
      `,
    },
  ];

  for (const migration of versionedMigrations) {
    if (migration.version <= currentVersion) continue;
    const now = new Date().toISOString();
    database.exec(`BEGIN;`);
    try {
      database.exec(migration.sql);
      database.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [migration.version, now]);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  // Migration 5: raw-footage workflow (nullable supervisor, raw flag, editor claim).
  const versionAfterMigrations = database.queryOne<{ version: number }>(
    'SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations'
  )?.version ?? 0;
  if (versionAfterMigrations < 5) {
    migrateVideosForRawFootage(database);
    database.run(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      [5, new Date().toISOString()]
    );
  }

  // Migration 6: Web Push subscriptions (one row per browser/device installation).
  // Like migration 5 it runs after the versioned list so the raw-footage schema
  // change above can never be skipped on a fresh database.
  const versionAfterRawFootage = database.queryOne<{ version: number }>(
    'SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations'
  )?.version ?? 0;
  if (versionAfterRawFootage < 6) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth_key TEXT NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
    `);
    database.run(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      [6, new Date().toISOString()]
    );
  }
}
