// 🅿️ Service Worker - تطبيق يعمل دون اتصال مع تحديثات فورية
// السياسة:
// - index.html / التنقلات: network-first دائماً (تصل التحديثات فوراً)
// - أصول التطبيق (assets/js/css): تُخزّن بعد أول تحميل ناجح وتُستخدم كاشياً
//   فيغرف الموقع كله (بما فيه تسجيل البصمة) عند انقطاع الإنترنت
// - لا نلمس أبداً طلبات API/Firebase حتى لا تتعارض مع البيانات الحية

const CACHE_NAME = 'app-shell-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => {
      if (key !== CACHE_NAME) return caches.delete(key);
      return undefined;
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // نتجاهل طلبات Firebase والـ analytics (تعمل عبر مكتباتها الخاصة)
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis')) return;

  // 🖼️ صفحات HTML / التنقل: دائماً من الشبكة أولاً، وإلا من الكاش (عند الانقطاع)
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === '/') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('index', copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match('index').then((cached) => cached || caches.match(req))
        )
    );
    return;
  }

  // 📦 بقية الموارد (أصول التطبيق والأيقونات والخطوط): كاش أولاً مع تخزين في الخلفية
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
