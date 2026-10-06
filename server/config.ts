import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

export const PORT = parseInt(process.env.PORT || '3000', 10);
export const JWT_SECRET = process.env.JWT_SECRET || 'cineflow-super-secret-production-jwt-key-2026';
export const JWT_EXPIRES_IN = '7d';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const STORAGE_DIR = path.resolve(DATA_DIR, 'storage');
export const PRIVATE_VIDEOS_DIR = path.resolve(STORAGE_DIR, 'videos');
export const PRIVATE_THUMBNAILS_DIR = path.resolve(STORAGE_DIR, 'thumbnails');
export const PRIVATE_HLS_DIR = path.resolve(STORAGE_DIR, 'hls');
export const DB_FILE_PATH = path.resolve(DATA_DIR, 'cineflow.sqlite');

// Ensure base directories exist
for (const dir of [DATA_DIR, STORAGE_DIR, PRIVATE_VIDEOS_DIR, PRIVATE_THUMBNAILS_DIR, PRIVATE_HLS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
