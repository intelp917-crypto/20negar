import { spawn } from 'child_process';
import path from 'path';
import { FFMPEG_PATH, FFPROBE_PATH } from './ffmpeg.ts';
import fs from 'fs';
import { db } from '../db/database.ts';
import { fileStorage } from '../storage/local.storage.ts';
import { PRIVATE_THUMBNAILS_DIR, PRIVATE_VIDEOS_DIR, PRIVATE_HLS_DIR } from '../config.ts';

const TRANSCODER_PROCESS_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.TRANSCODER_PROCESS_TIMEOUT_MS || '', 10) || 30 * 60_000
);
const PROCESS_KILL_GRACE_MS = 2_000;

export interface QualityTarget {
  name: '1080p' | '720p' | '480p' | '360p';
  width: number;
  height: number;
  videoBitrate: string;
  audioBitrate: string;
  crf: string;
}

/**
 * Quality ladder used for adaptive streaming (HLS variants).
 *
 * Important: the uploaded file is always stored untouched and is the default
 * quality for playback and download, so the source quality is never lost. When
 * a rendition would not actually be downscaled (source height <= preset
 * height) it is REMUXED with `-c copy` instead of re-encoded, which keeps the
 * original video bitstream bit-for-bit.
 */
export const QUALITY_PRESETS: QualityTarget[] = [
  { name: '1080p', width: 1920, height: 1080, videoBitrate: '4500k', audioBitrate: '192k', crf: '20' },
  { name: '720p', width: 1280, height: 720, videoBitrate: '2500k', audioBitrate: '160k', crf: '21' },
  { name: '480p', width: 854, height: 480, videoBitrate: '1400k', audioBitrate: '128k', crf: '22' },
  { name: '360p', width: 640, height: 360, videoBitrate: '1000k', audioBitrate: '96k', crf: '23' },
];

/** Rounds down to the nearest even number (H.264 requires even dimensions). */
function even(value: number): number {
  const v = Math.round(value);
  return v % 2 === 0 ? v : v - 1;
}

export interface ProcessingProgressDetails {
  original: 'completed';
  thumbnail: 'pending' | 'processing' | 'completed' | 'failed';
  '1080p'?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  '720p'?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  '480p'?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  '360p'?: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';
  hls?: 'pending' | 'processing' | 'completed' | 'failed';
}

export class TranscoderService {
  private static isProcessing = false;
  private static workerInterval: NodeJS.Timeout | null = null;

  public static startWorker(): void {
    if (this.workerInterval) return;
    console.log('[Transcoder] Background worker started.');
    // Check for pending jobs every 2 seconds
    this.workerInterval = setInterval(() => {
      this.processNextJob();
    }, 2000);
    // Also trigger immediately
    this.processNextJob();
  }

