// No page/API caching: train positions and account data must not go stale offline.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'RailRadar', {
    body: data.body || 'Open RailRadar to view your alert.', icon: '/icon-192.png',
    badge: '/icon-192.png', tag: data.tag || 'railradar', data: { url: '/' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const window of windows) if (new URL(window.url).origin === self.location.origin) { await window.focus(); return; }
    await self.clients.openWindow('/');
  })());
});
