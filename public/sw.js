const CACHE_NAME = 'potato-money-v5';
const ASSETS = [
  '/',
  '/manifest.json',
];

self.addEventListener('install', e => {
  // IMPORTANT: Use cache: 'no-store' to bypass browser HTTP cache
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url =>
        fetch(new Request(url, { cache: 'no-store' })).then(r => cache.put(url, r))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: network only, bypass all caches
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(new Request(e.request, { cache: 'no-store' })));
    return;
  }

  // CSS/JS/HTML: ALWAYS fetch from network (bypass HTTP cache), fall back to SW cache
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') || url.pathname === '/') {
    e.respondWith(
      fetch(new Request(e.request, { cache: 'no-store' }))
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Images/icons: cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    })
  );
});
