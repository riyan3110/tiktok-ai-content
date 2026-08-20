self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

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

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/api/assets/upload') {
    event.respondWith(forwardAssetUpload(request));
  }
});