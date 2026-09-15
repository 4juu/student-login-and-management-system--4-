/* ============================================================
 * Service Worker — تحديث فوري للنسخة المنشورة + العمل دون اتصال
 * - skipWaiting + clientsClaim: أي نسخة جديدة تسيطر فوراً
 * - التنقل (index.html): network-first → دائماً أحدث إصدار
 * - أصول assets/ المبنيّة (أسماء hashed ثابتة): cache-first
 * - بقية الملفات الثابتة: stale-while-revalidate
 * - عند التفعيل: نمسح كل كاشات الإصدارات القديمة (يكسر SW عالق)
 * ============================================================ */

const VERSION = 'v2026.09.15.1';
const SHELL_CACHE = `att-shell-${VERSION}`;
const ASSET_CACHE = `att-assets-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(() => caches.match('/index.html'))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // التنقل بين الصفحات → يجلب الأحدث من الشبكة، والكاش فقط عند انقطاع الاتصال
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match('/index.html').then((r) => r || caches.match('/')),
        ),
    );
    return;
  }

  // الأصول المبنية (hashed) — لا تتغير أبداً لنفس الاسم → cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        });
      }),
    );
    return;
  }

  // بقية الملفات (أيقونات، manifest، mediapipe، …) → stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchAndCache = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchAndCache;
    }),
  );
});