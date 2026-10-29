import { Upload } from 'tus-js-client';
import {
  MAX_UPLOAD_ATTEMPTS,
  chooseChunkSize,
  describeNetworkFailure,
  describeUploadFailure,
  isMobileClient,
  isRetryableStatus,
  nextRetryDelay,
} from './policy.ts';

/**
 * موتور آپلود یک فایل (tus-js-client + محافظت‌های شبکهٔ ضعیف)
 * -------------------------------------------------------------------
 * چرا این لایه لازم است؟
 *  - «گیر کردن روی درصد ثابت» معمولاً یعنی XHR در iOS/Safari پس از قفل‌شدن
 *    صفحه یا تغییر شبکه معلق می‌ماند و هیچ خطایی هم نمی‌دهد؛ پس تلاش مجدد
 *    کتابخانه هرگز اجرا نمی‌شود. اینجا یک نگهبان، سکوت طولانی را تشخیص
 *    می‌دهد، درخواست را قطع و از offset سرور ادامه می‌دهد.
 *  - روی اینترنت ایران، قطع/وصل پشت‌سرهم عادی است. به‌جای چند تلاش محدود،
 *    تا وقتی کاربر لغو نکرده با تأخیر نمایی و jitter تلاش می‌شود.
 *  - قطعی اینترنت باعث «خطای دائمی» نمی‌شود: منتظر رویداد online می‌مانیم.
 */

export type UploadPhase = 'connecting' | 'uploading' | 'retrying' | 'paused' | 'completed' | 'failed';

export interface UploadPhaseDetail {
  message?: string;
  status?: number;
  retryInMs?: number;
}

export interface UploadProgress {
  bytesSent: number;
  bytesAccepted: number;
  bytesTotal: number;
}

export interface TusUploadHandlers {
  onPhase?: (phase: UploadPhase, detail?: UploadPhaseDetail) => void;
  onProgress?: (progress: UploadProgress) => void;
  onSuccess?: (uploadId: string) => void;
  onError?: (message: string, status: number) => void;
}

export interface TusUploadOptions extends TusUploadHandlers {
  file: File;
  metadata?: Record<string, string>;
  headers?: Record<string, string>;
  endpoint?: string;
  chunkSize?: number;
  /** مدت سکوت مجاز (بدون بایت جدید) قبل از قطع و ادامهٔ خودکار. */
  stallTimeoutMs?: number;
  maxAttempts?: number;
}

const FAST_RETRY_DELAYS = [0, 1000, 2500, 5000];

function statusFromError(error: any): number {
  try {
    const status = error?.originalResponse?.getStatus?.();
    return Number.isFinite(Number(status)) ? Number(status) : 0;
  } catch {
    return 0;
  }
}

