import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { db } from '../db/database.ts';
import { fileStorage } from '../storage/local.storage.ts';
import { PRIVATE_THUMBNAILS_DIR, PRIVATE_VIDEOS_DIR, PRIVATE_HLS_DIR } from '../config.ts';

export interface QualityTarget {
  name: '1080p' | '720p' | '480p' | '360p';
  width: number;
  height: number;
  videoBitrate: string;
  audioBitrate: string;
  crf: string;
}

export const QUALITY_PRESETS: QualityTarget[] = [
  { name: '1080p', width: 1920, height: 1080, videoBitrate: '4500k', audioBitrate: '192k', crf: '22' },
  { name: '720p', width: 1280, height: 720, videoBitrate: '2500k', audioBitrate: '128k', crf: '24' },
  { name: '480p', width: 854, height: 480, videoBitrate: '1200k', audioBitrate: '96k', crf: '26' },
  { name: '360p', width: 640, height: 360, videoBitrate: '800k', audioBitrate: '64k', crf: '28' },
];

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
    updateJob('Generating high-resolution thumbnail', 15);
    const thumbFilename = `thumb_v${videoId}_${Date.now()}.jpg`;
    const thumbFullPath = path.join(PRIVATE_THUMBNAILS_DIR, thumbFilename);
    const thumbKey = `thumbnails/${thumbFilename}`;

    try {
      // Seek to 10% of duration or 1s
      const seekSec = Math.min(Math.max(1, meta.duration * 0.1), 5).toFixed(2);
      await this.runFfmpeg([
        '-y',
        '-ss', seekSec,
        '-i', originalFullPath,
        '-frames:v', '1',
        '-q:v', '2',
        '-vf', 'scale=640:-1',
        thumbFullPath,
      ]);
      details.thumbnail = 'completed';
      db.run(`UPDATE videos SET thumbnail_path = ? WHERE id = ?`, [thumbKey, videoId]);
    } catch (thumbErr) {
      console.warn('[Transcoder] Thumbnail extraction error, trying fallback at 0s:', thumbErr);
      try {
        await this.runFfmpeg([
          '-y',
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

      try {
        // Transcode to MP4 with scale keeping aspect ratio
        await this.runFfmpeg([
          '-y',
          '-i', originalFullPath,
          '-vf', `scale='min(${target.width},iw)':-2`,
          '-c:v', 'libx264',
          '-crf', target.crf,
          '-preset', 'veryfast',
          '-c:a', 'aac',
          '-b:a', target.audioBitrate,
          '-movflags', '+faststart',
          targetFullPath,
        ]);

        const stat = fs.statSync(targetFullPath);
        const now = new Date().toISOString();

        // Check if quality record exists
        const existingQuality = db.queryOne(
          `SELECT id FROM video_qualities WHERE video_id = ? AND quality = ?`,
          [videoId, target.name]
        );
        if (existingQuality) {
          db.run(
            `UPDATE video_qualities SET file_path = ?, file_size = ?, width = ?, height = ? WHERE id = ?`,
            [targetKey, stat.size, target.width, target.height, existingQuality.id]
          );
        } else {
          db.run(
            `INSERT INTO video_qualities (video_id, quality, file_path, width, height, bitrate, file_size, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [videoId, target.name, targetKey, target.width, target.height, parseInt(target.videoBitrate, 10) * 1000, stat.size, now]
          );
        }

        details[target.name] = 'completed';
      } catch (err: any) {
        console.error(`[Transcoder] Failed to encode ${target.name}:`, err);
        details[target.name] = 'failed';
      }

      currentProgress += progressPerResolution;
      updateJob(`Completed ${target.name} rendition`, currentProgress);
    }

    // Mark any skipped resolutions
    for (const preset of QUALITY_PRESETS) {
      if (!details[preset.name]) {
        details[preset.name] = 'skipped';
      }
    }

    // 4. Generate HLS Adaptive Streaming
    updateJob('Generating HLS adaptive streaming segments', 85);
    details.hls = 'processing';
    const videoHlsDir = path.join(PRIVATE_HLS_DIR, `video_${videoId}`);
    if (!fs.existsSync(videoHlsDir)) {
      fs.mkdirSync(videoHlsDir, { recursive: true });
    }

    try {
      const hlsMasterPath = path.join(videoHlsDir, 'master.m3u8');
      const hlsSegmentPath = path.join(videoHlsDir, 'segment_%03d.ts');

      await this.runFfmpeg([
        '-y',
        '-i', originalFullPath,
        '-c:v', 'libx264',
        '-crf', '24',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-hls_time', '4',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', hlsSegmentPath,
        hlsMasterPath,
      ]);

      details.hls = 'completed';
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
    return new Promise((resolve) => {
      // Run ffprobe if available or ffmpeg info
      const proc = spawn('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,duration,bit_rate:format=duration,bit_rate',
        '-of', 'json',
        filePath,
      ]);

      let stdout = '';
      proc.stdout.on('data', (d) => (stdout += d.toString()));

      proc.on('close', (code) => {
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

      proc.on('error', () => {
        resolve({ width: 1280, height: 720, duration: 10, bitrate: 2000000 });
      });
    });
  }

  private static runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('ffmpeg', args);
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-300)}`));
        }
      });

      child.on('error', (err) => {
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
