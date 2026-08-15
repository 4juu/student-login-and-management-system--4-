// 🅿️ Service Worker - PWA آمن بدون أي كاش
// السياسة: لا نخزّن أي طلب في cache إطلاقاً
// حتى لا تتعارض البيانات مع Firebase أو تطبيقات in-app browsers

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // تنظيف أي كاش قديم من نسخ سابقة
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
