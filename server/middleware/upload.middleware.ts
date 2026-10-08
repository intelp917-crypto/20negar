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


export const videoUpload = multer({
  storage,
  limits: {
    fileSize: 4 * 1024 * 1024 * 1024, // 4 GB limit
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // پذیرش هر فایلی: فرمت‌های عجیب هم قابل آپلود هستند؛ FFmpeg سمت سرور آن‌ها را تبدیل می‌کند
    if (file.mimetype || ext) {
      cb(null, true);
    } else {
      cb(new Error('فایل ارسال‌شده نامعتبر است.'));
    }
  },
});
