import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// `quiet` keeps dotenv from printing banner/tips on every server start.
dotenv.config({ quiet: true });

function resolvePort(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw || '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

export const PORT = resolvePort(process.env.PORT, 3000);

export const ENABLE_STANDARD_PORTS = (process.env.ENABLE_STANDARD_PORTS || 'true').toLowerCase() !== 'false';
export const HTTP_PORT = resolvePort(process.env.HTTP_PORT, 80);
export const SECURE_PORT = resolvePort(process.env.SECURE_PORT, 443);
/** Public URL used when a browser reaches the server through a forwarded IP/domain. */
export const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/$/, '');
export const CORS_ORIGINS = (process.env.CORS_ORIGINS || PUBLIC_URL)
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
const configuredJwtSecret = (process.env.JWT_SECRET || '').trim();
if (process.env.NODE_ENV === 'production' && configuredJwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters in production.');
}
export const JWT_SECRET = configuredJwtSecret || '20negar-development-only-secret-change-me';
export const JWT_EXPIRES_IN = '7d';

const configuredDataDir = (process.env.NEGAR_DATA_DIR || '').trim();
export const DATA_DIR = path.resolve(configuredDataDir || path.resolve(process.cwd(), 'data'));
const configuredStorageDir = (process.env.NEGAR_STORAGE_DIR || '').trim();
export const STORAGE_DIR = path.resolve(configuredStorageDir || path.join(DATA_DIR, 'storage'));
export const PRIVATE_VIDEOS_DIR = path.resolve(process.env.NEGAR_VIDEOS_DIR || path.join(STORAGE_DIR, 'videos'));
export const PRIVATE_THUMBNAILS_DIR = path.resolve(process.env.NEGAR_THUMBNAILS_DIR || path.join(STORAGE_DIR, 'thumbnails'));
export const PRIVATE_HLS_DIR = path.resolve(process.env.NEGAR_HLS_DIR || path.join(STORAGE_DIR, 'hls'));
export const DB_FILE_PATH = path.resolve(process.env.NEGAR_DB_FILE_PATH || path.join(DATA_DIR, 'cineflow.sqlite'));
export const SSL_DIR = path.resolve(process.env.NEGAR_SSL_DIR || path.join(DATA_DIR, 'certs'));

// Ensure base directories exist
for (const dir of [DATA_DIR, STORAGE_DIR, PRIVATE_VIDEOS_DIR, PRIVATE_THUMBNAILS_DIR, PRIVATE_HLS_DIR, SSL_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
