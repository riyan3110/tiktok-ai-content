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
const DIRECT_HEADERS = { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9' };
const READER_HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
const REUTERS_HOST = /(^|\.)reuters\.com$/i;
const READER_BASE_URL = 'https://r.jina.ai/';
const LOW_VALUE_REGION = /(?:related|recommend|recommendation|recommended|terkait|baca[-_ ]?juga|read[-_ ]?also|also[-_ ]?read|more[-_ ]?article|latest|popular|trending|sidebar|widget|other[-_ ]?article|artikel[-_ ]?lain|artikel[-_ ]?terkait)/i;
const RELATED_LINE = /^(?:baca\s+juga|read\s+also|artikel\s+terkait|berita\s+terkait|related\s+articles?|recommended|rekomendasi|artikel\s+lainnya|berita\s+lainnya|selengkapnya)\b/i;
const WEEKDAY_MONTH = /\b(?:senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|jun|jul|agu|agst|sep|okt|nov|des)\b/i;
const DANGLING_SITE_META = /\b(?:wib|wita|wit|gmt|utc)\b.*\b(?:url|link)\b|\b(?:url|link)\b.*\b(?:wib|wita|wit|gmt|utc)\b/i;

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
async function secureFetch(url, { lookup = dns.lookup, signal, headers = DIRECT_HEADERS } = {}) {
  const resolved = await resolvePublicUrl(url.href, lookup);
  return new Promise((resolve, reject) => {
    const client = resolved.url.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: resolved.url.protocol, hostname: resolved.address, port: resolved.url.port || (resolved.url.protocol === 'https:' ? 443 : 80),
      path: `${resolved.url.pathname}${resolved.url.search}`, method: 'GET', servername: resolved.url.hostname,
      headers: { Host: resolved.url.host, ...headers }, signal
    }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > MAX_BYTES) { request.destroy(new Error('Response sumber terlalu besar')); return; } chunks.push(chunk); });
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    request.on('error', reject); request.end();
  });
}
async function requestUrl(url, { fetchImpl, lookup = dns.lookup, signal, headers = DIRECT_HEADERS } = {}) {
  if (fetchImpl) {
    await validateUrl(url.href, lookup);
    return fetchImpl(url.href, { redirect: 'manual', signal, headers });
  }
  return secureFetch(url, { lookup, signal, headers });
}
function uniqueUrls(urls = []) { return [...new Map(urls.map(v => [String(v || '').trim(), String(v || '').trim()]).filter(([k]) => k)).values()]; }
function validateSourceUrls(urls) { const values = uniqueUrls(Array.isArray(urls) ? urls : []); if (!values.length) throw Object.assign(new Error('Minimal 1 URL sumber wajib diisi'), { status: 400 }); if (values.length > MAX_URLS) throw Object.assign(new Error('Maksimal 3 URL sumber'), { status: 400 }); return values; }
function decodeBasicEntities(text) { return String(text || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))); }

function jsonLdArticleBody(html) {
  const scripts = [...String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const bodies = [];
  const visit = value => {
    if (!value) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value !== 'object') return;
    if (typeof value.articleBody === 'string' && value.articleBody.trim().length >= MIN_TEXT_LENGTH) bodies.push(decodeBasicEntities(value.articleBody.trim()));
    Object.values(value).forEach(visit);
  };
  for (const match of scripts) {
    try { visit(JSON.parse(match[1].trim())); } catch {
      try { visit(JSON.parse(decodeBasicEntities(match[1]))); } catch { /* malformed JSON-LD: fall back to HTML */ }
    }
  }
  return bodies.sort((a, b) => b.length - a.length)[0] || '';
}

