import bcrypt from 'bcryptjs';
import { db } from './database.ts';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { PRIVATE_VIDEOS_DIR, PRIVATE_THUMBNAILS_DIR, PRIVATE_HLS_DIR } from '../config.ts';

export async function seedDatabase(): Promise<void> {
  const existingUsers = db.query('SELECT COUNT(*) as count FROM users');
  const count = existingUsers.length > 0 ? (existingUsers[0].count as number) : 0;

  let superadminId = 1;
  let adminId = 2;
  let editorId = 3;
  let supervisorId = 4;

  // Check if superadmin specifically exists
  const superadminUser = db.queryOne<{ id: number }>('SELECT id FROM users WHERE username = ?', ['superadmin']);
  if (!superadminUser) {
    console.log('[Seed] Seeding SuperAdmin user (superadmin / superadmin)...');
    const superadminHash = await bcrypt.hash('superadmin', 10);
    const now = new Date().toISOString();
    const res = db.run(
      `INSERT INTO users (username, password_hash, role, display_name, is_active, created_at, updated_at)
       VALUES (?, ?, 'SuperAdmin', ?, 1, ?, ?)`,
      ['superadmin', superadminHash, 'سامان کیانی (مدیرکل)', now, now]
    );
    superadminId = res.lastInsertRowid;
  } else {
    superadminId = superadminUser.id;
    db.run("UPDATE users SET display_name = 'سامان کیانی (مدیرکل)' WHERE username = 'superadmin'");
  }

  if (count <= 1) {
    console.log('[Seed] Seeding default users (admin1, editor1, supervisor1)...');
    const adminHash = await bcrypt.hash('admin1', 10);
    const editorHash = await bcrypt.hash('editor1', 10);
    const supervisorHash = await bcrypt.hash('supervisor1', 10);
    const now = new Date().toISOString();

    const resAdmin = db.run(
      `INSERT INTO users (username, password_hash, role, display_name, is_active, created_at, updated_at)
       VALUES (?, ?, 'Admin', ?, 1, ?, ?)`,
      ['admin1', adminHash, 'آرش زمانی (ادمین)', now, now]
    );
    adminId = resAdmin.lastInsertRowid;

    const resEditor = db.run(
      `INSERT INTO users (username, password_hash, role, display_name, is_active, created_at, updated_at)
       VALUES (?, ?, 'Editor', ?, 1, ?, ?)`,
      ['editor1', editorHash, 'النا رستمی (تدوین‌گر)', now, now]
    );
    editorId = resEditor.lastInsertRowid;

    const resSupervisor = db.run(
      `INSERT INTO users (username, password_hash, role, display_name, is_active, created_at, updated_at)
       VALUES (?, ?, 'Supervisor', ?, 1, ?, ?)`,
      ['supervisor1', supervisorHash, 'مهدی کمالی (ناظر کیفی)', now, now]
    );
    supervisorId = resSupervisor.lastInsertRowid;

    console.log('[Seed] Users seeded successfully with secure BCrypt hashes.');
  } else {
    const admin = db.queryOne<{ id: number }>('SELECT id FROM users WHERE username = ?', ['admin1']);
    const editor = db.queryOne<{ id: number }>('SELECT id FROM users WHERE username = ?', ['editor1']);
    const supervisor = db.queryOne<{ id: number }>('SELECT id FROM users WHERE username = ?', ['supervisor1']);
    if (admin) {
      adminId = admin.id;
      db.run("UPDATE users SET display_name = 'آرش زمانی (ادمین)' WHERE username = 'admin1'");
    }
    if (editor) {
      editorId = editor.id;
      db.run("UPDATE users SET display_name = 'النا رستمی (تدوین‌گر)' WHERE username = 'editor1'");
    }
    if (supervisor) {
      supervisorId = supervisor.id;
      db.run("UPDATE users SET display_name = 'مهدی کمالی (ناظر کیفی)' WHERE username = 'supervisor1'");
    }
  }

  // Ensure directories exist
  for (const d of [PRIVATE_VIDEOS_DIR, PRIVATE_THUMBNAILS_DIR, PRIVATE_HLS_DIR]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  // Check if videos exist in database and on physical disk
  const sample1Exists = fs.existsSync(path.join(PRIVATE_VIDEOS_DIR, 'sample-neon-cyberpunk.mp4'));
  const existingVideos = db.query('SELECT COUNT(*) as count FROM videos');
  const videoCount = existingVideos.length > 0 ? (existingVideos[0].count as number) : 0;

  if (videoCount === 0 || !sample1Exists) {
    console.log('[Seed] Generating demo sample videos and HLS streams with FFmpeg...');
    try {
      await generateSeedVideoFiles(adminId, editorId, supervisorId, videoCount === 0);
    } catch (err) {
      console.warn('[Seed] Notice: Could not generate FFmpeg demo seed videos automatically:', err);
    }
  }
}

async function generateSeedVideoFiles(adminId: number, editorId: number, supervisorId: number, shouldInsertDb: boolean) {
  const sample1File = 'sample-neon-cyberpunk.mp4';
  const sample2File = 'sample-nature-documentary.mp4';
  const sample3File = 'sample-audio-retake.mp4';

  const s1Path = path.join(PRIVATE_VIDEOS_DIR, sample1File);
  const s2Path = path.join(PRIVATE_VIDEOS_DIR, sample2File);
  const s3Path = path.join(PRIVATE_VIDEOS_DIR, sample3File);

  const thumb1File = 'sample-neon-cyberpunk.jpg';
  const thumb2File = 'sample-nature-documentary.jpg';
  const thumb3File = 'sample-audio-retake.jpg';

  const t1Path = path.join(PRIVATE_THUMBNAILS_DIR, thumb1File);
  const t2Path = path.join(PRIVATE_THUMBNAILS_DIR, thumb2File);
  const t3Path = path.join(PRIVATE_THUMBNAILS_DIR, thumb3File);

  const createClip = (color: string, text: string, outFile: string, thumbFile: string, dur = 6) => {
    return new Promise<void>((resolve) => {
      if (fs.existsSync(outFile) && fs.existsSync(thumbFile)) {
        return resolve();
      }
      const child = spawn(
        'ffmpeg',
        [
          '-y',
          '-f', 'lavfi',
          '-i', `color=c=${color}:s=1280x720:d=${dur}:r=30`,
          '-f', 'lavfi',
          '-i', 'sine=frequency=440:duration=' + dur,
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          outFile
        ],
        { stdio: 'ignore' }
      );
      child.on('close', (code) => {
        if (code === 0) {
          const thumbProc = spawn(
            'ffmpeg',
            ['-y', '-ss', '00:00:01', '-i', outFile, '-frames:v', '1', '-q:v', '2', thumbFile],
            { stdio: 'ignore' }
          );
          thumbProc.on('close', () => resolve());
          thumbProc.on('error', () => resolve());
        } else {
          resolve();
        }
      });
      child.on('error', () => resolve());
    });
  };

  await Promise.all([
    createClip('darkblue', 'APPROVED CUT', s1Path, t1Path, 6),
    createClip('darkgreen', 'PENDING REVIEW', s2Path, t2Path, 6),
    createClip('darkred', 'REJECTED - NEEDS AUDIO FIX', s3Path, t3Path, 6)
  ]);

  // Generate HLS streams for each demo video
  const createHls = (videoNum: number, mp4Path: string) => {
    return new Promise<void>((resolve) => {
      const hlsDir = path.join(PRIVATE_HLS_DIR, `video_${videoNum}`);
      if (!fs.existsSync(hlsDir)) fs.mkdirSync(hlsDir, { recursive: true });
      const masterPath = path.join(hlsDir, 'master.m3u8');
      const segmentPattern = path.join(hlsDir, 'segment_%03d.ts');

      const child = spawn(
        'ffmpeg',
        [
          '-y',
          '-i', mp4Path,
          '-c:v', 'copy',
          '-c:a', 'copy',
          '-hls_time', '2',
          '-hls_playlist_type', 'vod',
          '-hls_segment_filename', segmentPattern,
          masterPath
        ],
        { stdio: 'ignore' }
      );
      child.on('close', () => resolve());
      child.on('error', () => resolve());
    });
  };

  await Promise.all([
    createHls(1, s1Path),
    createHls(2, s2Path),
    createHls(3, s3Path),
  ]);

  if (!shouldInsertDb) return;

  const now = new Date();
  const past2d = new Date(now.getTime() - 2 * 24 * 3600 * 1000).toISOString();
  const past1d = new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString();
  const nowIso = now.toISOString();

  // 1. Approved Video
  const stat1 = fs.existsSync(s1Path) ? fs.statSync(s1Path).size : 70898;
  const res1 = db.run(
    `INSERT INTO videos (
      title, original_filename, original_path, thumbnail_path, editor_id, supervisor_id,
      status, processing_status, duration, original_resolution, file_size,
      version_number, created_at, updated_at, approved_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'Approved', 'Ready', 6.0, '1280x720 (720p)', ?, 1, ?, ?, ?)`,
    [
      'تیزر معرفی محصولات بهاره - نسخه تایید شده',
      'bahar_promo_cut_final.mp4',
      'videos/' + sample1File,
      'thumbnails/' + thumb1File,
      editorId,
      supervisorId,
      stat1,
      past2d,
      past1d,
      past1d
    ]
  );
  const vid1 = res1.lastInsertRowid;

  db.run(
    `INSERT INTO video_qualities (video_id, quality, file_path, width, height, bitrate, file_size, created_at)
     VALUES (?, 'Original', ?, 1280, 720, 2500000, ?, ?)`,
    [vid1, 'videos/' + sample1File, stat1, past2d]
  );
  db.run(
    `INSERT INTO video_qualities (video_id, quality, file_path, width, height, bitrate, file_size, created_at)
     VALUES (?, '720p', ?, 1280, 720, 1800000, ?, ?)`,
    [vid1, 'videos/' + sample1File, stat1, past2d]
  );
  db.run(
    `INSERT INTO video_qualities (video_id, quality, file_path, width, height, bitrate, file_size, created_at)
     VALUES (?, '480p', ?, 854, 480, 900000, ?, ?)`,
    [vid1, 'videos/' + sample1File, Math.floor(stat1 * 0.6), past2d]
  );
  db.run(
    `INSERT INTO video_reviews (video_id, supervisor_id, editor_id, action, comment, created_at)
     VALUES (?, ?, ?, 'Approved', 'رنگ و نور بسیار عالی تنظیم شده و هماهنگی موسیقی کاملا بی‌نقص است. تایید نهایی برای خروجی.', ?)`,
    [vid1, supervisorId, editorId, past1d]
  );

  // 2. Pending Review Video
  const stat2 = fs.existsSync(s2Path) ? fs.statSync(s2Path).size : 70897;
  const res2 = db.run(
    `INSERT INTO videos (
      title, original_filename, original_path, thumbnail_path, editor_id, supervisor_id,
      status, processing_status, duration, original_resolution, file_size,
      version_number, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'PendingReview', 'Ready', 6.0, '1280x720 (720p)', ?, 1, ?, ?)`,
    [
      'مستند جاذبه‌های گردشگری - راف‌کات قسمت اول',
      'tourism_ep1_roughcut.mp4',
      'videos/' + sample2File,
      'thumbnails/' + thumb2File,
      editorId,
      supervisorId,
      stat2,
      past1d,
      nowIso
    ]
  );
  const vid2 = res2.lastInsertRowid;
  db.run(
    `INSERT INTO video_qualities (video_id, quality, file_path, width, height, bitrate, file_size, created_at)
     VALUES (?, 'Original', ?, 1280, 720, 2200000, ?, ?)`,
    [vid2, 'videos/' + sample2File, stat2, past1d]
  );
  db.run(
    `INSERT INTO video_qualities (video_id, quality, file_path, width, height, bitrate, file_size, created_at)
     VALUES (?, '720p', ?, 1280, 720, 1600000, ?, ?)`,
    [vid2, 'videos/' + sample2File, stat2, past1d]
  );

  // 3. Rejected Video
  const stat3 = fs.existsSync(s3Path) ? fs.statSync(s3Path).size : 70899;
  const rejectionText = 'صدای گوینده در ابتدای ویدیو کمی نامفهوم است و ترنزیشن صحنه پایانی نیاز به اصلاح و نرم‌تر شدن دارد.';
  const res3 = db.run(
    `INSERT INTO videos (
      title, original_filename, original_path, thumbnail_path, editor_id, supervisor_id,
      status, processing_status, duration, original_resolution, file_size,
      version_number, rejection_reason, created_at, updated_at, rejected_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'Rejected', 'Ready', 6.0, '1280x720 (720p)', ?, 1, ?, ?, ?, ?)`,
    [
      'تیزر شبکه اجتماعی اینستاگرام - نگارش اول',
      'social_teaser_v1.mp4',
      'videos/' + sample3File,
      'thumbnails/' + thumb3File,
      editorId,
      supervisorId,
      stat3,
      rejectionText,
      past2d,
      past1d,
      past1d
    ]
  );
  const vid3 = res3.lastInsertRowid;
  db.run(
    `INSERT INTO video_qualities (video_id, quality, file_path, width, height, bitrate, file_size, created_at)
     VALUES (?, 'Original', ?, 1280, 720, 2000000, ?, ?)`,
    [vid3, 'videos/' + sample3File, stat3, past2d]
  );
  db.run(
    `INSERT INTO video_reviews (video_id, supervisor_id, editor_id, action, comment, created_at)
     VALUES (?, ?, ?, 'Rejected', ?, ?)`,
    [vid3, supervisorId, editorId, rejectionText, past1d]
  );

  // Logs
  db.run(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, description, ip_address, created_at)
     VALUES (?, 'تایید ویدیو', 'Video', ?, 'ناظر کیفی ویدیوی "تیزر معرفی محصولات بهاره" را تایید کرد.', '127.0.0.1', ?)`,
    [supervisorId, vid1, past1d]
  );
  db.run(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, description, ip_address, created_at)
     VALUES (?, 'رد ویدیو جهت اصلاح', 'Video', ?, 'ناظر کیفی ویدیوی "تیزر شبکه اجتماعی اینستاگرام" را جهت بازبینی و اصلاح رد کرد.', '127.0.0.1', ?)`,
    [supervisorId, vid3, past1d]
  );

  // Notifications
  db.run(
    `INSERT INTO notifications (user_id, title, message, type, is_read, link, created_at)
     VALUES (?, 'ویدیو تایید شد', 'پروژه "تیزر معرفی محصولات بهاره" توسط مهدی کمالی تایید شد.', 'success', 0, '/videos/1', ?)`,
    [editorId, past1d]
  );
  db.run(
    `INSERT INTO notifications (user_id, title, message, type, is_read, link, created_at)
     VALUES (?, 'درخواست اصلاحات', 'مهدی کمالی برای ویدیو درخواست بازبینی ثبت کرد: ${rejectionText}', 'warning', 0, '/videos/3', ?)`,
    [editorId, past1d]
  );

  console.log('[Seed] Persian 20Negar demo data and HLS streams seeded successfully.');
}
