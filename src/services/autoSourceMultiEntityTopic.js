// TANPA URL / AUTO SOURCE ONLY.
// Understands explicit named-entity topics such as "CoreWeave dan Super Micro"
// so Auto Source does not turn a two-entity request into a generic market roundup.

const identity = require('./autoSourceTopicIdentity');

const CONNECTOR = /\s+(?:dan|&|vs\.?|versus)\s+/i;
const GENERIC_WORDS = new Set([
  'perbandingan','bandingkan','antara','tentang','mengenai','update','terbaru','baru','kinerja','perkembangan','berita','info',
  'saham','stock','stocks','harga','price','market','pasar','versus','vs','dan','and','the','latest','new','news','comparison'
]);
const MARKET_INTENT = /\b(?:saham|stock|stocks|share|shares|harga\s+saham|price|market|pasar|trading|perdagangan|investor|ticker|nasdaq|nyse)\b/i;
const MARKET_CUES = /\b(?:stock|stocks|share|shares|saham|trading|traded|pre[- ]market|after[- ]hours|ticker|nasdaq|nyse|dow|s&p|indeks|index)\b/i;
const ROUNDUP_CUES = /\b(?:gold|emas|bitcoin|btc|crypto|kripto|oil|minyak|treasury|obligasi|forex|dolar\s+index)\b/i;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namedTokens(segment = '') {
  const raw = clean(segment).match(/[A-Za-z0-9][A-Za-z0-9.-]*/g) || [];
  return raw.filter(token => {
    const key = normalize(token);
    if (!key || GENERIC_WORDS.has(key)) return false;
    return /[a-z][A-Z]/.test(token)
      || /^[A-Z0-9]{2,}$/.test(token)
      || /^[A-Z][A-Za-z0-9.-]*$/.test(token);
  });
}

function entityFromSegment(segment = '') {
  const tokens = namedTokens(segment);
  if (!tokens.length) return '';
  // Keep at most the final three named tokens. This removes leading generic
  // title-cased prose while preserving names such as "Super Micro Computer".
  return clean(tokens.slice(-3).join(' '));
}

function entities(topic = '') {
  if (identity.hasSpecificIdentity(topic)) return [];
  const parts = clean(topic).split(CONNECTOR).map(clean).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return [];
  const found = parts.map(entityFromSegment).filter(Boolean);
  if (found.length !== parts.length) return [];
  const unique = [];
  const seen = new Set();
  for (const entity of found) {
    const key = normalize(entity);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(entity);
  }
  return unique.length >= 2 ? unique : [];
}

function hasMultiEntityTopic(topic = '') {
  return entities(topic).length >= 2;
}

function entityMatches(entity, value = '') {
  const needle = normalize(entity);
  const haystack = ` ${normalize(value)} `;
  if (!needle) return false;
  return haystack.includes(` ${needle} `);
}

function matchedEntities(topic = '', value = '') {
  return entities(topic).filter(entity => entityMatches(entity, value));
}

function occurrenceCount(entity, value = '') {
  const needle = normalize(entity);
  const haystack = normalize(value);
  if (!needle || !haystack) return 0;
  let count = 0;
  let start = 0;
  while (true) {
    const index = haystack.indexOf(needle, start);
    if (index < 0) break;
    const before = index === 0 ? ' ' : haystack[index - 1];
    const afterIndex = index + needle.length;
    const after = afterIndex >= haystack.length ? ' ' : haystack[afterIndex];
    if (/\s/.test(before) && /\s/.test(after)) count += 1;
    start = index + needle.length;
  }
  return count;
}

function sourceStrongForEntity(source = {}, entity = '') {
  if (entityMatches(entity, source?.title || '')) return true;
  return occurrenceCount(entity, source?.text || '') >= 2;
}

function marketIntent(topic = '') {
  return MARKET_INTENT.test(String(topic || ''));
}

function firstEntityWordIndex(topic = '', value = '') {
  const targetEntities = entities(topic);
  const tokens = clean(value).split(/\s+/).filter(Boolean);
  let first = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    const tail = tokens.slice(i, Math.min(tokens.length, i + 4)).join(' ');
    if (targetEntities.some(entity => entityMatches(entity, tail))) {
      first = i;
      break;
    }
  }
  return first;
}

function isRoundupSideNote(topic = '', evidence = '') {
  if (marketIntent(topic)) return false;
  const text = clean(evidence);
  if (!text || !matchedEntities(topic, text).length) return true;
  const tokens = text.split(/\s+/).filter(Boolean);
  const first = firstEntityWordIndex(topic, text);
  const late = first >= Math.max(6, Math.floor(tokens.length * 0.45));
  const prefix = first > 0 ? tokens.slice(0, first).join(' ') : '';
  const numericBefore = (prefix.match(/\b\d+(?:[.,]\d+)?%?\b/g) || []).length;
  if (late && numericBefore >= 1 && ROUNDUP_CUES.test(prefix)) return true;
  if (ROUNDUP_CUES.test(text) && /\b(?:disebut|mentioned|also\s+included|among\s+others)\b/i.test(text)) return true;
  return false;
}

function marketSnapshotPenalty(topic = '', evidence = '') {
  if (marketIntent(topic)) return 0;
  const text = clean(evidence);
  if (isRoundupSideNote(topic, text)) return 8;
  let penalty = 0;
  if (MARKET_CUES.test(text)) penalty += 1.8;
  if (/\b(?:rose|fell|jumped|surged|slid|gained|dropped|naik|turun|melonjak|anjlok)\b/i.test(text)
    && /\b\d+(?:[.,]\d+)?%\b/.test(text)) penalty += 1.4;
  if (/\b(?:traded\s+at|diperdagangkan\s+di|share\s+price|harga\s+saham)\b/i.test(text)) penalty += 1.8;
  return penalty;
}

module.exports = {
  entities,
  hasMultiEntityTopic,
  entityMatches,
  matchedEntities,
  occurrenceCount,
  sourceStrongForEntity,
  marketIntent,
  isRoundupSideNote,
  marketSnapshotPenalty,
  normalize
};
