/**
 * سیاست‌های آپلود — تکه‌بندی، هم‌زمانی و تلاش مجدد
 * -------------------------------------------------------------------
 * این فایل عمداً «خالص» است (بدون DOM و بدون شبکه) تا هم در مرورگر و هم در
 * تست‌ها یکسان اجرا شود. اعداد اینجا بر اساس رفتار شبکه‌های موبایل انتخاب
 * شده‌اند: تکه‌های کوچک‌تر و یک اتصال هم‌زمان، به‌جای چند تکهٔ ۱۶ مگابایتی
 * موازی که روی اینترنت ضعیف باعث توقف و تایم‌اوت می‌شوند.
 */

export const CHUNK_SIZE_SLOW = 1 * 1024 * 1024; // ۱ مگابایت — 2G / حالت کم‌مصرف
export const CHUNK_SIZE_MOBILE = 4 * 1024 * 1024; // ۴ مگابایت — موبایل و آیفون
export const CHUNK_SIZE_DESKTOP = 16 * 1024 * 1024; // ۱۶ مگابایت — شبکهٔ محلی/سریع

export const CONCURRENCY_DESKTOP = 2;
export const CONCURRENCY_MOBILE = 1;

/** حداکثر تعداد تلاش مجدد در سطح موتور (پس از اتمام تلاش‌های سریع کتابخانه). */
export const MAX_UPLOAD_ATTEMPTS = 60;

export interface UploadNetworkHints {
  userAgent?: string;
  saveData?: boolean;
  effectiveType?: string;
}

function runtimeUserAgent(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
}

function runtimeConnection(): { saveData?: boolean; effectiveType?: string } {
  if (typeof navigator === 'undefined') return {};
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return connection || {};
}

/** آیفون/آیپد — شامل حالت دسکتاپ‌مانند iPadOS که UA آن Macintosh است. */
export function isAppleMobile(userAgent: string): boolean {
  if (/iPad|iPhone|iPod/i.test(userAgent)) return true;
  if (/Macintosh/i.test(userAgent) && typeof navigator !== 'undefined') {
    return Number((navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints || 0) > 1;
  }
  return false;
}

export function isMobileClient(hints: UploadNetworkHints = {}): boolean {
  const userAgent = hints.userAgent ?? runtimeUserAgent();
  if (/Android|iPad|iPhone|iPod|Mobile|Tablet|IEMobile|Opera Mini/i.test(userAgent)) return true;
  return isAppleMobile(userAgent);
}

/**
 * اندازهٔ تکه ثابت است (TUS اجازهٔ تغییر وسط کار را نمی‌دهد) و برای هر آپلود
 * یک‌بار انتخاب می‌شود.
 */
export function chooseChunkSize(hints: UploadNetworkHints = {}): number {
  const connection = runtimeConnection();
  const saveData = hints.saveData ?? connection.saveData;
  const effectiveType = hints.effectiveType ?? connection.effectiveType;

  if (saveData) return CHUNK_SIZE_SLOW;
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return CHUNK_SIZE_SLOW;
  if (effectiveType === '3g') return CHUNK_SIZE_MOBILE;
  if (isMobileClient(hints)) return CHUNK_SIZE_MOBILE;
  return CHUNK_SIZE_DESKTOP;
}

export function chooseConcurrency(hints: UploadNetworkHints = {}): number {
  return isMobileClient(hints) ? CONCURRENCY_MOBILE : CONCURRENCY_DESKTOP;
}

/**
 * برای آپلود، «خطای شبکه» و 5xx و 408/423/429 گذرا هستند؛ 4xxهای دیگر
 * (توکن نامعتبر، حجم غیرمجاز، فایل ردشده) با تکرار درست نمی‌شوند.
 */
export function isRetryableStatus(status: number): boolean {
  if (!Number.isFinite(status) || status <= 0) return true; // خطای شبکه بدون پاسخ
  if (status === 408 || status === 409 || status === 423 || status === 425 || status === 429) return true;
  return status >= 500;
}

/** تأخیر نمایی با jitter تا وقتی اینترنت برمی‌گردد، همهٔ کلاینت‌ها هم‌زمان حمله نکنند. */
export function nextRetryDelay(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {}
): number {
  const baseMs = options.baseMs ?? 1000;
  const maxMs = options.maxMs ?? 30_000;
  const random = options.random ?? Math.random;
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  const jittered = exponential * (0.8 + random() * 0.4);
  return Math.max(250, Math.min(maxMs, Math.round(jittered)));
}

export function describeUploadFailure(status: number, fallback?: string): string {
  if (status === 401 || status === 403) {
    return 'نشست شما منقضی شده یا اجازهٔ آپلود ندارید؛ یک‌بار از حساب خارج و دوباره وارد شوید.';
  }
  if (status === 413) return 'حجم فایل از سقف مجاز سرور بیشتر است.';
  if (status === 415) return 'نوع فایل توسط سرور پذیرفته نشد.';
  if (status === 429) return 'سرور موقتاً شلوغ است؛ چند لحظهٔ دیگر دوباره تلاش می‌شود.';
  if (status === 507) return 'فضای دیسک سرور کافی نیست؛ با مدیر سیستم تماس بگیرید.';
  if (status >= 500) return 'سرور موقتاً پاسخ نمی‌دهد؛ تلاش مجدد به‌صورت خودکار ادامه دارد.';
  return fallback || 'آپلود با خطا متوقف شد.';
}

/** پیام خطای شبکه/مرورگر (بدون پاسخ HTTP) به زبان کاربر. */
export function describeNetworkFailure(raw?: string): string {
  const message = String(raw || '');
  if (/notreadable|file.*not.*readable|err_upload_file_changed/i.test(message)) {
    return 'مرورگر دسترسی به فایل را از دست داد (مشکل شناخته‌شدهٔ آیفون). فایل را دوباره انتخاب کنید.';
  }
  if (/quota|storage/i.test(message)) return 'حافظهٔ مرورگر پر شده است؛ فضای دستگاه را آزاد کنید.';
  return 'اتصال قطع شد؛ آپلود از همان بایت متوقف‌شده ادامه پیدا می‌کند.';
}
