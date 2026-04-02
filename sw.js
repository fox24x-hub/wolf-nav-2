const CACHE_NAME = 'wolf-v2'; // Увеличивайте версию при обновлении
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap'
];

// Установка: кешируем статику
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Кеширование статических ресурсов');
      return cache.addAll(STATIC_ASSETS);
    }).catch(err => {
      console.error('[SW] Ошибка кеширования:', err);
    })
  );
  self.skipWaiting(); // Сразу активируем новый SW
});

// Активация: чистим старые кеши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim(); // Берем контроль над страницами сразу
});

// Fetch: стратегия "Stale-While-Revalidate" для статики, "Network First" для API
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Для карты (tiles) - кешируем агрессивно
  if (request.url.includes('cartocdn.com') || request.url.includes('tile')) {
    event.respondWith(
      caches.match(request).then((response) => {
        return response || fetch(request).then((fetchResponse) => {
          // Кешируем тайлы карт для офлайн-просмотра
          const clone = fetchResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return fetchResponse;
        });
      })
    );
    return;
  }

  // Для статики - сначала кеш, потом сеть (быстрая загрузка)
  if (STATIC_ASSETS.some(url => request.url.includes(url))) {
    event.respondWith(
      caches.match(request).then((response) => {
        return response || fetch(request);
      })
    );
    return;
  }

  // Для всего остального - сначала сеть, потом кеш (актуальность важнее)
  event.respondWith(
    fetch(request).catch(() => {
      return caches.match(request);
    })
  );
});
