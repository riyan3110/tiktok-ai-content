const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');

// TANPA URL / AUTO SOURCE ONLY.
// Universal lexical/entity scope shared by discovery and fact selection.
// Every production composer receives only source sentences that remain inside
// the requested topic scope, so long articles cannot leak unrelated side notes.

const STOPWORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','dalam','ini','itu','adalah','merupakan','sebagai','oleh','ke','di','terhadap',
  'baru','terbaru','update','berita','info','fakta','singkat','cara','manfaat','potensi','dampak','pengaruh','peran','fitur','aplikasi',
  'menghadirkan','hadirkan','memperkenalkan','meluncurkan','merilis','rilis','mengumumkan','umumkan','membahas','hadapi','prioritaskan',
  'the','and','or','from','for','with','about','on','in','to','of','new','latest','update','news','feature','app','application','launch',
  'launches','launched','introduce','introduces','introduced','release','releases','released','announces','announced','how','what','why'
]);

const ALIASES = new Map([
  ['ai', ['ai','artificial intelligence']],
  ['iklim', ['iklim','climate']],
  ['cuaca', ['cuaca','weather']],
  ['keamanan', ['keamanan','security']],
  ['siber', ['siber','cyber']],
  ['privasi', ['privasi','privacy']],
  ['energi', ['energi','energy']],
  ['kesehatan', ['kesehatan','health']],
  ['pendidikan', ['pendidikan','education']],
  ['pemrograman', ['pemrograman','programming']],
  ['kode', ['kode','code']],
  ['robot', ['robot','robots','robotics']],
  ['humanoid', ['humanoid','humanoids']],
  ['iklan', ['iklan','advertising','ads']],
  ['gambar', ['gambar','image','images']],
  ['suara', ['suara','voice','audio']],
  ['agen', ['agen','agent','agents']],
  ['pengguna', ['pengguna','user','users']],
  ['aktif', ['aktif','active']],
  ['penurunan', ['penurunan','decline','declined','drop','dropped']],
  ['perkiraan', ['perkiraan','forecast','forecasting']],
  ['prakiraan', ['prakiraan','forecast','forecasting']],
  ['badai', ['badai','storm','storms']],
  ['topan', ['topan','typhoon','typhoons']],
  ['akses', ['akses','access']],
  ['saham', ['saham','stock','stocks','share','shares']]
]);

const MARKET_INTENT = /\b(?:saham|stock|stocks|share|shares|harga\s+saham|price|market|pasar|trading|perdagangan|investor|ticker|nasdaq|nyse)\b/i;
const MARKET_CUES = /\b(?:stock|stocks|share|shares|saham|trading|traded|pre[- ]market|after[- ]hours|ticker|nasdaq|nyse|harga\s+saham|share\s+price)\b/i;
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

function rawTokens(value = '') {
  return clean(value).match(/[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*/g) || [];
}

function aliasesFor(token) {
  const key = normalize(token);
  return ALIASES.get(key) || [key];
}

function isStrongRawToken(token = '') {
  return /[a-z][A-Z]/.test(token)
    || /^[A-Z0-9]{2,}$/.test(token)
    || /\d/.test(token)
    || /^[A-Z][A-Za-z0-9.-]{2,}$/.test(token);
}

function profile(topic = '') {
  const raw = rawTokens(topic);
  const anchors = [];
  const strong = [];
  const seen = new Set();

  for (const token of raw) {
    const key = normalize(token);
    if (!key || STOPWORDS.has(key) || (key.length <= 2 && key !== 'ai')) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = { key, aliases: aliasesFor(key), strong: isStrongRawToken(token) };
    anchors.push(item);
    if (item.strong) strong.push(item);
  }

  return {
    topic: clean(topic),
    anchors,
    strong,
    specificIdentity: identity.hasSpecificIdentity(topic),
    multiEntities: multi.entities(topic)
  };
}

function aliasPresent(anchor, value = '') {
  const haystack = ` ${normalize(value)} `;
  return (anchor?.aliases || []).some(alias => {
    const needle = normalize(alias);
    return needle && haystack.includes(` ${needle} `);
  });
}

function matchedAnchors(topic = '', value = '') {
  const p = profile(topic);
  return p.anchors.filter(anchor => aliasPresent(anchor, value));
}

function requiredAnchorCount(anchorCount) {
  if (anchorCount <= 0) return 0;
  if (anchorCount === 1) return 1;
  if (anchorCount === 2) return 2;
  return Math.max(2, Math.ceil(anchorCount * 0.5));
}

function strongAnchorPresent(p, value = '') {
  if (!p.strong.length) return true;
  return p.strong.some(anchor => aliasPresent(anchor, value));
}

function marketIntent(topic = '') {
  return MARKET_INTENT.test(String(topic || ''));
}

function firstAnchorIndex(p, value = '') {
  const tokens = clean(value).split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const window = tokens.slice(i, Math.min(tokens.length, i + 4)).join(' ');
    if (p.anchors.some(anchor => aliasPresent(anchor, window))) return i;
  }
  return -1;
}

