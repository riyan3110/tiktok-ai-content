const dynamicScope = require('./autoSourceDynamicScope');

// TANPA URL / AUTO SOURCE ONLY.
// Clean the already topic-scoped article text before fact selection. The goal is
// deliberately simple: keep substantive story facts, drop editorial/promotional
// side-notes, split obvious compound clauses, and put the requested event first.

const HARD_PROMO = /\b(?:subscribe|subscription|newsletter|premium\s+(?:member|membership)|sign\s+up|free\s+trial|stock\s+advisor|join\s+now|daftar\s+sekarang|berlangganan)\b/i;
const STOCK_PICK_EDITORIAL = /(?:\b(?:best|top)\s+(?:\d+|ten|five|three)?\s*(?:stocks?|shares?)\b|\b(?:stocks?|shares?)\s+(?:to\s+buy|to\s+own)\b|\b(?:saham)\s+(?:terbaik|pilihan|untuk\s+dibeli)\b|\b(?:tidak\s+(?:menempatkan|memasukkan)|not\s+(?:among|included?)).{0,90}\b(?:stocks?|shares?|saham)\b|\b(?:rekomendasi|recommendation)\s+(?:saham|stock)\b)/i;
const MARKET_SNAPSHOT = /\b(?:stock|stocks|shares?|saham|share\s+price|harga\s+saham)\b/i;
const MARKET_MOVE = /\b(?:rose|fell|jumped|surged|slid|gained|dropped|rallied|naik|turun|melonjak|anjlok|menguat|melemah)\b/i;
const RELATIVE_METADATA = /\b\d+\s*(?:menit|jam|hari|minggu|bulan|minute|minutes|hour|hours|day|days|week|weeks|month|months)\s*(?:lalu|ago)\b/i;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function words(value) {
  return clean(value).split(/\s+/).filter(Boolean);
}

function normalizedTerm(value) {
  return dynamicScope.looseNormalize(value);
}

function isSameTerm(left, right) {
  const a = normalizedTerm(left);
  const b = normalizedTerm(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function storyEventTerms(plan = {}) {
  const subjects = plan.subjects || [];
  return (plan.eventTerms || []).filter(term =>
    term && !subjects.some(subject => isSameTerm(term, subject))
  );
}

function eventHits(plan = {}, value = '') {
  const eventTerms = storyEventTerms(plan);
  return dynamicScope.eventHits({ ...plan, eventTerms }, value);
}

function requestedText(plan = {}) {
  return clean(`${plan.rawTopic || ''} ${plan.canonicalTopic || ''}`);
}

function editorialNoise(value = '', plan = {}) {
  const text = clean(value);
  if (!text) return true;
  const requested = requestedText(plan);
  if (HARD_PROMO.test(text) && !HARD_PROMO.test(requested)) return true;
  if (!plan.marketIntent && STOCK_PICK_EDITORIAL.test(text) && !STOCK_PICK_EDITORIAL.test(requested)) return true;
  if (RELATIVE_METADATA.test(text) && words(text).length <= 16 && !RELATIVE_METADATA.test(requested)) return true;
  return false;
}

function marketSnapshot(value = '', plan = {}) {
  if (plan.marketIntent) return false;
  const text = clean(value);
  return MARKET_SNAPSHOT.test(text)
    && MARKET_MOVE.test(text)
    && /\b\d+(?:[.,]\d+)?%\b/.test(text);
}

function sentenceRows(text = '') {
  return clean(text)
    .split(/(?<=[.!?])\s+/)
    .map(clean)
    .filter(Boolean);
}

function splitCompoundSentence(sentence = '') {
  const source = clean(sentence);
  if (!source) return [];

  // Split only obvious clause boundaries. We intentionally do NOT split plain
  // "and/dan" because lists and tightly related facts would lose meaning.
  const marked = source
    .replace(/;\s+/g, '.\n')
    .replace(/\s+[—–]\s+/g, '.\n')
    .replace(/,\s+(?=(?:while|whereas|but|however|meanwhile|sedangkan|sementara|tetapi|namun)\b)/gi, '.\n');

  const parts = marked.split(/\n+/).map(value => clean(value).replace(/^\.+\s*/, '')).filter(Boolean);
  if (parts.length <= 1) return [source];

  // Avoid producing tiny fragments that are unusable as standalone evidence.
  const usable = parts.filter(part => words(part).length >= 4);
  return usable.length >= 2 ? usable : [source];
}

function atomicFacts(text = '') {
  return sentenceRows(text).flatMap(splitCompoundSentence);
}

function focusScore(topic = '', evidence = '', source = {}, plan = {}) {
  if (editorialNoise(evidence, plan)) return -100;
  if (!dynamicScope.evidenceInScope(topic, evidence, source, plan)) return -100;

  const subjects = dynamicScope.subjectHits(plan, evidence).length;
  const events = eventHits(plan, evidence).length;
  const titleEvents = eventHits(plan, source?.title || '').length;
  let score = dynamicScope.evidenceScore(topic, evidence, source, plan)
    + subjects * 1.5
    + events * 4
    + (subjects && events ? 1.5 : 0)
    + (events && titleEvents ? 0.75 : 0);

  const count = words(evidence).length;
  if (count >= 7 && count <= 30) score += 0.4;
  if (marketSnapshot(evidence, plan)) score -= 5;
  return score;
}

function focusSource(topic = '', source = {}, plan = {}, maxFacts = 14) {
  const originalFacts = atomicFacts(source?.text || '');
  const facts = originalFacts
    .map((evidence, order) => ({
      evidence,
      order,
      score: focusScore(topic, evidence, source, plan),
      eventHits: eventHits(plan, evidence).length
    }))
    .filter(row => row.score > -100)
    .sort((a, b) => b.eventHits - a.eventHits || b.score - a.score || a.order - b.order)
    .slice(0, maxFacts);

  return {
    ...source,
    // Each row is separated again so downstream evidence extraction sees one
    // clear fact at a time instead of one compound sentence with two metrics.
    text: facts.map(row => /[.!?]$/.test(row.evidence) ? row.evidence : `${row.evidence}.`).join(' '),
    storyFocus: {
      originalFactCount: originalFacts.length,
      keptFactCount: facts.length,
      eventFocusedCount: facts.filter(row => row.eventHits > 0).length
    }
  };
}

function focusSources(topic = '', sources = [], plan = {}) {
  return (sources || []).map(source => focusSource(topic, source, plan));
}

module.exports = {
  storyEventTerms,
  eventHits,
  requestedText,
  editorialNoise,
  marketSnapshot,
  sentenceRows,
  splitCompoundSentence,
  atomicFacts,
  focusScore,
  focusSource,
  focusSources
};
