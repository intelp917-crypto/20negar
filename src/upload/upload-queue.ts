import type { Video } from '../types/index.ts';
import { TusFileUpload } from './tus-upload.ts';
import { nextRetryDelay } from './policy.ts';
import { clearCheckpoint, getCheckpoint, saveCheckpoint } from './checkpoint.ts';

/**
 * صف آپلود گروهی
 * -------------------------------------------------------------------
 * - هر فایل مستقل است: خطا/توقف یکی، بقیه را متوقف نمی‌کند.
 * - هم‌زمانی روی موبایل ۱ و روی دسکتاپ ۲ است (پیش‌فرض تهاجمی قبلی باعث
 *   اشباع اینترنت ضعیف و تایم‌اوت می‌شد).
 * - اگر همهٔ بایت‌ها رسیده باشند ولی ثبت ویدیو شکست بخورد، همان شناسهٔ آپلود
 *   ذخیره می‌شود و «تلاش دوباره» فقط ثبت را تکرار می‌کند (بدون ارسال مجدد).
 * - صفحهٔ نمایش روشن نگه داشته می‌شود (Screen Wake Lock) تا آپلود روی آیفون
 *   با قفل‌شدن خودکار صفحه قطع نشود.
 */

export type QueueStatus =
  | 'queued'
  | 'uploading'
  | 'paused'
  | 'retrying'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'canceled';

export interface QueueItem {
  key: string;
  file: File;
  name: string;
  size: number;
  title: string;
  status: QueueStatus;
  /** ۰..۱۰۰ بر اساس بایت‌های ارسال‌شده */
  progress: number;
  /** بایت‌های منتقل‌شده (برای نوار پیشرفت کل) */
  transferred: number;
  message?: string;
  error?: string;
  uploadId?: string;
  videoId?: number;
}

export interface UploadQueueFile {
  key: string;
  file: File;
  title: string;
}

export interface UploadQueueOptions {
  files: UploadQueueFile[];
  fields: Record<string, string>;
  concurrency: number;
  headers: Record<string, string>;
  onUpdate: (items: QueueItem[]) => void;
  finalize: (item: QueueItem, uploadId: string) => Promise<Video>;
  onVideo?: (video: Video) => void;
}

type FinalizeOutcome = 'done' | 'error' | 'missing';

const EMIT_INTERVAL_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorStatus(error: unknown): number {
  const value = Number((error as { status?: number } | null)?.status);
  return Number.isFinite(value) ? value : 0;
}

function errorMessage(error: unknown): string {
  const message = (error as { message?: string } | null)?.message;
  return String(message || 'ثبت ویدیو در سرور انجام نشد.');
}

/** فقط «نشست آپلود گم‌شده» ارزش آپلود دوباره دارد، نه خطای اعتبارسنجی پروژه/ناظر. */
function isLostUpload(error: unknown): boolean {
  const value = error as { status?: number; code?: string } | null;
  if (value?.code === 'upload_not_found') return true;
  return Number(value?.status) === 404;
}

export class UploadQueue {
  private readonly options: UploadQueueOptions;
  private readonly items: QueueItem[];
  private readonly engines = new Map<string, TusFileUpload>();

  private disposed = false;
  private finished = false;
  private resolveStart: (() => void) | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor(options: UploadQueueOptions) {
    this.options = options;
    this.items = options.files.map((entry) => ({
      key: entry.key,
      file: entry.file,
      name: entry.file.name,
      size: entry.file.size,
      title: entry.title,
      status: 'queued' as QueueStatus,
      progress: 0,
      transferred: 0,
    }));
  }

  getItems(): QueueItem[] {
    return this.items.map((item) => ({ ...item }));
  }

  start(): Promise<void> {
    this.emitNow();
    this.acquireWakeLock();

    return new Promise<void>((resolve) => {
      this.resolveStart = resolve;
      const workers = Math.max(1, Math.min(this.options.concurrency, this.items.length));
      let cursor = 0;

      const worker = async (): Promise<void> => {
        while (!this.disposed) {
          const index = cursor++;
          if (index >= this.items.length) return;
          const item = this.items[index];
          try {
            await this.process(item);
          } catch (err: any) {
            item.status = 'error';
            item.error = err?.message || 'آپلود این فایل با خطا متوقف شد.';
            this.emitNow();
          }
        }
      };

      void Promise.all(Array.from({ length: workers }, worker)).then(() => {
        this.maybeFinish();
      });
    });
  }

