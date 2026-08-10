const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
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
function cleanHostIp(value) { return String(value || '').replace(/^\[|\]$/g, ''); }
function isBlockedIp(input) {
  const ip = cleanHostIp(input);
  if (net.isIP(ip) === 4) return ['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.168.0.0/16','198.18.0.0/15'].some(c => { const [b, bits] = c.split('/'); return ipv4In(ip, b, Number(bits)); }) || ip === '255.255.255.255';
  if (net.isIP(ip) === 6) { const v = ip.toLowerCase(); return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:'); }
  return true;
}
function normalizeUrl(raw) { try { const u = new URL(String(raw || '').trim()); u.hash = ''; return u; } catch { throw Object.assign(new Error('URL sumber tidak valid'), { status: 400 }); } }
async function resolvePublicUrl(raw, lookup = dns.lookup) {
  const url = normalizeUrl(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('URL sumber hanya boleh memakai http atau https'), { status: 400 });
  const host = cleanHostIp(url.hostname.toLowerCase());
  if (['localhost', 'localhost.localdomain'].includes(host)) throw Object.assign(new Error('URL localhost tidak diizinkan'), { status: 400 });
  if (net.isIP(host) && isBlockedIp(host)) throw Object.assign(new Error('URL jaringan internal tidak diizinkan'), { status: 400 });
  let addresses;
  try { addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }); }
  catch { throw Object.assign(new Error('Host sumber tidak dapat diakses'), { status: 400 }); }
  if (!addresses.length || addresses.some(({ address }) => isBlockedIp(address))) throw Object.assign(new Error('Host sumber mengarah ke jaringan internal'), { status: 400 });
  return { url, address: addresses[0].address };
}
async function validateUrl(raw, lookup = dns.lookup) { return (await resolvePublicUrl(raw, lookup)).url; }
async function secureFetch(url, { lookup = dns.lookup, signal } = {}) {
  const resolved = await resolvePublicUrl(url.href, lookup);
  return new Promise((resolve, reject) => {
    const client = resolved.url.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: resolved.url.protocol, hostname: resolved.address, port: resolved.url.port || (resolved.url.protocol === 'https:' ? 443 : 80),
      path: `${resolved.url.pathname}${resolved.url.search}`, method: 'GET', servername: resolved.url.hostname,
      headers: { Host: resolved.url.host, 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9' }, signal
    }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { request.destroy(new Error('Response sumber terlalu besar')); return; } chunks.push(chunk); });
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    request.on('error', reject); request.end();
  });
}
function uniqueUrls(urls = []) { return [...new Map(urls.map(v => [String(v || '').trim(), String(v || '').trim()]).filter(([k]) => k)).values()]; }
function validateSourceUrls(urls) { const values = uniqueUrls(Array.isArray(urls) ? urls : []); if (!values.length) throw Object.assign(new Error('Minimal 1 URL sumber wajib diisi'), { status: 400 }); if (values.length > MAX_URLS) throw Object.assign(new Error('Maksimal 3 URL sumber'), { status: 400 }); return values; }
function decodeBasicEntities(text) { return String(text || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))); }

function jsonLdObjects(value, output = []) {
  if (Array.isArray(value)) value.forEach(item => jsonLdObjects(item, output));
  else if (value && typeof value === 'object') {
    output.push(value);
    Object.values(value).forEach(item => jsonLdObjects(item, output));
  }
  return output;
}

function extractStructuredArticle(html) {
  const candidates = [];
  for (const match of String(html || '').matchAll(/<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = match[1].trim();
    if (!raw) continue;
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      try { parsed = JSON.parse(decodeBasicEntities(raw)); }
      catch { continue; }
    }
    for (const item of jsonLdObjects(parsed)) {
      const body = typeof item?.articleBody === 'string' ? item.articleBody.trim() : '';
      if (!body) continue;
      const type = Array.isArray(item['@type']) ? item['@type'].join(' ') : String(item['@type'] || '');
      const articleLike = /Article|NewsArticle|BlogPosting|ReportageNewsArticle/i.test(type) || body.length >= MIN_TEXT_LENGTH;
      if (!articleLike) continue;
      candidates.push({
        title: String(item?.headline || item?.name || '').trim(),
        body: decodeBasicEntities(body).replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
      });
    }
  }
  return candidates.sort((a, b) => b.body.length - a.body.length)[0] || null;
}

