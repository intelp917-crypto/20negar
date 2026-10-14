/**
 * 20negar service worker.
 *
 * Deliberately minimal: it makes the app installable ("Add to home screen")
 * and keeps the app shell available when the network is flaky.
 *
 * Rules:
 *  - Never cache API responses, media streams or uploads.
 *  - Always go to the network first for navigations.
 *  - Cache only the static shell icons/manifest so the installed app has an icon.
 */
const SHELL_CACHE = 'negar-shell-v1';
const SHELL_ASSETS = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

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
