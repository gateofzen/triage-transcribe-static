/* ============================================================
 * Service Worker - 転記専用版
 * 静的アセットのみキャッシュ。患者データは一切扱わない。
 * ============================================================ */
const CACHE_NAME = 'triage-transcribe-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './parse.js',
  './render.js',
  './emoji.js',
  './manifest.json',
  './favicon.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
  // 新版インストール直後にアクティブ化準備完了
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 同一オリジンの静的アセットだけキャッシュ利用（CDNは常に新鮮に）
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
  );
});