function genericRoundupSideNote(topic = '', evidence = '') {
  if (marketIntent(topic)) return false;
  const p = profile(topic);
  if (!p.anchors.length) return false;
  const text = clean(evidence);
  if (!ROUNDUP_CUES.test(text)) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  const first = firstAnchorIndex(p, text);
  const late = first >= Math.max(6, Math.floor(tokens.length * 0.45));
  const prefix = first > 0 ? tokens.slice(0, first).join(' ') : '';
  const numericBefore = (prefix.match(/\b\d+(?:[.,]\d+)?%?\b/g) || []).length;
  return late && numericBefore >= 1;
}

function marketSnapshotPenalty(topic = '', evidence = '') {
  if (marketIntent(topic)) return 0;
  if (genericRoundupSideNote(topic, evidence)) return 20;
  let penalty = 0;
  const text = clean(evidence);
  if (MARKET_CUES.test(text)) penalty += 3;
  if (/\b(?:rose|fell|jumped|surged|slid|gained|dropped|naik|turun|melonjak|anjlok)\b/i.test(text)
    && /\b\d+(?:[.,]\d+)?%\b/.test(text)) penalty += 2;
  return penalty;
}

function sourceInScope(topic = '', source = {}) {
  const p = profile(topic);
  const combined = `${source?.title || ''} ${source?.text || ''}`;
  if (p.specificIdentity) return identity.identityMatches(topic, combined);
  if (p.multiEntities.length >= 2) {
    return p.multiEntities.some(entity => multi.sourceStrongForEntity(source, entity));
  }
  if (!p.anchors.length) return true;

  const titleMatches = p.anchors.filter(anchor => aliasPresent(anchor, source?.title || '')).length;
  const bodyMatches = p.anchors.filter(anchor => aliasPresent(anchor, String(source?.text || '').slice(0, 7000))).length;
  const required = requiredAnchorCount(p.anchors.length);
  const strongInSource = strongAnchorPresent(p, combined);
  if (!strongInSource) return false;
  if (titleMatches >= Math.min(required, 2)) return true;
  return bodyMatches >= required;
}

function evidenceInScope(topic = '', evidence = '', source = {}) {
  const p = profile(topic);
  const text = clean(evidence);
  if (!text) return false;
  if (identity.relativeTimeMetadata(text)) return false;
  if (p.specificIdentity) return identity.identityMatches(topic, text);
  if (p.multiEntities.length >= 2) {
    return multi.matchedEntities(topic, text).length > 0 && !multi.isRoundupSideNote(topic, text);
  }
  if (genericRoundupSideNote(topic, text)) return false;
  if (!p.anchors.length) return true;

  const evidenceMatches = p.anchors.filter(anchor => aliasPresent(anchor, text));
  const required = requiredAnchorCount(p.anchors.length);
  if (p.strong.length && !strongAnchorPresent(p, text)) return false;
  if (evidenceMatches.length >= required) return true;

  // A strongly scoped article may use a shortened sentence, but the evidence
  // still has to carry at least one non-strong topical context anchor.
  if (sourceInScope(topic, source) && p.strong.length) {
    const contextAnchors = p.anchors.filter(anchor => !anchor.strong);
    if (contextAnchors.length && contextAnchors.some(anchor => aliasPresent(anchor, text))) return true;
  }
  return false;
}

function evidenceScopeScore(topic = '', evidence = '', source = {}) {
  const p = profile(topic);
  if (!evidenceInScope(topic, evidence, source)) return -100;
  const matches = p.anchors.filter(anchor => aliasPresent(anchor, evidence)).length;
  const strongMatches = p.strong.filter(anchor => aliasPresent(anchor, evidence)).length;
  return matches * 1.2 + strongMatches * 1.5 + (sourceInScope(topic, source) ? 0.75 : 0) - marketSnapshotPenalty(topic, evidence);
}

function evidenceSentences(text = '') {
  return clean(text).split(/(?<=[.!?])\s+/).map(clean).filter(Boolean);
}

function scopeSource(topic = '', source = {}) {
  if (!sourceInScope(topic, source)) return { ...source, text: '' };
  const sentences = evidenceSentences(source?.text || '');
  const kept = sentences
    .map((sentence, index) => ({ sentence, index, score: evidenceScopeScore(topic, sentence, source) }))
    .filter(item => item.score > -100)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    ...source,
    text: kept.map(item => item.sentence).join(' '),
    topicScope: {
      originalSentenceCount: sentences.length,
      keptSentenceCount: kept.length
    }
  };
}

function scopeSources(topic = '', sources = []) {
  return (sources || []).map(source => scopeSource(topic, source));
}

module.exports = {
  profile,
  matchedAnchors,
  sourceInScope,
  evidenceInScope,
  evidenceScopeScore,
  evidenceSentences,
  scopeSource,
  scopeSources,
  requiredAnchorCount,
  marketIntent,
  genericRoundupSideNote,
  marketSnapshotPenalty,
  normalize
};
