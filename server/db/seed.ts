import bcrypt from 'bcryptjs';
import { db } from './database.ts';
import { PRIVATE_VIDEOS_DIR, PRIVATE_THUMBNAILS_DIR, PRIVATE_HLS_DIR } from '../config.ts';
import fs from 'fs';

/**
 * Production bootstrap.
 *
 * Preconfigured/test seeding has been removed:
 *  - no accounts with well-known passwords are created
 *  - no sample video/HLS content is generated on startup
 *
 * The only thing seeded is a single SuperAdmin, and only when the database has no
 * users at all. Its password must be supplied via the SUPERADMIN_INITIAL_PASSWORD
 * environment variable. For security, credentials are never written to the console.
 */
export async function seedDatabase(): Promise<void> {
  // Make sure runtime storage directories exist.
  for (const d of [PRIVATE_VIDEOS_DIR, PRIVATE_THUMBNAILS_DIR, PRIVATE_HLS_DIR]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  const existingUsers = db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users');
  const userCount = existingUsers ? Number(existingUsers.count) : 0;

  if (userCount > 0) {
    return;
  }

  const initialPassword = process.env.SUPERADMIN_INITIAL_PASSWORD;

  if (!initialPassword || initialPassword.length < 8) {
    console.warn(
      '[Seed] No users exist yet. Set SUPERADMIN_INITIAL_PASSWORD (min 8 chars) ' +
        'and restart to create the initial SuperAdmin account.'
    );
    return;
  }

  const username = (process.env.SUPERADMIN_INITIAL_USERNAME || 'superadmin').trim();
  const displayName = (process.env.SUPERADMIN_INITIAL_DISPLAY_NAME || 'Super Admin').trim();
  const hash = await bcrypt.hash(initialPassword, 12);
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO users (username, password_hash, role, display_name, is_active, created_at, updated_at)
     VALUES (?, ?, 'SuperAdmin', ?, 1, ?, ?)`,
    [username, hash, displayName, now, now]
  );

  console.log(`[Seed] Initial SuperAdmin account "${username}" created. Please change the password after first login.`);
}
