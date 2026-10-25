import { api } from './api/client.ts';

/**
 * اعلان روی گوشی/دسکتاپ با Web Push.
 * -------------------------------------------------------------------
 * پیش‌نیازها:
 *  - HTTPS معتبر (یا localhost) چون Service Worker و Push فقط در Secure Context کار می‌کنند.
 *  - اجازه اعلان از سوی کاربر (باید با کلیک مستقیم گرفته شود).
 *  - روی iOS نسخه ۱۶.۴ به بعد، برنامه باید از «افزودن به صفحه اصلی» نصب شده باشد.
 *
 * صدای اعلان را سیستم‌عامل پخش می‌کند (silent=false در Service Worker)؛ علاوه بر
 * آن، اگر تب/برنامه باز باشد زنگ اختصاصی ۲۰نگار هم پخش می‌شود.
 */

export type PushState =
  | 'unsupported' // مرورگر/دستگاه از Web Push پشتیبانی نمی‌کند
  | 'insecure' // صفحه با HTTPS باز نشده است
  | 'denied' // کاربر یا مرورگر اجازه اعلان را مسدود کرده است
  | 'subscribed' // این دستگاه اشتراک فعال دارد
  | 'available' // پشتیبانی می‌شود اما این دستگاه هنوز مشترک نیست
  | 'unavailable'; // سرویس پوش سرور (کلید VAPID) در دسترس نیست

let chime: HTMLAudioElement | null = null;

/** پخش زنگ کوتاه درون‌برنامه‌ای (وقتی تب باز است). */
export function playNotificationChime(): void {
  try {
    if (!chime) {
      chime = new Audio('/sounds/notification.wav');
      chime.preload = 'auto';
      chime.volume = 0.7;
    }
    chime.currentTime = 0;
    const attempt = chime.play();
    if (attempt && typeof attempt.catch === 'function') attempt.catch(() => undefined);
  } catch {
    // پخش صدا اختیاری است؛ نبود آن نباید جریان اعلان را متوقف کند.
  }
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return buffer;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) {
    await navigator.serviceWorker.ready;
    return existing;
  }
  const registered = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return registered;
}

function subscriptionPayload(subscription: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const json = subscription.toJSON ? subscription.toJSON() : null;
  const endpoint = json?.endpoint || subscription.endpoint;
  const p256dh = json?.keys?.p256dh;
  const auth = json?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** وضعیت اعلان پوش برای این دستگاه/کاربر. */
export async function getPushState(): Promise<{ state: PushState; devices: number }> {
  if (!isPushSupported()) return { state: 'unsupported', devices: 0 };
  if (!window.isSecureContext) return { state: 'insecure', devices: 0 };

  let devices = 0;
  try {
    const status = await api.getPushStatus();
    devices = status.devices || 0;
    if (!status.available) return { state: 'unavailable', devices };
  } catch {
    // وضعیت سرور در دسترس نیست؛ بر اساس وضعیت مرورگر تصمیم می‌گیریم.
  }

  if (Notification.permission === 'denied') return { state: 'denied', devices };
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (subscription && Notification.permission === 'granted') return { state: 'subscribed', devices };
  } catch {
    // ignore
  }
  return { state: 'available', devices };
}

/**
 * فعال‌سازی اعلان روی این دستگاه.
 * باید از داخل یک کلیک کاربر صدا زده شود تا مرورگر اجازه اعلان بدهد.
 */
export async function enablePush(): Promise<{ state: PushState; devices: number }> {
  if (!isPushSupported()) return { state: 'unsupported', devices: 0 };
  if (!window.isSecureContext) return { state: 'insecure', devices: 0 };

  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { state: permission === 'denied' ? 'denied' : 'available', devices: 0 };
    }
  }

  const { publicKey } = await api.getPushPublicKey();
  if (!publicKey) throw new Error('کلید عمومی اعلان‌ها از سرور دریافت نشد.');

  const registration = await getRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(publicKey),
    });
  }

  const payload = subscriptionPayload(subscription);
  if (!payload) throw new Error('اطلاعات اشتراک اعلان ناقص است؛ لطفاً دوباره تلاش کنید.');
  const result = await api.subscribePush(payload);
  return { state: 'subscribed', devices: result.devices || 0 };
}

/** غیرفعال‌سازی اعلان روی این دستگاه. */
export async function disablePush(): Promise<{ state: PushState; devices: number }> {
  if (!isPushSupported()) return { state: 'unsupported', devices: 0 };
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (subscription) {
    try {
      await api.unsubscribePush(subscription.endpoint);
    } catch {
      // حتی اگر سرور پاسخ نداد، اشتراک مرورگر را لغو می‌کنیم.
    }
    await subscription.unsubscribe().catch(() => undefined);
  }
  const status = await getPushState();
  return { state: status.state, devices: status.devices };
}

/**
 * همگام‌سازی اشتراک موجود با حساب کاربر جاری.
 * اگر همان مرورگر با حساب دیگری وارد شده باشد، مالکیت اشتراک به کاربر فعلی
 * منتقل می‌شود تا اعلان به کاربر درست برسد.
 */
export async function syncPushSubscription(): Promise<void> {
  if (!isPushSupported() || !window.isSecureContext || Notification.permission !== 'granted') return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (!subscription) return;
    const payload = subscriptionPayload(subscription);
    if (payload) await api.subscribePush(payload);
  } catch {
    // اعلان پوش نباید ورود/بارگذاری برنامه را مختل کند.
  }
}

export async function sendTestPush(): Promise<number> {
  const result = await api.sendTestPush();
  return result.sent || 0;
}

/**
 * جداسازی دستگاه از حساب کاربر جاری هنگام خروج.
 * اشتراک مرورگر حفظ می‌شود تا با ورود بعدی دوباره به همان کاربر متصل شود،
 * اما تا آن زمان هیچ اعلانی از حساب قبلی روی این دستگاه نمایش داده نمی‌شود.
 */
export async function detachPushSubscription(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (subscription) await api.unsubscribePush(subscription.endpoint);
  } catch {
    // خروج کاربر نباید به دلیل خطای شبکه اعلان متوقف شود.
  }
}
