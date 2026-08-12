const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');

// TANPA URL / AUTO SOURCE ONLY.
// Universal lexical/entity scope shared by discovery and fact selection.
// It is intentionally conservative: when a topic names a product/company/model,
// visible facts must keep that anchor instead of drifting to side notes in the article.

const STOPWORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','dalam','ini','itu','adalah','merupakan','sebagai','oleh','ke','di',
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
  ['robot', ['robot','robotics']],
  ['iklan', ['iklan','advertising','ads']],
  ['gambar', ['gambar','image','images']],
  ['suara', ['suara','voice','audio']],
  ['agen', ['agen','agent']],
  ['pengguna', ['pengguna','user','users']],
  ['perkiraan', ['perkiraan','forecast','forecasting']],
  ['prakiraan', ['prakiraan','forecast','forecasting']],
  ['badai', ['badai','storm']],
  ['topan', ['topan','typhoon']],
  ['akses', ['akses','access']]
]);

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
  return matches * 1.2 + strongMatches * 1.5 + (sourceInScope(topic, source) ? 0.75 : 0);
}

module.exports = {
  profile,
  matchedAnchors,
  sourceInScope,
  evidenceInScope,
  evidenceScopeScore,
  requiredAnchorCount,
  normalize
};