  public static stopWorker(): void {
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }
  }

  public static queueVideo(videoId: number): number {
    const now = new Date().toISOString();
    const initialDetails: ProcessingProgressDetails = {
      original: 'completed',
      thumbnail: 'pending',
      '1080p': 'pending',
      '720p': 'pending',
      '480p': 'pending',
      '360p': 'pending',
      hls: 'pending',
    };

    const res = db.run(
      `INSERT INTO processing_jobs (video_id, status, progress, current_step, details, created_at, updated_at)
       VALUES (?, 'pending', 0, 'Queued for processing', ?, ?, ?)`,
      [videoId, JSON.stringify(initialDetails), now, now]
    );

    db.run(
      `UPDATE videos SET processing_status = 'Processing', updated_at = ? WHERE id = ?`,
      [now, videoId]
    );

    // Trigger worker
    setImmediate(() => this.processNextJob());

    return res.lastInsertRowid;
  }

  public static async processNextJob(): Promise<void> {
    if (this.isProcessing) return;

    const nextJob = db.queryOne<{
      id: number;
      video_id: number;
      status: string;
      details: string;
    }>(
      `SELECT id, video_id, status, details FROM processing_jobs WHERE status = 'pending' ORDER BY id ASC LIMIT 1`
    );

    if (!nextJob) return;

    this.isProcessing = true;
    const jobId = nextJob.id;
    const videoId = nextJob.video_id;

    try {
      console.log(`[Transcoder] Processing job #${jobId} for video #${videoId}`);
      await this.executeJob(jobId, videoId);
    } catch (err: any) {
      console.error(`[Transcoder] Failed to process job #${jobId}:`, err);
      const now = new Date().toISOString();
      db.run(
        `UPDATE processing_jobs 
         SET status = 'failed', current_step = 'Error during transcoding', error_message = ?, updated_at = ? 
         WHERE id = ?`,
        [err.message || String(err), now, jobId]
      );
      db.run(
        `UPDATE videos SET processing_status = 'ProcessingFailed', updated_at = ? WHERE id = ?`,
        [now, videoId]
      );
    } finally {
      this.isProcessing = false;
      // Check if more jobs are queued
      setImmediate(() => this.processNextJob());
    }
  }

  private static async executeJob(jobId: number, videoId: number): Promise<void> {
    const video = db.queryOne<{
      id: number;
      title: string;
      original_filename: string;
      original_path: string;
      file_size: number;
    }>(`SELECT * FROM videos WHERE id = ?`, [videoId]);

    if (!video) {
      throw new Error(`Video #${videoId} not found`);
    }

    const originalFullPath = fileStorage.getPhysicalPath(video.original_path);
    if (!fs.existsSync(originalFullPath)) {
      throw new Error(`Original video file not found at ${originalFullPath}`);
    }

    const details: ProcessingProgressDetails = {
      original: 'completed',
      thumbnail: 'processing',
      '1080p': 'pending',
      '720p': 'pending',
      '480p': 'pending',
      '360p': 'pending',
      hls: 'pending',
    };

    const updateJob = (step: string, progress: number) => {
      const now = new Date().toISOString();
      db.run(
        `UPDATE processing_jobs 
         SET status = 'processing', progress = ?, current_step = ?, details = ?, updated_at = ?
         WHERE id = ?`,
        [progress, step, JSON.stringify(details), now, jobId]
      );
    };

    updateJob('Analyzing video stream & metadata', 5);

    // 1. Probe video metadata
    const meta = await this.probeMetadata(originalFullPath);
    console.log(`[Transcoder] Video metadata probed: ${meta.width}x${meta.height}, duration: ${meta.duration}s`);

    const originalResolutionStr = `${meta.width}x${meta.height}`;
    db.run(
      `UPDATE videos SET duration = ?, original_resolution = ? WHERE id = ?`,
      [meta.duration, originalResolutionStr, videoId]
    );

    // Store Original in video_qualities if not already present
    const existingOrig = db.queryOne(
      `SELECT id FROM video_qualities WHERE video_id = ? AND quality = 'Original'`,
      [videoId]
    );
    if (!existingOrig) {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO video_qualities (video_id, quality, file_path, width, height, bitrate, file_size, created_at)
         VALUES (?, 'Original', ?, ?, ?, ?, ?, ?)`,
        [videoId, video.original_path, meta.width, meta.height, meta.bitrate, video.file_size, now]
      );
    }

    // 2. Generate Thumbnail
    const stillHere = () => Boolean(db.queryOne<{ id: number }>(`SELECT id FROM videos WHERE id = ?`, [videoId]));
    if (!stillHere()) throw new Error(`VIDEODELETED: the video was deleted while processing was in progress.`);

    updateJob('Generating high-resolution thumbnail', 15);
    const thumbFilename = `thumb_v${videoId}_${Date.now()}.jpg`;
    const thumbFullPath = path.join(PRIVATE_THUMBNAILS_DIR, thumbFilename);
    const thumbKey = `thumbnails/${thumbFilename}`;

    try {
      // فریم اول ویدیو (بدون seek زمانی) به‌عنوان تصویر بندانگشتی
      await this.runFfmpeg([
        '-y',
        '-i', originalFullPath,
        '-frames:v', '1',
        '-q:v', '2',
        '-vf', 'scale=640:-2',
        thumbFullPath,
      ]);
      details.thumbnail = 'completed';
      db.run(`UPDATE videos SET thumbnail_path = ? WHERE id = ?`, [thumbKey, videoId]);
    } catch (thumbErr) {
      console.warn('[Transcoder] Thumbnail extraction error, trying fallback with fast seek:', thumbErr);
      try {
        await this.runFfmpeg([
          '-y',
          '-ss', '0',
          '-i', originalFullPath,
          '-frames:v', '1',
          '-q:v', '2',
          thumbFullPath,
        ]);
        details.thumbnail = 'completed';
        db.run(`UPDATE videos SET thumbnail_path = ? WHERE id = ?`, [thumbKey, videoId]);
      } catch (err2) {
        details.thumbnail = 'failed';
      }
    }

    // 3. Multi-resolution Transcoding
    if (!stillHere()) throw new Error(`VIDEODELETED: the video was deleted while processing was in progress.`);

    const targetsToProcess = QUALITY_PRESETS.filter((p) => {
      // Only transcode down or matching original height + reasonable buffer
      return p.height <= meta.height * 1.05 || p.name === '360p' || p.name === '480p';
    });

    let currentProgress = 25;
    const progressPerResolution = Math.floor(55 / Math.max(1, targetsToProcess.length));

    for (const target of targetsToProcess) {
      details[target.name] = 'processing';
      updateJob(`Transcoding ${target.name} MP4 rendition`, currentProgress);

      const targetFilename = `video_${videoId}_${target.name}.mp4`;
      const targetFullPath = path.join(PRIVATE_VIDEOS_DIR, targetFilename);
      const targetKey = `videos/${targetFilename}`;

      // A rendition is lossless when the source is already at (or below) this
      // preset's height: no scaling is needed, so the bitstream is remuxed
      // instead of re-encoded.
      const losslessRemux = meta.height <= target.height;

      try {
        if (losslessRemux) {
          // Stream copy: zero re-encoding, zero quality loss.
          await this.runFfmpeg([
            '-y',
            '-i', originalFullPath,
            '-c', 'copy',
            '-movflags', '+faststart',
            targetFullPath,
          ]);
        } else {
          // Genuine downscale (adaptive streaming variant): keep the highest
          // practical visual quality with a slow-ish preset and low CRF.
          await this.runFfmpeg([
            '-y',
            '-i', originalFullPath,
            '-vf', `scale='min(${target.width},iw)':-2`,
            '-c:v', 'libx264',
            '-crf', target.crf,
            '-preset', 'medium',
            '-c:a', 'aac',
            '-b:a', target.audioBitrate,
            '-movflags', '+faststart',
            targetFullPath,
          ]);
        }

        const stat = fs.statSync(targetFullPath);
        const now = new Date().toISOString();
        const actualWidth = losslessRemux ? meta.width : Math.min(target.width, meta.width);
        const actualHeight = losslessRemux ? meta.height : even((actualWidth / Math.max(1, meta.width)) * meta.height);

        // Check if quality record exists
        const existingQuality = db.queryOne(
          `SELECT id FROM video_qualities WHERE video_id = ? AND quality = ?`,
          [videoId, target.name]
        );
        if (existingQuality) {
          db.run(
            `UPDATE video_qualities SET file_path = ?, file_size = ?, width = ?, height = ? WHERE id = ?`,
            [targetKey, stat.size, actualWidth, actualHeight, existingQuality.id]
          );
        } else {
          db.run(
            `INSERT INTO video_qualities (video_id, quality, file_path, width, height, bitrate, file_size, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [videoId, target.name, targetKey, actualWidth, actualHeight, parseInt(target.videoBitrate, 10) * 1000, stat.size, now]
          );
        }

        details[target.name] = 'completed';
        if (losslessRemux) {
          console.log(`[Transcoder] ${target.name} rendition remuxed without re-encoding (lossless).`);
        }
      } catch (err: any) {
        console.error(`[Transcoder] Failed to encode ${target.name}:`, err);
        details[target.name] = 'failed';
      }

      currentProgress += progressPerResolution;
      updateJob(`Completed ${target.name} rendition`, currentProgress);
    }

    // 4. Generate HLS Adaptive Streaming — نردبان چندکیفیتی (Multi-Variant)
    if (!stillHere()) throw new Error(`VIDEODELETED: the video was deleted while processing was in progress.`);

    // 4. Generate HLS Adaptive Streaming — نردبان چندکیفیتی (Multi-Variant)
    if (!stillHere()) throw new Error(`VIDEODELETED: the video was deleted while processing was in progress.`);
    // خروجی‌های MP4 ترنسکدشده بدون رمزگذاری مجدد فقط Remux می‌شوند (بسیار سریع) و
    // پلی‌لیست اصلی master.m3u8 ساخته می‌شود تا پلیر (hls.js) بر اساس سرعت شبکه
    // به‌صورت خودکار کیفیت را پایین‌تر بیاورد (ABR) و در صورت سرعت مناسب بالا ببرد.
    updateJob('Generating HLS adaptive streaming segments', 85);
    details.hls = 'processing';
    const videoHlsDir = path.join(PRIVATE_HLS_DIR, `video_${videoId}`);

    try {
      // پاکسازی خروجی‌های قبلی همین ویدیو (جلوگیری از پلی‌لیست کهنه)
      fs.rmSync(videoHlsDir, { recursive: true, force: true });
      fs.mkdirSync(videoHlsDir, { recursive: true });

      interface HlsVariant {
        label: string;
        bandwidth: number;
        width: number;
        height: number;
      }
      const variants: HlsVariant[] = [];

      for (const preset of QUALITY_PRESETS) {
        if (details[preset.name] !== 'completed') continue;
        const renditionPath = path.join(PRIVATE_VIDEOS_DIR, `video_${videoId}_${preset.name}.mp4`);
        if (!fs.existsSync(renditionPath)) continue;

        const variantDir = path.join(videoHlsDir, `stream_${preset.name}`);
        fs.mkdirSync(variantDir, { recursive: true });

        // فقط Remux (بدون encode) → چند ثانیه بیشتر طول نمی‌کشد
        await this.runFfmpeg([
          '-y',
          '-i', renditionPath,
          '-c', 'copy',
          '-hls_time', '4',
          '-hls_playlist_type', 'vod',
          '-hls_segment_filename', path.join(variantDir, 'segment_%03d.ts'),
          path.join(variantDir, 'index.m3u8'),
        ]);

        const st = fs.statSync(renditionPath);
        const bandwidth = Math.max(100_000, Math.round((st.size * 8) / Math.max(1, meta.duration || 10)));
        // اندازه واقعی: scale='min(preset.width, iw)':-2 → بدون بزرگ‌نمایی
        const width = Math.min(preset.width, meta.width);
        const height = Math.max(2, Math.round(((width / Math.max(1, meta.width)) * meta.height) / 2) * 2);
        variants.push({ label: preset.name, bandwidth, width, height });
      }

      // اگر منبع از بالاترین رندیشن ساخته‌شده بزرگ‌تر باشد (مثلاً منبع 4K)،
      // خودِ فایل اصلی را هم به‌عنوان بالاترین پلهٔ نردبان HLS اضافه می‌کنیم تا
      // پخش نیز دقیقاً با کیفیت کامل منبع انجام شود (بدون هیچ کاهش کیفیتی).
      const highestBuiltHeight = variants.reduce((max, v) => Math.max(max, v.height), 0);
      if (meta.height > highestBuiltHeight) {
        const sourceDir = path.join(videoHlsDir, 'stream_source');
        fs.mkdirSync(sourceDir, { recursive: true });
        try {
          await this.runFfmpeg([
            '-y',
            '-i', originalFullPath,
            '-c', 'copy',
            '-bsf:v', 'h264_mp4toannexb',
            '-hls_time', '4',
            '-hls_playlist_type', 'vod',
            '-hls_segment_filename', path.join(sourceDir, 'segment_%03d.ts'),
            path.join(sourceDir, 'index.m3u8'),
          ]);
          const srcSize = fs.statSync(originalFullPath).size;
          const srcBandwidth = Math.max(
            100_000,
            Math.round((srcSize * 8) / Math.max(1, meta.duration || 10))
          );
          variants.push({
            label: 'source',
            bandwidth: srcBandwidth,
            width: meta.width,
            height: meta.height,
          });
          console.log('[Transcoder] Original source added to HLS ladder (lossless, full quality).');
        } catch (srcErr) {
          console.warn('[Transcoder] HLS source remux skipped (codec not TS-compatible):', srcErr);
        }
      }

      if (variants.length >= 2) {
        const masterLines = ['#EXTM3U', '#EXT-X-VERSION:3'];
        for (const v of variants) {
          masterLines.push(
            `#EXT-X-STREAM-INF:BANDWIDTH=${v.bandwidth},AVERAGE-BANDWIDTH=${v.bandwidth},RESOLUTION=${v.width}x${v.height}`
          );
          masterLines.push(`stream_${v.label}/index.m3u8`);
        }
        masterLines.push('');
        fs.writeFileSync(path.join(videoHlsDir, 'master.m3u8'), masterLines.join('\n'));
        details.hls = 'completed';
        console.log(
          `[Transcoder] HLS multi-variant ladder ready for video #${videoId}: ${variants.map((v) => v.label).join(', ')}`
        );
      } else {
        // Only one rendition is ready → build a simple HLS playlist from the
        // original. Remux first (no re-encode, no quality loss); fall back to
        // transcoding only if the source codecs are not HLS-compatible.
        const hlsMasterPath = path.join(videoHlsDir, 'master.m3u8');
        const hlsSegmentPath = path.join(videoHlsDir, 'segment_%03d.ts');

        try {
          await this.runFfmpeg([
            '-y',
            '-i', originalFullPath,
            '-c', 'copy',
            '-bsf:v', 'h264_mp4toannexb',
            '-hls_time', '4',
            '-hls_playlist_type', 'vod',
            '-hls_segment_filename', hlsSegmentPath,
            hlsMasterPath,
          ]);
        } catch (remuxErr) {
          console.warn('[Transcoder] HLS remux failed, transcoding instead (quality-preserving CRF).');
          await this.runFfmpeg([
            '-y',
            '-i', originalFullPath,
            '-c:v', 'libx264',
            '-crf', '18',
            '-preset', 'medium',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-hls_time', '4',
            '-hls_playlist_type', 'vod',
            '-hls_segment_filename', hlsSegmentPath,
            hlsMasterPath,
          ]);
        }
        details.hls = 'completed';
      }
    } catch (hlsErr) {
      console.warn('[Transcoder] HLS generation notice:', hlsErr);
      details.hls = 'failed';
    }

    // 5. Finalize Job
    const now = new Date().toISOString();
    db.run(
      `UPDATE processing_jobs 
       SET status = 'completed', progress = 100, current_step = 'Transcoding complete and ready', details = ?, updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(details), now, jobId]
    );

    db.run(
      `UPDATE videos SET processing_status = 'Ready', updated_at = ? WHERE id = ?`,
      [now, videoId]
    );

    console.log(`[Transcoder] Successfully finished processing video #${videoId}`);
  }

  private static probeMetadata(filePath: string): Promise<{ width: number; height: number; duration: number; bitrate: number }> {
    return new Promise((resolve, reject) => {
      // Run ffprobe (bundled binary, PATH fallback)
      const proc = spawn(FFPROBE_PATH, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration,bit_rate:format=duration,bit_rate',
        '-of', 'json',
        filePath,
      ]);

      let stdout = '';
      let settled = false;
      let forceKillTimer: NodeJS.Timeout | null = null;
      const timeout = setTimeout(() => {
        if (settled) return;
        console.error(`[Transcoder] ffprobe timed out after ${TRANSCODER_PROCESS_TIMEOUT_MS}ms.`);
        proc.kill('SIGTERM');
        forceKillTimer = setTimeout(() => {
          if (!settled) proc.kill('SIGKILL');
        }, PROCESS_KILL_GRACE_MS);
        reject(new Error(`ffprobe timed out after ${TRANSCODER_PROCESS_TIMEOUT_MS}ms`));
        settled = true;
      }, TRANSCODER_PROCESS_TIMEOUT_MS);

      const clearTimers = () => {
        clearTimeout(timeout);
        if (forceKillTimer) clearTimeout(forceKillTimer);
      };

      proc.stdout.on('data', (d) => (stdout += d.toString()));

      proc.on('close', (code) => {
        clearTimers();
        if (settled) return;
        settled = true;
        if (code === 0 && stdout) {
          try {
            const data = JSON.parse(stdout);
            const stream = data.streams?.[0] || {};
            const format = data.format || {};
            const width = parseInt(stream.width || '1280', 10);
            const height = parseInt(stream.height || '720', 10);
            const duration = parseFloat(stream.duration || format.duration || '0');
            const bitrate = parseInt(stream.bit_rate || format.bit_rate || '2000000', 10);
            resolve({ width, height, duration, bitrate });
            return;
          } catch {
            // fallback
          }
        }
        // Fallback default
        resolve({ width: 1280, height: 720, duration: 10, bitrate: 2000000 });
      });

      proc.on('error', (err) => {
        clearTimers();
        if (settled) return;
        settled = true;
        // Preserve the existing metadata fallback for unavailable binaries;
        // only an actual timeout is promoted to a failed processing job.
        console.warn('[Transcoder] ffprobe process error; using fallback metadata:', err.message);
        resolve({ width: 1280, height: 720, duration: 10, bitrate: 2000000 });
      });
    });
  }

  private static runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(FFMPEG_PATH, args);
      let stderr = '';
      let settled = false;
      let forceKillTimer: NodeJS.Timeout | null = null;
      const timeout = setTimeout(() => {
        if (settled) return;
        console.error(`[Transcoder] ffmpeg timed out after ${TRANSCODER_PROCESS_TIMEOUT_MS}ms.`);
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, PROCESS_KILL_GRACE_MS);
        settled = true;
        reject(new Error(`FFmpeg timed out after ${TRANSCODER_PROCESS_TIMEOUT_MS}ms`));
      }, TRANSCODER_PROCESS_TIMEOUT_MS);

      const clearTimers = () => {
        clearTimeout(timeout);
        if (forceKillTimer) clearTimeout(forceKillTimer);
      };

      child.stderr.on('data', (d) => (stderr += d.toString()));

      child.on('close', (code) => {
        clearTimers();
        if (settled) return;
        settled = true;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-300)}`));
        }
      });

      child.on('error', (err) => {
        clearTimers();
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }

  public static getJobStatus(videoId: number) {
    return db.queryOne<{
      id: number;
      video_id: number;
      status: string;
      progress: number;
      current_step: string;
      details: string;
      error_message: string | null;
      updated_at: string;
    }>(
      `SELECT * FROM processing_jobs WHERE video_id = ? ORDER BY id DESC LIMIT 1`,
      [videoId]
    );
  }
}
