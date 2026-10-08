import { createRequire } from 'module';

const requireBinary = createRequire(import.meta.url);

/**
 * مسیر باینری‌های ffmpeg/ffprobe:
 * اول از پکیج‌های npm بسته‌بندی‌شده (روی همه سیستم‌ها بدون نیاز به PATH) و
 * در صورت نبود، از PATH سیستم استفاده می‌شود.
 */
function resolveBinary(pkg: string, fallback: string): string {
  try {
    const mod = requireBinary(pkg) as { path?: string };
    if (mod && typeof mod.path === 'string' && mod.path) {
      return mod.path;
    }
  } catch {
    // بسته نصب نیست — به PATH رجوع می‌کنیم
  }
  return fallback;
}

export const FFMPEG_PATH = resolveBinary('@ffmpeg-installer/ffmpeg', 'ffmpeg');
export const FFPROBE_PATH = resolveBinary('@ffprobe-installer/ffprobe', 'ffprobe');
