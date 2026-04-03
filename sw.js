const SW_VERSION = 'wolf-v3';
const APP_SHELL_CACHE = `${SW_VERSION}-app-shell`;
const RUNTIME_CACHE = `${SW_VERSION}-runtime`;
const TILE_CACHE = `${SW_VERSION}-tiles`;
const CDN_CACHE = `${SW_VERSION}-cdn`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css',
  'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap'
];

const MAX_TILE_ENTRIES = 120;
const MAX_RUNTIME_ENTRIES = 60;
const MAX_CDN_ENTRIES = 40;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);

      await Promise.allSettled(
        APP_SHELL.map(async (url) => {
          try {
            await cache.add(url);
          } catch (err) {
            console.warn('[SW] Не удалось закешировать:', url, err);
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => ![
            APP_SHELL_CACHE,
            RUNTIME_CACHE,
            TILE_CACHE,
            CDN_CACHE
          ].includes(key))
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (!url.protocol.startsWith('http')) return;

  if (request.mode === 'navigate' || isHtmlRequest(request)) {
    event.respondWith(networkFirstForHtml(request));
    return;
  }

  if (isTileRequest(url)) {
    event.respondWith(cacheFirst(request, TILE_CACHE, MAX_TILE_ENTRIES));
    return;
  }

  if (isCdnRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE, MAX_CDN_ENTRIES));
    return;
  }

  if (isLocalAsset(url)) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE, MAX_RUNTIME_ENTRIES));
    return;
  }

  event.respondWith(networkFirst(request, RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
});

function isHtmlRequest(request) {
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

function isTileRequest(url) {
  return (
    url.hostname.includes('cartocdn.com') ||
    url.hostname.includes('tile.openstreetmap.org') ||
    url.pathname.includes('/tile/') ||
    /\/\d+\/\d+\/\d+\.(png|jpg|jpeg|webp)$/.test(url.pathname)
  );
}

function isCdnRequest(url) {
  return (
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com')
  );
}

function isLocalAsset(url) {
  return url.origin === self.location.origin;
}

async function networkFirstForHtml(request) {
  const cache = await caches.open(APP_SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cachedPage =
      (await cache.match(request)) ||
      (await cache.match('./')) ||
      (await cache.match('./index.html'));

    if (cachedPage) return cachedPage;

    return new Response(
      `<!doctype html>
      <html lang="ru">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Офлайн</title>
          <style>
            body {
              font-family: Inter, Arial, sans-serif;
              margin: 0;
              padding: 24px;
              background: #f7f6f2;
              color: #171717;
            }
            .box {
              max-width: 640px;
              margin: 40px auto;
              background: white;
              border: 1px solid #e3ded4;
              border-radius: 16px;
              padding: 20px;
              box-shadow: 0 8px 24px rgba(0,0,0,.08);
            }
            h1 { margin-top: 0; font-size: 22px; }
            p { line-height: 1.5; color: #555; }
          </style>
        </head>
        <body>
          <div class="box">
            <h1>Нет соединения</h1>
            <p>Приложение не смогло загрузить свежую страницу из сети.</p>
            <p>Если основная страница уже открывалась раньше, попробуй вернуться назад или открыть сайт повторно.</p>
          </div>
        </body>
      </html>`,
      {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 503,
        statusText: 'Offline'
      }
    );
  }
}

async function networkFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
      await trimCache(cacheName, maxEntries);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    await cache.put(request, response.clone());
    await trimCache(cacheName, maxEntries);
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) {
        await cache.put(request, response.clone());
        await trimCache(cacheName, maxEntries);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  return new Response('', { status: 504, statusText: 'Gateway Timeout' });
}

function isCacheable(response) {
  return response && response.ok;
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  if (keys.length <= maxEntries) return;

  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}
