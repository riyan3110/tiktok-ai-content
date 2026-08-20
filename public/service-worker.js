self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
// Keep requests network-first and unchanged; this service worker exists only
// to give the site an app lifecycle without caching authenticated content.
self.addEventListener('fetch', () => {});
