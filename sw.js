// ============================================================
// A1TV v2 — Service Worker (PWA)
// Caches static assets, logos, and API responses for offline use.
// ============================================================

var CACHE_NAME = 'a1tv-v2';
var STATIC_ASSETS = [
    '/', '/index.html',
    '/css/tokens.css', '/css/reset.css', '/css/layout.css', '/css/components.css',
    '/js/app.js', '/js/data.js', '/js/player.js', '/js/channels.js', '/js/nav.js', '/js/iptv-api.js'
];

// Install: cache static assets
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
        })
    );
    self.clients.claim();
});

// Fetch: cache-first for static, network-first for API
self.addEventListener('fetch', function(event) {
    var url = new URL(event.request.url);

    // API calls: network first, cache fallback
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then(function(response) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
                    return response;
                })
                .catch(function() { return caches.match(event.request); })
        );
        return;
    }

    // Logo images: cache first
    if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i) || url.hostname.includes('logo')) {
        event.respondWith(
            caches.match(event.request).then(function(cached) {
                return cached || fetch(event.request).then(function(response) {
                    var clone = response.clone();
                    caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); });
                    return response;
                });
            })
        );
        return;
    }

    // Static assets: cache first
    event.respondWith(
        caches.match(event.request).then(function(cached) {
            return cached || fetch(event.request);
        })
    );
});
