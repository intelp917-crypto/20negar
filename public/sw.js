/**
 * 20negar service worker.
 *
 * Deliberately minimal: it makes the app installable ("Add to home screen"),
 * keeps the app shell available when the network is flaky, and receives Web
 * Push messages so notifications arrive while the app is closed.
 *
 * Rules:
 *  - Never cache API responses, media streams or uploads.
 *  - Always go to the network first for navigations.
 *  - Cache only the static shell icons/manifest so the installed app has an icon.
 */
const SHELL_CACHE = 'negar-shell-v1';
const SHELL_ASSETS = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const FALLBACK_ICON = '/icons/icon-192.png';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is ever cached.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only, and only the static shell assets. Everything else — the
  // API, uploads, signed media URLs and HLS segments — goes straight to the
  // network so no stale or partial media is ever served.
  if (url.origin !== self.location.origin) return;
  if (!SHELL_ASSETS.includes(url.pathname)) return;

  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

/**
 * اعلان لحظه‌ای (Web Push) — حتی وقتی برنامه بسته است.
 * صدا با `silent: false` به سیستم‌عامل سپرده می‌شود؛ اندروید صدای کانال اعلان
 * برنامه و iOS صدای پیش‌فرض اعلان‌ها را پخش می‌کند.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    try {
      payload = { body: event.data ? event.data.text() : '' };
    } catch {
      payload = {};
    }
  }

  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : '۲۰نگار';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: FALLBACK_ICON,
    badge: FALLBACK_ICON,
    dir: 'rtl',
    lang: 'fa-IR',
    tag: typeof payload.tag === 'string' && payload.tag ? payload.tag : '20negar-notification',
    renotify: true,
    silent: false,
    requireInteraction: false,
    vibrate: [140, 70, 140],
    timestamp: Number(payload.timestamp) || Date.now(),
    data: {
      url: typeof payload.url === 'string' && payload.url ? payload.url : '/',
      type: payload.type || 'info',
    },
    actions: [{ action: 'open', title: 'باز کردن ۲۰نگار' }],
  };

  event.waitUntil(
    (async () => {
      try {
        await self.registration.showNotification(title, options);
      } catch (err) {
        // اگر پلتفرم گزینه‌ای را نپذیرد، با حداقل گزینه‌ها دوباره تلاش می‌کنیم.
        await self.registration.showNotification(title, {
          body: options.body,
          icon: FALLBACK_ICON,
          dir: 'rtl',
          lang: 'fa-IR',
          data: options.data,
        });
      }

      // تب‌های باز برنامه هم مطلع می‌شوند تا زنگ درون‌برنامه‌ای پخش و لیست
      // اعلان‌ها بدون انتظار برای polling بعدی تازه شود.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({
          type: '20negar:push-received',
          payload: { title, body: options.body, type: options.data.type, url: options.data.url },
        });
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          client.postMessage({ type: '20negar:notification-opened', url: targetUrl });
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })()
  );
});