  pause(key: string): void {
    const engine = this.engines.get(key);
    if (engine) engine.pause();
    else {
      const item = this.items.find((entry) => entry.key === key);
      if (item && item.status === 'queued') {
        item.status = 'paused';
        this.emitNow();
      }
    }
  }

  resume(key: string): void {
    const item = this.items.find((entry) => entry.key === key);
    const engine = this.engines.get(key);
    if (item && engine) {
      item.status = 'uploading';
      this.emitNow();
      engine.resume();
      return;
    }
    if (item && (item.status === 'paused' || item.status === 'queued')) {
      item.status = 'queued';
      this.emitNow();
      void this.process(item).catch(() => undefined);
    }
  }

  /** تلاش دوباره: اگر فایل کامل رسیده باشد، فقط مرحلهٔ ثبت تکرار می‌شود. */
  retry(key: string): void {
    const item = this.items.find((entry) => entry.key === key);
    if (!item) return;
    item.error = undefined;
    item.message = undefined;
    if (item.uploadId) {
      item.status = 'finalizing';
      this.emitNow();
      void this.finalizeUpload(item).then((outcome) => {
        if (outcome === 'missing') {
          // نشست سمت سرور منقضی شده؛ ناچار باید دوباره ارسال شود.
          clearCheckpoint(item.file);
          item.uploadId = undefined;
          item.progress = 0;
          item.transferred = 0;
          item.status = 'queued';
          this.emitNow();
          void this.process(item).catch(() => undefined);
        }
      });
      return;
    }
    item.status = 'queued';
    item.progress = 0;
    item.transferred = 0;
    this.emitNow();
    void this.process(item).catch(() => undefined);
  }

  cancelAll(): void {
    for (const engine of this.engines.values()) engine.cancel();
    this.engines.clear();
    for (const item of this.items) {
      if (item.status === 'queued' || item.status === 'paused' || item.status === 'uploading' || item.status === 'retrying') {
        item.status = 'canceled';
        item.error = 'آپلود لغو شد.';
      }
    }
    this.releaseWakeLock();
    this.emitNow();
    this.maybeFinish();
  }

  /** بستن مودال/ترک صفحه: بدون حذف بایت‌های سرور، تا بعداً قابل ادامه باشد. */
  dispose(): void {
    this.disposed = true;
    for (const engine of this.engines.values()) engine.pause();
    this.engines.clear();
    this.releaseWakeLock();
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.finished = true;
    this.resolveStart?.();
  }

  private async process(item: QueueItem): Promise<void> {
    if (this.disposed || item.status === 'canceled') return;

    // ۱) شاید این فایل قبلاً کامل آپلود شده و فقط ثبت آن ناتمام مانده است.
    const checkpoint = getCheckpoint(item.file);
    if (checkpoint) {
      item.uploadId = checkpoint.uploadId;
      item.status = 'finalizing';
      item.message = 'فایل قبلاً آپلود شده است؛ فقط در حال ثبت در سامانه…';
      item.progress = 100;
      item.transferred = item.size;
      this.emitNow();
      const outcome = await this.finalizeUpload(item);
      if (outcome !== 'missing') return;
      clearCheckpoint(item.file);
      item.uploadId = undefined;
      item.progress = 0;
      item.transferred = 0;
    }

    // ۲) ارسال واقعی فایل.
    const uploaded = await this.uploadItem(item);
    if (!uploaded) return;

    // ۳) ثبت ویدیو؛ اگر سرور نشست را گم کرده باشد، یک‌بار از صفر تلاش می‌کنیم.
    const outcome = await this.finalizeUpload(item);
    if (outcome === 'missing') {
      clearCheckpoint(item.file);
      item.uploadId = undefined;
      item.progress = 0;
      item.transferred = 0;
      item.status = 'queued';
      this.emitNow();
      if (await this.uploadItem(item)) {
        const second = await this.finalizeUpload(item);
        if (second === 'missing') {
          item.status = 'error';
          item.error = 'فایل در سرور پیدا نشد؛ لطفاً دوباره تلاش کنید.';
          this.emitNow();
          this.maybeFinish();
        }
      }
    }
  }