const NOISY_BLOCK_ATTR = /(?:^|[\s_-])(?:related|recommended|recommendation|baca[-_ ]?juga|read[-_ ]?more|most[-_ ]?popular|be[-_ ]?stories|latest|trending|sidebar|widget|promo|advert|ads?|next[-_ ]?article|more[-_ ]?article|article[-_ ]?list|other[-_ ]?article)(?:$|[\s_-])/i;

function stripNoisyHtmlBlocks(html) {
  let output = String(html || '');
  const tags = ['aside', 'nav', 'footer', 'header'];
  for (const tag of tags) output = output.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  for (const tag of ['section', 'div', 'ul']) {
    const pattern = new RegExp(`<${tag}\\b([^>]*)>[\\s\\S]*?<\\/${tag}>`, 'gi');
    output = output.replace(pattern, (block, attrs) => {
      const marker = String(attrs || '').match(/(?:class|id)\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const value = marker ? (marker[1] || marker[2] || '') : '';
      return NOISY_BLOCK_ATTR.test(value) ? ' ' : block;
    });
  }
  return output;
}

function preferredHtmlRegion(html) {
  const articles = [...String(html || '').matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
    .map(match => match[1]).filter(Boolean)
    .sort((a, b) => cleanHtmlText(b).length - cleanHtmlText(a).length);
  if (articles.length) return articles[0];
  const main = String(html || '').match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  return main || html;
}

function cleanHtmlText(html) {
  return stripNoisyHtmlBlocks(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<form\b[\s\S]*?<\/form>/gi, ' ')
    .replace(/<\/?(?:p|h[1-6]|li|blockquote|figcaption|br)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
}

function extractText(raw, contentType = '') {
  const original = String(raw || '');
  const htmlTitle = decodeBasicEntities((original.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  if (/text\/html/i.test(contentType)) {
    const structured = extractStructuredArticle(original);
    if (structured?.body && structured.body.length >= MIN_TEXT_LENGTH) {
      return { title: structured.title || htmlTitle, text: structured.body };
    }
  }
  const selected = /text\/html/i.test(contentType) ? preferredHtmlRegion(original) : original;
  const stripped = /text\/html/i.test(contentType) ? cleanHtmlText(selected) : selected;
  const text = decodeBasicEntities(stripped).replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { title: htmlTitle, text };
}
async function readLimited(response) { const reader = response.body?.getReader?.(); if (!reader) { const text = await response.text(); if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Response sumber terlalu besar'); return text; } let size = 0, chunks = []; while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error('Response sumber terlalu besar'); chunks.push(value); } return new TextDecoder().decode(Buffer.concat(chunks.map(v => Buffer.from(v)))); }
async function fetchOne(rawUrl, { fetchImpl, lookup = dns.lookup } = {}, redirects = 0) {
  let url; try { url = await validateUrl(rawUrl, lookup); } catch (e) { throw new SourceFetchError(rawUrl, e.message); }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = fetchImpl ? await (await validateUrl(url.href, lookup), fetchImpl(url.href, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9' } })) : await secureFetch(url, { lookup, signal: controller.signal });
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
function buildSourceContext(sources) { return sources.map((s, i) => `<SOURCE id="source-${i + 1}">\nTITLE: ${s.title || '-'}\nURL: ${s.finalUrl || s.url}\nCONTENT:\n${s.text}\n</SOURCE>`).join('\n\n').slice(0, MAX_CONTEXT_LENGTH); }
module.exports = {
  fetchSources, buildSourceContext, validateSourceUrls, validateUrl, extractText, extractStructuredArticle,
  SourceFetchError, MAX_CONTEXT_LENGTH
};
