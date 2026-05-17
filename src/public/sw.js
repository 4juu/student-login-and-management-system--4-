// ✅ ملف لإلغاء تسجيل Service Worker القديم تلقائياً
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', async () => {
  // إلغاء تسجيل SW وحذف الكاش
  await self.registration.unregister();
  
  // حذف كل الكاش القديم
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(name => caches.delete(name)));
  
  // إعادة تحميل كل التابات المفتوحة
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    if (client.url && 'navigate' in client) {
      client.navigate(client.url);
    }
  });
});