import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// `quiet` keeps dotenv from printing banner/tips on every server start.
dotenv.config({ quiet: true });

export const PORT = parseInt(process.env.PORT || '3000', 10);

// پورت‌های استاندارد: VPN ها معمولاً فقط ترافیک پورت‌های 80 و 443 را عبور می‌دهند.
// با فعال بودن، سرور همزمان روی این پورت‌ها هم listen می‌کند تا با VPN روشن هم قابل دسترسی باشد.
export const ENABLE_STANDARD_PORTS = (process.env.ENABLE_STANDARD_PORTS || 'true').toLowerCase() !== 'false';
export const HTTP_PORT = parseInt(process.env.HTTP_PORT || '80', 10);
export const SECURE_PORT = parseInt(process.env.SECURE_PORT || '443', 10);
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

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const STORAGE_DIR = path.resolve(DATA_DIR, 'storage');
export const PRIVATE_VIDEOS_DIR = path.resolve(STORAGE_DIR, 'videos');
export const PRIVATE_THUMBNAILS_DIR = path.resolve(STORAGE_DIR, 'thumbnails');
export const PRIVATE_HLS_DIR = path.resolve(STORAGE_DIR, 'hls');
export const DB_FILE_PATH = path.resolve(DATA_DIR, 'cineflow.sqlite');
export const SSL_DIR = path.resolve(DATA_DIR, 'certs');

// Ensure base directories exist
for (const dir of [DATA_DIR, STORAGE_DIR, PRIVATE_VIDEOS_DIR, PRIVATE_THUMBNAILS_DIR, PRIVATE_HLS_DIR, SSL_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
