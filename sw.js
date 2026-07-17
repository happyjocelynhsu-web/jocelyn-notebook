const CACHE_NAME = 'jocelyn-notebook-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './book.js',
  './canvas.js',
  './text.js',
  './db.js',
  './manifest.json',
  './cute_spring_cover_front.jpg',
  './cute_spring_cover_back.jpg',
  './spring_cover_front.jpg',
  './spring_cover_back.jpg',
  './landmark_cover_front.jpg',
  './landmark_cover_back.jpg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Always fetch GitHub API calls directly from network
  if (e.request.url.includes('api.github.com')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(e.request).then((networkResponse) => {
        if (e.request.method === 'GET' && networkResponse.status === 200 && !e.request.url.includes('?edit=')) {
          const cacheCopy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, cacheCopy);
          });
        }
        return networkResponse;
      }).catch(() => {
        return caches.match('./index.html');
      });
    })
  );
});
