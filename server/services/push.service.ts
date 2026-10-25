import fs from 'node:fs';
import path from 'node:path';
import * as webpushImport from 'web-push';
import { DATA_DIR } from '../config.ts';
import { db } from '../db/database.ts';

/**
 * web-push یک پکیج CommonJS است؛ بسته به نحوه بارگذاری (tsx/ESM/CJS) ممکن است
 * توابع مستقیماً روی namespace یا زیر `default` قرار بگیرند. هر دو حالت را
 * پشتیبانی می‌کنیم تا اعلان روی همه محیط‌های اجرا فعال بماند.
 */
type WebPushApi = {
  generateVAPIDKeys(): { publicKey: string; privateKey: string };
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload?: string | Buffer | null,
    options?: { TTL?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' }
  ): Promise<unknown>;
};

const webpush: WebPushApi =
  (webpushImport as unknown as { default?: WebPushApi }).default ??
  (webpushImport as unknown as WebPushApi);

/**
 * Web Push (VAPID) — اعلان روی گوشی/دسکتاپ حتی وقتی برنامه بسته است.
 * -------------------------------------------------------------------
 * کلیدهای VAPID یک بار ساخته و در <data>/vapid-keys.json نگه‌داری می‌شوند.
 * اگر VAPID_PUBLIC_KEY و VAPID_PRIVATE_KEY در محیط تنظیم شده باشند، همان‌ها
 * استفاده می‌شوند (مناسب استقرار روی چند سرور با کلید ثابت).
 *
 * ارسال فقط به اشتراک‌های ثبت‌شده در جدول push_subscriptions انجام می‌شود؛
 * اشتراک‌های منقضی (404/410 از سرویس پوش) پاک می‌شوند.
 */

export const VAPID_KEYS_FILE = path.join(DATA_DIR, 'vapid-keys.json');
const DEFAULT_VAPID_SUBJECT = 'mailto:admin@20negar.local';

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  tag?: string;
}

export interface PushSendResult {
  sent: number;
  failed: number;
  removed: number;
}

/**
 * آدرس‌های خصوصی/محلی برای سرویس پوش پذیرفته نمی‌شوند تا این اندپوینت به
 * ابزاری برای درخواست به شبکه داخلی (SSRF) تبدیل نشود. سرویس‌های پوش واقعی
 * (FCM، Mozilla، Apple، Windows) همیشه روی HTTPS عمومی هستند.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.includes(':') && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // نام میزبان تک‌بخشی معمولاً یک سرویس داخلی است، نه سرویس پوش عمومی.
  if (!host.includes('.') && !host.includes(':')) return true;
  return false;
}

export function isValidSubscription(value: unknown): value is PushSubscriptionInput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PushSubscriptionInput>;
  if (typeof candidate.endpoint !== 'string') return false;
  const endpoint = candidate.endpoint.trim();
  if (endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || isPrivateHost(url.hostname)) return false;
  } catch {
    return false;
  }
  const keys = candidate.keys as { p256dh?: unknown; auth?: unknown } | undefined;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return false;
  return keys.p256dh.length > 0 && keys.p256dh.length <= 512 && keys.auth.length > 0 && keys.auth.length <= 512;
}

class PushService {
  private vapid: { publicKey: string; privateKey: string; subject: string } | null = null;
  private initialised = false;
  private available = false;

  /** بارگذاری/ساخت کلیدها؛ فقط یک بار در عمر پروسه اجرا می‌شود. */
  private init(): boolean {
    if (this.initialised) return this.available;
    this.initialised = true;

    try {
      const envPublic = (process.env.VAPID_PUBLIC_KEY || '').trim();
      const envPrivate = (process.env.VAPID_PRIVATE_KEY || '').trim();
      let publicKey = envPublic;
      let privateKey = envPrivate;

      if (!publicKey || !privateKey) {
        if (fs.existsSync(VAPID_KEYS_FILE)) {
          const stored = JSON.parse(fs.readFileSync(VAPID_KEYS_FILE, 'utf8')) as {
            publicKey?: string;
            privateKey?: string;
          };
          publicKey = publicKey || (stored.publicKey || '').trim();
          privateKey = privateKey || (stored.privateKey || '').trim();
        }
      }

      if (!publicKey || !privateKey) {
        const generated = webpush.generateVAPIDKeys();
        publicKey = generated.publicKey;
        privateKey = generated.privateKey;
        fs.writeFileSync(VAPID_KEYS_FILE, JSON.stringify(generated, null, 2), { encoding: 'utf8', mode: 0o600 });
        console.log(`[Push] VAPID keys generated and stored at ${VAPID_KEYS_FILE}`);
      }

      const subject = (process.env.VAPID_SUBJECT || '').trim() || DEFAULT_VAPID_SUBJECT;
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapid = { publicKey, privateKey, subject };
      this.available = true;
      return true;
    } catch (err: any) {
      console.error('[Push] Web Push is unavailable:', err?.message || err);
      this.available = false;
      return false;
    }
  }

  public getPublicKey(): string | null {
    return this.init() ? this.vapid!.publicKey : null;
  }

  public isAvailable(): boolean {
    return this.init();
  }

  public subscribe(userId: number, subscription: unknown, userAgent?: string | null): boolean {
    if (!isValidSubscription(subscription)) return false;
    const now = new Date().toISOString();
    const endpoint = subscription.endpoint.trim();
    db.run(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth_key = excluded.auth_key,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at`,
      [userId, endpoint, subscription.keys.p256dh, subscription.keys.auth, (userAgent || '').slice(0, 300) || null, now, now]
    );
    return true;
  }

  public unsubscribe(userId: number, endpoint: unknown): number {
    if (typeof endpoint !== 'string' || !endpoint.trim()) return 0;
    const result = db.run('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?', [userId, endpoint.trim()]);
    return result.changes;
  }

  /** تعداد دستگاه‌های ثبت‌شده برای این کاربر (برای نمایش وضعیت در UI). */
  public countForUser(userId: number): number {
    const row = db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );
    return Number(row?.count) || 0;
  }

  public async sendToUser(userId: number, message: PushMessage): Promise<PushSendResult> {
    const result: PushSendResult = { sent: 0, failed: 0, removed: 0 };
    if (!this.init()) return result;

    const subscriptions = db.query<StoredPushSubscription>(
      'SELECT endpoint, p256dh, auth_key as auth FROM push_subscriptions WHERE user_id = ?',
      [userId]
    );
    if (subscriptions.length === 0) return result;

    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url || '/',
      type: message.type || 'info',
      tag: message.tag || `20negar-${userId}-${Date.now()}`,
      timestamp: Date.now(),
    });

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
            payload,
            { TTL: 24 * 60 * 60, urgency: 'high' }
          );
          result.sent += 1;
        } catch (err: any) {
          const statusCode = Number(err?.statusCode) || 0;
          if (statusCode === 404 || statusCode === 410) {
            // دستگاه/اشتراک دیگر معتبر نیست.
            db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [subscription.endpoint]);
            result.removed += 1;
          } else {
            result.failed += 1;
            console.warn(`[Push] Delivery failed (${statusCode || 'network'}):`, err?.message || err);
          }
        }
      })
    );

    return result;
  }

  public async sendTest(userId: number): Promise<PushSendResult> {
    return this.sendToUser(userId, {
      title: '۲۰نگار — اعلان آزمایشی',
      body: 'اگر این اعلان را روی گوشی می‌بینید، اعلان‌های لحظه‌ای فعال هستند.',
      url: '/',
      type: 'success',
      tag: `20negar-test-${userId}`,
    });
  }
}

export const pushService = new PushService();
