/* ============================================================
 * Service Worker — تحديث فوري للنسخة المنشورة + العمل دون اتصال
 * - skipWaiting + clientsClaim: أي نسخة جديدة تسيطر فوراً
 * - التنقل (index.html): network-first → دائماً أحدث إصدار
 * - أصول assets/ المبنيّة (أسماء hashed ثابتة): cache-first
 * - بقية الملفات الثابتة: stale-while-revalidate
 * - عند التفعيل: نمسح كل كاشات الإصدارات القديمة (يكسر SW عالق)
 * ============================================================ */

const VERSION = 'v2026.09.28.1';
const SHELL_CACHE = `att-shell-${VERSION}`;
const ASSET_CACHE = `att-assets-${VERSION}`;
const CACHE_PREFIXES = ['att-shell-', 'att-assets-'];
const OUTBOX_SYNC_TAG = 'flush-outbox';

// صفحة احتياطية عند انقطاع الاتصال بلا كاش — تمنع TypeError في respondWith
const OFFLINE_HTML =
  '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>غير متصل</title><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0B1220;color:#e2e8f0">' +
  '<div style="text-align:center"><h1 style="font-size:1.2rem">لا يوجد اتصال بالإنترنت</h1>' +
  '<p style="opacity:.7">تحقق من الشبكة ثم أعد المحاولة</p></div></body></html>';

const offlineFallback = () =>
  new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

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
  // نمسح كاشات الإصدارات القديمة فقط (نحتفظ بكاشات هذا الإصدار)
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => CACHE_PREFIXES.some((p) => k.startsWith(p)) && k !== SHELL_CACHE && k !== ASSET_CACHE)
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
        .catch(async () => {
          const shell = (await caches.match('/index.html')) || (await caches.match('/'));
          return shell || offlineFallback();
        }),
    );
    return;
  }

  // الأصول المبنية (hashed) — لا تتغير أبداً لنفس الاسم → cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => Response.error());
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
        .catch(() => cached || Response.error());
      return cached || fetchAndCache;
    }),
  );
});