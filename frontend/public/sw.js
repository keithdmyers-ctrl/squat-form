const APP_CACHE = 'squat-form-app-v1';
const WASM_CACHE = 'squat-form-wasm-v1';
const MODELS_CACHE = 'squat-form-models-v1';

// All valid cache names for this version
const VALID_CACHES = [APP_CACHE, WASM_CACHE, MODELS_CACHE];

// App shell resources to precache
const APP_SHELL = [
  './',
  './index.html',
];

// URL patterns for WASM files
const WASM_PATTERNS = [
  '/mediapipe/wasm/',
  'cdn.jsdelivr.net/npm/@mediapipe/tasks-vision',
];

// URL patterns for model files
const MODEL_PATTERNS = [
  '/mediapipe/models/',
  'storage.googleapis.com/mediapipe-models',
];

/** Determine which cache to use based on the request URL. */
function getCacheForUrl(url) {
  if (MODEL_PATTERNS.some((p) => url.includes(p))) {
    return MODELS_CACHE;
  }
  if (WASM_PATTERNS.some((p) => url.includes(p))) {
    return WASM_CACHE;
  }
  return null; // app shell handled separately
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !VALID_CACHES.includes(key))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const specialCache = getCacheForUrl(event.request.url);

  // WASM and model files: cache-first (large, immutable)
  if (specialCache) {
    event.respondWith(
      caches.open(specialCache).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // App shell: stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(APP_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request)
            .then((response) => {
              if (response.ok) {
                cache.put(event.request, response.clone());
              }
              return response;
            })
            .catch(() => cached);

          return cached || fetchPromise;
        })
      )
    );
    return;
  }
});