function uploadIdFromUrl(url: string | null | undefined): string {
  return String(url || '').split('?')[0].split('/').filter(Boolean).pop() || '';
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export class TusFileUpload {
  private readonly options: TusUploadOptions;
  private upload: Upload | null = null;
  private phase: UploadPhase = 'connecting';
  private paused = false;
  private cancelled = false;

  private bytesSent = 0;
  private bytesAccepted = 0;
  private bytesTotal = 0;

  private attempt = 0;
  private stalls = 0;
  private lastStallBytes = -1;
  private lastActivity = Date.now();
  private restarting = false;

  private watchdog: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineWatchHandler: (() => void) | null = null;
  private onlineWaitHandler: (() => void) | null = null;
  private visibilityHandler: (() => void) | null = null;

  constructor(options: TusUploadOptions) {
    this.options = options;
    this.bytesTotal = options.file?.size || 0;
    this.lastActivity = Date.now();
  }

  get currentPhase(): UploadPhase {
    return this.phase;
  }

  start(): void {
    if (this.upload) return;
    this.attachGlobalListeners();

    const file = this.options.file;
    if (!file || !file.size) {
      this.fail('فایل انتخاب‌شده خالی است.');
      return;
    }

    const mobile = isMobileClient();
    const chunkSize = this.options.chunkSize ?? chooseChunkSize();
    const stallTimeoutMs = this.options.stallTimeoutMs ?? (mobile ? 25_000 : 40_000);

    this.upload = new Upload(file, {
      endpoint: this.options.endpoint || '/api/tus',
      chunkSize,
      // تلاش‌های سریع را خود کتابخانه انجام می‌دهد؛ تلاش‌های طولانی‌مدت را موتور.
      retryDelays: FAST_RETRY_DELAYS,
      onShouldRetry: (error: any) => isRetryableStatus(statusFromError(error)),
      // تکهٔ اول همراه POST نمی‌رود: روی اینترنت ضعیف، POST سنگین بیشتر
      // شکست می‌خورد و آپلودهای تکراری روی سرور می‌سازد.
      uploadDataDuringCreation: false,
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        filename: file.name || 'video',
        filetype: file.type || 'application/octet-stream',
        ...(this.options.metadata || {}),
      },
      headers: this.options.headers || {},
      onProgress: (bytesSent: number, bytesTotal: number) => {
        this.lastActivity = Date.now();
        this.bytesSent = bytesSent;
        this.bytesTotal = bytesTotal || this.bytesTotal;
        if (this.phase === 'connecting') this.setPhase('uploading');
        this.emitProgress();
      },
      onChunkComplete: (_chunkSize: number, bytesAccepted: number, bytesTotal: number) => {
        this.lastActivity = Date.now();
        this.bytesAccepted = bytesAccepted;
        this.bytesTotal = bytesTotal || this.bytesTotal;
        this.attempt = 0; // پیشرفت واقعی ⇒ شمارندهٔ تلاش صفر می‌شود
        this.stalls = 0;
        this.emitProgress();
      },
      onSuccess: () => {
        this.clearTimers();
        this.detachGlobalListeners();
        this.bytesAccepted = this.bytesTotal;
        this.bytesSent = this.bytesTotal;
        this.emitProgress();
        this.setPhase('completed');
        const uploadId = uploadIdFromUrl(this.upload?.url);
        if (!uploadId) {
          this.fail('شناسهٔ آپلود از سرور دریافت نشد؛ لطفاً دوباره تلاش کنید.');
          return;
        }
        this.options.onSuccess?.(uploadId);
      },
      onError: (error: any) => {
        if (this.cancelled || this.paused) return;
        this.handleFailure(error);
      },
    });

    this.setPhase('connecting');
    this.startWatchdog(stallTimeoutMs);
    this.upload.start();
  }

  pause(): void {
    if (this.paused || this.cancelled) return;
    this.paused = true;
    this.clearTimers();
    try {
      this.upload?.abort();
    } catch {}
    this.setPhase('paused', { message: 'آپلود متوقف شد؛ هر زمان بخواهید ادامه دهید.' });
  }

  resume(): void {
    if (!this.paused || this.cancelled || !this.upload) return;
    this.paused = false;
    this.lastActivity = Date.now();
    this.startWatchdog(this.options.stallTimeoutMs ?? (isMobileClient() ? 25_000 : 40_000));
    this.setPhase('connecting');
    this.upload.start();
  }

  /** لغو کامل: بایت‌های نیمه‌کاره در سرور هم آزاد می‌شوند (termination). */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.paused = false;
    this.clearTimers();
    this.detachGlobalListeners();
    try {
      Promise.resolve(this.upload?.abort(true)).catch(() => undefined);
    } catch {}
    this.setPhase('failed', { message: 'آپلود لغو شد.' });
  }

  private emitProgress(): void {
    this.options.onProgress?.({
      bytesSent: this.bytesSent,
      bytesAccepted: this.bytesAccepted,
      bytesTotal: this.bytesTotal,
    });
  }

  private setPhase(phase: UploadPhase, detail?: UploadPhaseDetail): void {
    this.phase = phase;
    this.options.onPhase?.(phase, detail);
  }

  private fail(message: string): void {
    this.clearTimers();
    this.detachGlobalListeners();
    this.setPhase('failed', { message });
    this.options.onError?.(message, 0);
  }

  private handleFailure(error: any): void {
    const status = statusFromError(error);
    const rawMessage = String(error?.message || '');
    if (!isRetryableStatus(status)) {
      this.clearTimers();
      this.detachGlobalListeners();
      const message = describeUploadFailure(status, rawMessage || undefined);
      this.setPhase('failed', { message, status });
      this.options.onError?.(message, status);
      return;
    }

    if (this.attempt >= (this.options.maxAttempts ?? MAX_UPLOAD_ATTEMPTS)) {
      this.fail('پس از تلاش‌های متعدد، اتصال به سرور برقرار نشد. فایل روی سرور ذخیره شده است؛ بعداً «تلاش دوباره» را بزنید.');
      return;
    }

    const message = status
      ? describeUploadFailure(status, rawMessage || undefined)
      : describeNetworkFailure(rawMessage);

    if (isOffline()) {
      this.setPhase('retrying', { message, status });
      this.waitForOnline().then(() => {
        if (this.cancelled || this.paused) return;
        this.restart();
      });
      return;
    }

    const delay = nextRetryDelay(this.attempt++);
    this.setPhase('retrying', { message, status, retryInMs: delay });
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.cancelled || this.paused) return;
      this.restart();
    }, delay);
  }

  /** ادامه از offset سرور؛ هم برای تلاش مجدد و هم برای XHR معلق استفاده می‌شود. */
  private restart(): void {
    const upload = this.upload;
    if (!upload || this.cancelled || this.paused) return;
    // رویداد online و تایمر تلاش مجدد می‌توانند هم‌زمان برسند؛ یک شروع کافی است.
    if (this.restarting) return;
    this.restarting = true;
    this.lastActivity = Date.now();
    this.setPhase('connecting');

    const resume = () => {
      this.restarting = false;
      if (this.cancelled || this.paused) return;
      upload.start();
    };
    try {
      upload.abort().then(resume).catch(resume);
    } catch {
      resume();
    }
  }

  private waitForOnline(): Promise<void> {
    if (typeof window === 'undefined' || !isOffline()) return Promise.resolve();
    return new Promise((resolve) => {
      const handler = () => {
        window.removeEventListener('online', handler);
        if (this.onlineWaitHandler === handler) this.onlineWaitHandler = null;
        resolve();
      };
      this.onlineWaitHandler = handler;
      window.addEventListener('online', handler);
    });
  }

  private startWatchdog(stallTimeoutMs: number): void {
    this.clearWatchdog();
    this.watchdog = setInterval(() => this.checkStall(stallTimeoutMs), 4000);
  }

  private checkStall(stallTimeoutMs: number): void {
    // «connecting» را هم می‌پوشاند: درخواست HEAD روی شبکهٔ ضعیف می‌تواند
    // بی‌پاسخ بماند و هیچ رویداد خطایی هم تولید نکند. در فاصلهٔ انتظارِ تلاش
    // مجدد هیچ بررسی‌ای انجام نمی‌شود تا وقفهٔ عمدی (backoff) خراب نشود.
    if ((this.phase !== 'uploading' && this.phase !== 'connecting') || this.paused || this.cancelled) {
      return;
    }
    // مرورگر صفحه را معلق کرده (iOS بعد از قفل شدن)؛ تایمرها هم متوقف‌اند.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (Date.now() - this.lastActivity < stallTimeoutMs) return;

    if (this.bytesAccepted > this.lastStallBytes) {
      this.lastStallBytes = this.bytesAccepted;
      this.stalls = 0;
    }
    this.stalls += 1;

    if (this.stalls > 12) {
      this.fail('اتصال به سرور پاسخ نمی‌دهد. آپلود متوقف شد؛ با «تلاش دوباره» از همان بایت ادامه می‌دهد.');
      return;
    }

    this.setPhase('retrying', {
      message: 'اتصال کند یا قطع شده است؛ ادامهٔ خودکار از همان بایت…',
    });
    this.restart();
  }

  private attachGlobalListeners(): void {
    if (typeof window === 'undefined') return;
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.checkStall(this.options.stallTimeoutMs ?? (isMobileClient() ? 25_000 : 40_000));
      }
    };
    this.visibilityHandler = onVisible;
    document.addEventListener('visibilitychange', onVisible);
    const onOnline = () => {
      if (this.cancelled || this.paused) return;
      if (this.phase === 'retrying' || this.phase === 'connecting') {
        this.clearRetryTimer();
        this.restart();
      }
    };
    this.onlineWatchHandler = onOnline;
    window.addEventListener('online', onOnline);
  }

  private detachGlobalListeners(): void {
    if (typeof window === 'undefined') return;
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.onlineWatchHandler) {
      window.removeEventListener('online', this.onlineWatchHandler);
      this.onlineWatchHandler = null;
    }
    if (this.onlineWaitHandler) {
      window.removeEventListener('online', this.onlineWaitHandler);
      this.onlineWaitHandler = null;
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private clearWatchdog(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }

  private clearTimers(): void {
    this.clearRetryTimer();
    this.clearWatchdog();
  }
}

/**
 * پوشش Promise برای مسیرهای تک‌فایلی (نسخهٔ جدید/جایگزینی) که فقط درصد
 * پیشرفت و شناسهٔ آپلود را لازم دارند.
 */
export function uploadFileWithTus(
  file: File,
  options: {
    metadata?: Record<string, string>;
    headers?: Record<string, string>;
    onProgress?: (percent: number) => void;
  } = {}
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const engine = new TusFileUpload({
      file,
      metadata: options.metadata,
      headers: options.headers,
      onProgress: (progress) => {
        if (!options.onProgress || progress.bytesTotal <= 0) return;
        options.onProgress(Math.min(100, Math.round((progress.bytesSent / progress.bytesTotal) * 100)));
      },
      onSuccess: (uploadId) => resolve(uploadId),
      onError: (message) => reject(new Error(message)),
    });
    engine.start();
  });
}
