/* ============================================================
 * Service Worker — تحديث فوري للنسخة المنشورة + العمل دون اتصال
 * - skipWaiting + clientsClaim: أي نسخة جديدة تسيطر فوراً
 * - التنقل (index.html): network-first → دائماً أحدث إصدار
 * - أصول assets/ المبنيّة (أسماء hashed ثابتة): cache-first
 * - بقية الملفات الثابتة: stale-while-revalidate
 * - عند التفعيل: نمسح كل كاشات الإصدارات القديمة (يكسر SW عالق)
 * ============================================================ */

const VERSION = 'v2026.09.23.1';
const SHELL_CACHE = `att-shell-${VERSION}`;
const ASSET_CACHE = `att-assets-${VERSION}`;
const OUTBOX_SYNC_TAG = 'flush-outbox';

/* ============================================================
 * Background Sync — تصفيية صندوق الأوفلاين عند عودة الاتصال
 * البيانات المعلقة تُخزَّن في localStorage (المفاتيح) + IndexedDB
 * والتصفيية نفسها تحتاج Firebase SDK في نافذة التطبيق،
 * لذا يبلّغ الـ SW النوافذ المفتوحة، أو يفتح التطبيق إن لم تكن هناك نافذة.
 * ============================================================ */
self.addEventListener('sync', (event) => {
  if (event.tag === OUTBOX_SYNC_TAG) {
    event.waitUntil(notifyClientsToFlushOutbox());
  }
});

async function notifyClientsToFlushOutbox() {
  try {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clientList.length === 0) {
      // لا توجد نافذة مفتوحة — افتح التطبيق ليستكمل التصفيية عند الإقلاع
      await self.clients.openWindow('/').catch(() => {});
      return;
    }
    for (const client of clientList) {
      client.postMessage({ type: 'FLUSH_OUTBOX' });
    }
  } catch (err) {
    console.warn('[sw] فشل إبلاغ النوافذ بتصفيية الأوفلاين:', err);
  }
}

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
  // نمسح كل الكاشات بلا استثناء — يكسر أي نسخة قديمة عالقة من أي إصدار سابق
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
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