  private uploadItem(item: QueueItem): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const engine = new TusFileUpload({
        file: item.file,
        headers: this.options.headers,
        metadata: {
          ...this.options.fields,
          title: item.title,
        },
        onPhase: (phase, detail) => {
          if (phase === 'paused') {
            item.status = 'paused';
            item.message = detail?.message;
            this.emitNow();
            // موتور در نقشه می‌ماند تا «ادامه» بتواند همان را از سر بگیرد.
            finish(false);
            return;
          }
          if (phase === 'retrying') {
            item.status = 'retrying';
            item.message = detail?.message;
            this.emitNow();
            return;
          }
          if (phase === 'uploading' || phase === 'connecting') {
            if (item.status !== 'uploading') {
              item.status = 'uploading';
              item.error = undefined;
            }
            this.emitThrottled();
          }
        },
        onProgress: (progress) => {
          const total = progress.bytesTotal || item.size;
          item.transferred = Math.min(item.size, progress.bytesSent);
          item.progress = total > 0 ? Math.min(99, Math.round((progress.bytesSent / total) * 100)) : 0;
          this.emitThrottled();
        },
        onSuccess: (uploadId) => {
          item.uploadId = uploadId;
          item.progress = 100;
          item.transferred = item.size;
          item.status = 'finalizing';
          item.message = undefined;
          item.error = undefined;
          saveCheckpoint(item.file, uploadId);
          this.engines.delete(item.key);
          this.emitNow();
          finish(true);
        },
        onError: (message) => {
          item.status = 'error';
          item.error = message;
          item.message = undefined;
          this.engines.delete(item.key);
          this.emitNow();
          finish(false);
        },
      });

      this.engines.set(item.key, engine);
      engine.start();
    });
  }

  private async finalizeUpload(item: QueueItem): Promise<FinalizeOutcome> {
    if (!item.uploadId) return 'missing';
    item.status = 'finalizing';
    item.error = undefined;
    this.emitNow();

    for (let attempt = 0; ; attempt += 1) {
      try {
        const video = await this.options.finalize(item, item.uploadId);
        item.videoId = video.id;
        item.status = 'done';
        item.progress = 100;
        item.transferred = item.size;
        item.message = undefined;
        item.error = undefined;
        clearCheckpoint(item.file);
        this.options.onVideo?.(video);
        this.emitNow();
        this.maybeFinish();
        return 'done';
      } catch (err: any) {
        const status = errorStatus(err);
        if (isLostUpload(err)) {
          // نشست آپلود سمت سرور موجود نیست (منقضی/حذف‌شده).
          this.emitNow();
          return 'missing';
        }
        const retryable = status === 0 || status === 408 || status === 429 || status >= 500;
        if (!retryable || attempt >= 4) {
          item.status = 'error';
          item.error = errorMessage(err);
          this.emitNow();
          this.maybeFinish();
          return 'error';
        }
        item.message = 'ثبت ویدیو انجام نشد؛ تلاش دوباره…';
        this.emitNow();
        await sleep(nextRetryDelay(attempt, { baseMs: 1500 }));
      }
    }
  }

  private maybeFinish(): void {
    if (this.finished || this.disposed) return;
    const busy = this.items.some(
      (item) => item.status === 'queued' || item.status === 'uploading' || item.status === 'retrying' || item.status === 'finalizing'
    );
    if (busy) return;
    this.finished = true;
    this.releaseWakeLock();
    this.emitNow();
    this.resolveStart?.();
  }

  private emitNow(): void {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    if (this.disposed) return;
    this.options.onUpdate(this.getItems());
  }

  private emitThrottled(): void {
    if (this.disposed || this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      if (this.disposed) return;
      this.options.onUpdate(this.getItems());
    }, EMIT_INTERVAL_MS);
  }

  private async acquireWakeLock(): Promise<void> {
    if (typeof navigator === 'undefined') return;
    const wakeLock = (navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<any> };
    }).wakeLock;
    if (!wakeLock?.request) return;
    try {
      this.wakeLock = await wakeLock.request('screen');
    } catch {
      this.wakeLock = null; // مرورگر اجازه نداد یا صفحه مخفی است
      return;
    }
    if (typeof document !== 'undefined' && !this.visibilityHandler) {
      this.visibilityHandler = () => {
        if (document.visibilityState === 'visible' && !this.finished && !this.disposed) {
          this.wakeLock = null;
          void this.acquireWakeLock();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  private releaseWakeLock(): void {
    try {
      void this.wakeLock?.release();
    } catch {}
    this.wakeLock = null;
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }
}
