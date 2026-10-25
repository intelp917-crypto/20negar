import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { STORAGE_DIR, MAX_UPLOAD_FILE_SIZE } from '../config.ts';

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
    fileSize: MAX_UPLOAD_FILE_SIZE,
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

const reviewVoiceStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tempUploadDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `review-voice-${uniqueSuffix}${path.extname(file.originalname) || '.webm'}`);
  },
});

/** Voice notes are intentionally bounded separately from the 8 GiB media policy. */
export const reviewVoiceUpload = multer({
  storage: reviewVoiceStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm') cb(null, true);
    else cb(new Error('فرمت فایل صوتی ناظر پشتیبانی نمی‌شود.'));
  },
});