function stripLowValueRegions(html) {
  const input = String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ');
  const alwaysDrop = new Set(['aside', 'nav', 'footer', 'header']);
  const classAware = new Set(['section', 'div', 'ul', 'ol']);
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const tagPattern = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;
  const stack = [];
  let suppressDepth = 0;
  let cursor = 0;
  let output = '';
  let match;

  while ((match = tagPattern.exec(input))) {
    if (suppressDepth === 0) output += input.slice(cursor, match.index);
    const token = match[0];
    cursor = tagPattern.lastIndex;
    if (token.startsWith('<!--')) continue;

    const closing = /^<\//.test(token);
    const name = token.match(/^<\/?\s*([a-zA-Z][\w:-]*)/)?.[1]?.toLocaleLowerCase('en-US');
    if (!name) continue;

    if (closing) {
      let index = stack.length - 1;
      while (index >= 0 && stack[index].name !== name) index -= 1;
      if (index < 0) {
        if (suppressDepth === 0) output += token;
        continue;
      }
      const removed = stack.splice(index);
      const roots = removed.filter(entry => entry.suppressRoot).length;
      const wasSuppressed = suppressDepth > 0;
      suppressDepth = Math.max(0, suppressDepth - roots);
      if (!wasSuppressed && suppressDepth === 0) output += token;
      continue;
    }

    const attrs = token.slice(name.length + 1);
    const classOrIdValues = [];
    const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attribute;
    while ((attribute = attributePattern.exec(attrs))) {
      const attributeName = String(attribute[1] || '').toLocaleLowerCase('en-US');
      if (attributeName !== 'class' && attributeName !== 'id') continue;
      classOrIdValues.push(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    const lowValue = alwaysDrop.has(name) || (classAware.has(name) && classOrIdValues.some(value => LOW_VALUE_REGION.test(value)));
    const selfClosing = /\/\s*>$/.test(token) || voidTags.has(name);
    if (selfClosing) {
      if (!lowValue && suppressDepth === 0) output += token;
      continue;
    }
    const suppressRoot = lowValue && suppressDepth === 0;
    stack.push({ name, suppressRoot });
    if (suppressRoot) suppressDepth += 1;
    if (suppressDepth === 0) output += token;
  }

  if (suppressDepth === 0) output += input.slice(cursor);
  return output;
}

function rawTextLength(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
}

function preferredHtmlRegion(html) {
  const cleaned = stripLowValueRegions(html);
  const articles = [...cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
    .map(match => match[1]).filter(Boolean).sort((a, b) => rawTextLength(b) - rawTextLength(a));
  if (articles.length) return articles[0];
  const mains = [...cleaned.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)]
    .map(match => match[1]).filter(Boolean).sort((a, b) => rawTextLength(b) - rawTextLength(a));
  return mains[0] || cleaned;
}

function cleanHtmlText(html) {
  return stripLowValueRegions(String(html || ''))
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<form\b[\s\S]*?<\/form>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|h1|h2|h3|h4|h5|h6|li|blockquote|section|article|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
}

function lineKey(value) {
  return String(value || '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function looksLikeRelatedHeadline(line) {
  const text = String(line || '').trim();
  const count = text.split(/\s+/).filter(Boolean).length;
  if (count < 3 || count > 18) return false;
  if (/[.!?]$/.test(text)) return false;
  const tokens = text.match(/[A-Za-zÀ-ÿ0-9]+/g) || [];
  const titleish = tokens.filter(token => /^[A-Z0-9]/.test(token)).length;
  return titleish / Math.max(1, tokens.length) >= 0.45 || /^(?:usai|setelah|ini|begini|simak|daftar|cara|tips|fakta|profil|mengenal)\b/i.test(text);
}

function stripDatelinePrefix(line) {
  return String(line || '').replace(/^[A-ZÀ-Ý][\p{L} .'-]{1,30},\s*[A-ZÀ-Ý][\p{L}0-9 .'-]{1,40}\s*--\s*/u, '').trim();
}

function isMetadataLine(line) {
  const text = String(line || '').trim();
  if (!text) return true;
  if (/^(?:https?:\/\/|www\.)\S+$/i.test(text)) return true;
  if (DANGLING_SITE_META.test(text)) return true;
  if (WEEKDAY_MONTH.test(text) && /\b\d{1,2}[:.]\d{2}\b/.test(text) && /\b(?:wib|wita|wit|gmt|utc)\b/i.test(text)) return true;
  if (/^(?:oleh|by)\s+[\p{L}.' -]{3,80}(?:\s*[,|·-]\s*|$)/iu.test(text) && text.split(/\s+/).length <= 14) return true;
  if (/^(?:editor|penulis|reporter|kontributor|kontributor foto|fotografer)\s*:/i.test(text)) return true;
  return false;
}

function cleanArticleLines(text, title = '') {
  const titleKey = lineKey(title);
  const output = [];
  let skipRelatedHeadline = false;
  for (const raw of String(text || '').split(/\n+/)) {
    let line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    if (RELATED_LINE.test(line)) {
      skipRelatedHeadline = true;
      continue;
    }
    if (skipRelatedHeadline) {
      skipRelatedHeadline = false;
      if (looksLikeRelatedHeadline(line)) continue;
    }

    line = stripDatelinePrefix(line);
    if (!line || isMetadataLine(line)) continue;
    if (titleKey && lineKey(line) === titleKey) continue;
    if (/^(?:komentar|bagikan|share|tags?|image|foto\s*:|advertisement|iklan|dengarkan artikel|audio artikel)\b/i.test(line)) continue;
    output.push(line);
  }
  return output.join('\n');
}

function extractText(raw, contentType = '') {
  const original = String(raw || '');
  const ogTitle = original.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1]
    || original.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i)?.[1];
  const title = decodeBasicEntities((ogTitle || original.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  if (!/text\/html/i.test(contentType)) {
    const text = cleanArticleLines(decodeBasicEntities(original).replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(), title);
    return { title, text };
  }
  const ldBody = jsonLdArticleBody(original);
  const selected = ldBody || preferredHtmlRegion(original);
  const stripped = cleanHtmlText(selected);
  const text = cleanArticleLines(decodeBasicEntities(stripped), title)
    .replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return { title, text };
}
function cleanReaderMarkdown(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/`{1,3}/g, '');
}
async function readLimited(response) { const reader = response.body?.getReader?.(); if (!reader) { const text = await response.text(); if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Response sumber terlalu besar'); return text; } let size = 0, chunks = []; while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BYTES) throw new Error('Response sumber terlalu besar'); chunks.push(value); } return new TextDecoder().decode(Buffer.concat(chunks.map(v => Buffer.from(v)))); }
function canUseReaderFallback(url, status) { return [401, 403].includes(status) && REUTERS_HOST.test(url.hostname); }
async function fetchReaderFallback(originalUrl, { fetchImpl, lookup = dns.lookup, signal } = {}) {
  const readerUrl = normalizeUrl(`${READER_BASE_URL}${originalUrl.href}`);
  const response = await requestUrl(readerUrl, { fetchImpl, lookup, signal, headers: READER_HEADERS });
  if (!response.ok) throw new Error(`Reader HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!/application\/json/i.test(type)) throw new Error('Reader tidak mengembalikan JSON');
  let payload;
  try { payload = JSON.parse(await readLimited(response)); } catch { throw new Error('Reader mengembalikan JSON tidak valid'); }
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const title = decodeBasicEntities(String(data?.title || '').trim());
  const text = cleanArticleLines(decodeBasicEntities(cleanReaderMarkdown(data?.content || data?.text || '')), title)
    .replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  if (text.length < MIN_TEXT_LENGTH) throw new Error('Isi reader terlalu pendek');
  return { url: originalUrl.href, finalUrl: originalUrl.href, title, text, fetchedAt: new Date().toISOString() };
}
async function fetchOne(rawUrl, { fetchImpl, lookup = dns.lookup } = {}, redirects = 0) {
  let url; try { url = await validateUrl(rawUrl, lookup); } catch (e) { throw new SourceFetchError(rawUrl, e.message); }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await requestUrl(url, { fetchImpl, lookup, signal: controller.signal, headers: DIRECT_HEADERS });
    if ([301,302,303,307,308].includes(response.status)) { if (redirects >= MAX_REDIRECTS) throw new SourceFetchError(rawUrl, 'Redirect terlalu banyak'); const location = response.headers.get('location'); if (!location) throw new SourceFetchError(rawUrl, 'Redirect tanpa tujuan'); return fetchOne(new URL(location, url.href).href, { fetchImpl, lookup }, redirects + 1); }
    if (!response.ok && canUseReaderFallback(url, response.status)) {
      try { return await fetchReaderFallback(url, { fetchImpl, lookup, signal: controller.signal }); } catch { /* preserve original Reuters error below */ }
    }
    if (!response.ok) throw new SourceFetchError(rawUrl, `HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    if (!/^\s*text\/(html|plain)\b/i.test(type)) throw new SourceFetchError(rawUrl, 'Content-Type sumber harus text/html atau text/plain');
    const { title, text } = extractText(await readLimited(response), type);
    if (text.length < MIN_TEXT_LENGTH) throw new SourceFetchError(rawUrl, 'Isi artikel utama terlalu pendek untuk digunakan');
    return { url: rawUrl, finalUrl: response.url || url.href, title, text, fetchedAt: new Date().toISOString() };
  } catch (e) { if (e instanceof SourceFetchError) throw e; throw new SourceFetchError(rawUrl, e.name === 'AbortError' ? 'Timeout mengambil sumber' : e.message || 'Sumber tidak dapat dibaca'); }
  finally { clearTimeout(timer); }
}
async function fetchSources(urls, options = {}) { return Promise.all(validateSourceUrls(urls).map(url => fetchOne(url, options))); }
function buildSourceContext(sources) { return sources.map((s, i) => `<SOURCE id="source-${i + 1}">\nTITLE: ${s.title || '-'}\nURL: ${s.finalUrl || s.url}\nCONTENT:\n${s.text}\n</SOURCE>`).join('\n\n').slice(0, MAX_CONTEXT_LENGTH); }
module.exports = { fetchSources, buildSourceContext, validateSourceUrls, validateUrl, extractText, SourceFetchError, MAX_CONTEXT_LENGTH, preferredHtmlRegion, jsonLdArticleBody, stripLowValueRegions, cleanArticleLines, isMetadataLine };
