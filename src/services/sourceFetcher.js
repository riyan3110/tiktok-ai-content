const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_URLS = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
const MIN_TEXT_LENGTH = 200;
const MAX_CONTEXT_LENGTH = 12_000;
const USER_AGENT = 'AIAdsLabSourceFetcher/1.0 (+https://aiadslab.local)';

class SourceFetchError extends Error {
  constructor(url, reason, status = 400) { super(`Gagal mengambil sumber ${url}: ${reason}`); this.url = url; this.reason = reason; this.status = status; }
}

function ipToBigInt(ip) { return ip.split('.').reduce((n, part) => (n << 8n) + BigInt(part), 0n); }
function ipv4In(ip, base, bits) { const mask = (0xffffffffn << BigInt(32 - bits)) & 0xffffffffn; return (ipToBigInt(ip) & mask) === (ipToBigInt(base) & mask); }
function isBlockedIp(ip) {
  if (net.isIP(ip) === 4) return ['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','198.18.0.0/15'].some(c => { const [b, bits] = c.split('/'); return ipv4In(ip, b, Number(bits)); }) || ip === '255.255.255.255';
  if (net.isIP(ip) === 6) { const v = ip.toLowerCase(); return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.') || /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(v) || v.startsWith('169.254.169.254'); }
  return true;
}
function normalizeUrl(raw) { try { const u = new URL(String(raw || '').trim()); u.hash = ''; return u; } catch { throw Object.assign(new Error('URL sumber tidak valid'), { status: 400 }); } }
async function validateUrl(raw, lookup = dns.lookup) {
  const url = normalizeUrl(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('URL sumber hanya boleh memakai http atau https'), { status: 400 });
  const host = url.hostname.toLowerCase();
  if (['localhost', 'localhost.localdomain'].includes(host)) throw Object.assign(new Error('URL localhost tidak diizinkan'), { status: 400 });
  if (net.isIP(host) && isBlockedIp(host)) throw Object.assign(new Error('URL jaringan internal tidak diizinkan'), { status: 400 });
  let addresses;
  try { addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }); }
  catch { throw Object.assign(new Error('Host sumber tidak dapat diakses'), { status: 400 }); }
  if (!addresses.length || addresses.some(({ address }) => isBlockedIp(address))) throw Object.assign(new Error('Host sumber mengarah ke jaringan internal'), { status: 400 });
  return url;
}
function uniqueUrls(urls = []) { return [...new Map(urls.map(v => [String(v || '').trim(), String(v || '').trim()]).filter(([k]) => k)).values()]; }
function validateSourceUrls(urls) { const values = uniqueUrls(Array.isArray(urls) ? urls : []); if (!values.length) throw Object.assign(new Error('Minimal 1 URL sumber wajib diisi'), { status: 400 }); if (values.length > MAX_URLS) throw Object.assign(new Error('Maksimal 3 URL sumber'), { status: 400 }); return values; }
function decodeBasicEntities(text) { return text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))); }
function extractText(raw, contentType = '') {
  let html = String(raw || '');
  const title = decodeBasicEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  if (/text\/html/i.test(contentType)) html = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ').replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ').replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ').replace(/<form\b[\s\S]*?<\/form>/gi, ' ').replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ').replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ').replace(/<header\b[\s\S]*?<\/header>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const text = decodeBasicEntities(html).replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { title, text };
}
async function readLimited(response) { const reader = response.body?.getReader?.(); if (!reader) { const text = await response.text(); if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Response sumber terlalu besar'); return text; } let size = 0, chunks = []; while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error('Response sumber terlalu besar'); chunks.push(value); } return new TextDecoder().decode(Buffer.concat(chunks.map(v => Buffer.from(v)))); }
async function fetchOne(rawUrl, { fetchImpl = fetch, lookup = dns.lookup } = {}, redirects = 0) {
  let url; try { url = await validateUrl(rawUrl, lookup); } catch (e) { throw new SourceFetchError(rawUrl, e.message); }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.href, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9' } });
    if ([301,302,303,307,308].includes(response.status)) { if (redirects >= MAX_REDIRECTS) throw new SourceFetchError(rawUrl, 'Redirect terlalu banyak'); const location = response.headers.get('location'); if (!location) throw new SourceFetchError(rawUrl, 'Redirect tanpa tujuan'); return fetchOne(new URL(location, url.href).href, { fetchImpl, lookup }, redirects + 1); }
    if (!response.ok) throw new SourceFetchError(rawUrl, `HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!/^\s*text\/(html|plain)\b/i.test(type)) throw new SourceFetchError(rawUrl, 'Content-Type sumber harus text/html atau text/plain');
    const { title, text } = extractText(await readLimited(response), type);
    if (text.length < MIN_TEXT_LENGTH) throw new SourceFetchError(rawUrl, 'Isi sumber terlalu pendek untuk digunakan');
    return { url: rawUrl, finalUrl: response.url || url.href, title, text, fetchedAt: new Date().toISOString() };
  } catch (e) { if (e instanceof SourceFetchError) throw e; throw new SourceFetchError(rawUrl, e.name === 'AbortError' ? 'Timeout mengambil sumber' : e.message || 'Sumber tidak dapat dibaca'); }
  finally { clearTimeout(timer); }
}
async function fetchSources(urls, options = {}) { return Promise.all(validateSourceUrls(urls).map(url => fetchOne(url, options))); }
function buildSourceContext(sources) { return sources.map((s, i) => `SOURCE ${i + 1}\nTITLE: ${s.title || '-'}\nURL: ${s.finalUrl || s.url}\nCONTENT:\n${s.text}`).join('\n\n').slice(0, MAX_CONTEXT_LENGTH); }
module.exports = { fetchSources, buildSourceContext, validateSourceUrls, validateUrl, extractText, SourceFetchError, MAX_CONTEXT_LENGTH };
