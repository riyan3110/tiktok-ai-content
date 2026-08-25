const STATIC_CACHE = 'aiads-static-global-perf-20260825b';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(name => name.startsWith('aiads-static-') && name !== STATIC_CACHE).map(name => caches.delete(name)));
  await self.clients.claim();
})()));

function decodeBase64(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function forwardAssetUpload(request) {
  try {
    const payload = await request.clone().json();
    if (!payload?.data) return fetch(request);

    const source = new URL(request.url);
    const target = new URL('/api/assets/upload-file', source.origin);
    target.searchParams.set('name', String(payload.name || 'upload.bin'));
    target.searchParams.set('mimeType', String(payload.mimeType || 'application/octet-stream'));
    if (payload.type) target.searchParams.set('type', String(payload.type));
    if (payload.folderId) target.searchParams.set('folderId', String(payload.folderId));
    target.searchParams.set('tags', JSON.stringify(Array.isArray(payload.tags) ? payload.tags : ['Other']));
    target.searchParams.set('metadata', JSON.stringify(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : { category: 'Other' }));

    const headers = new Headers(request.headers);
    headers.set('Content-Type', 'application/octet-stream');
    headers.delete('Content-Length');

    return fetch(target, {
      method: 'POST',
      headers,
      body: decodeBase64(payload.data),
      credentials: 'include',
      cache: 'no-store'
    });
  } catch {
    return fetch(request);
  }
}

function cacheableStatic(url, request) {
  if (request.method !== 'GET' || url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/generated/')) return false;
  return /\.(?:js|css|png|svg|webp|ico|woff2?)$/i.test(url.pathname);
}

async function staticResponse(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') cache.put(request, response.clone()).catch(() => {});
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/api/assets/upload') {
    event.respondWith(forwardAssetUpload(request));
    return;
  }
  if (cacheableStatic(url, request)) event.respondWith(staticResponse(request));
});
