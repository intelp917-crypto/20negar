import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { STORAGE_DIR } from '../config.ts';

const tempUploadDir = path.resolve(STORAGE_DIR, 'temp');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, tempUploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `upload-${uniqueSuffix}${ext}`);
  },
});

const allowedMimeTypes = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/avi',
  'video/x-msvideo',
  'video/mpeg',
  'video/x-m4v',
  'video/3gpp',
  'video/x-flv',
  'application/octet-stream',
];

export const videoUpload = multer({
  storage,
  limits: {
    fileSize: 4 * 1024 * 1024 * 1024, // 4 GB limit
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const validExts = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v', '.ts', '.flv', '.wmv'];
    if (file.mimetype.startsWith('video/') || allowedMimeTypes.includes(file.mimetype) || validExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`فرمت فایل ویدیویی نامعتبر است (${file.mimetype}). فرمت‌های مجاز: MP4, MOV, MKV, WebM, AVI`));
    }
  },
});
