const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');

// TANPA URL / AUTO SOURCE ONLY.
// Relevance is derived from the runtime topic plan, not from a catalog of known
// topics. This lets newly trending names/events work without code changes.

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looseNormalize(value) {
  return normalize(value).replace(/[.-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function phrasePresent(phrase = '', value = '') {
  const needle = normalize(phrase);
  const haystack = ` ${normalize(value)} `;
  if (needle && haystack.includes(` ${needle} `)) return true;
  const looseNeedle = looseNormalize(phrase);
  const looseHaystack = ` ${looseNormalize(value)} `;
  return Boolean(looseNeedle && looseHaystack.includes(` ${looseNeedle} `));
}

function termWords(term = '') {
  return looseNormalize(term).split(' ').filter(Boolean);
}

function simpleWordVariant(word, token) {
  if (word === token) return true;
  if (word.length < 4 || token.length < 4) return false;
  const variants = new Set([
    `${word}s`, `${word}es`, `${word}ed`, `${word}ing`,
    word.endsWith('e') ? `${word.slice(0, -1)}ing` : '',
    word.endsWith('y') ? `${word.slice(0, -1)}ies` : ''
  ].filter(Boolean));
  return variants.has(token);
}

function termPresent(term = '', value = '') {
  if (phrasePresent(term, value)) return true;
  const words = termWords(term);
  if (!words.length) return false;
  const tokens = looseNormalize(value).split(' ').filter(Boolean);
  if (words.length === 1) return tokens.some(token => simpleWordVariant(words[0], token));
  const matched = words.filter(word => tokens.some(token => simpleWordVariant(word, token))).length;
  return matched / words.length >= 0.67;
}

function subjectHits(plan = {}, value = '') {
  return (plan.subjects || []).filter(subject => phrasePresent(subject, value));
}

function eventHits(plan = {}, value = '') {
  return (plan.eventTerms || []).filter(term => termPresent(term, value));
}

function requiredSubjectMatches(plan = {}) {
  const count = (plan.subjects || []).length;
  if (!count) return 0;
  if (plan.relation === 'multi' || plan.relation === 'comparison') return 1;
  if (count <= 2) return count;
  return Math.max(2, Math.ceil(count * 0.67));
}

function sourceInScope(topic = '', source = {}, plan = {}) {
  const combined = `${source?.title || ''} ${String(source?.text || '').slice(0, 12000)}`;
  if (identity.hasSpecificIdentity(topic)) return identity.identityMatches(topic, combined);
  if (multi.hasMultiEntityTopic(topic)) {
    const entities = multi.entities(topic);
    return entities.some(entity => multi.sourceStrongForEntity(source, entity));
  }

  const subjects = plan.subjects || [];
  const subjectMatches = subjectHits(plan, combined);
  const eventMatches = eventHits(plan, combined);

  if (subjects.length) {
    if (subjectMatches.length < requiredSubjectMatches(plan)) return false;
    // For a narrowly worded event, require at least one event/context signal as
    // well so an old article about the same subject does not outrank the new story.
    if ((plan.eventTerms || []).length >= 2 && !eventMatches.length) return false;
    return true;
  }

  if ((plan.eventTerms || []).length) return eventMatches.length >= Math.min(2, plan.eventTerms.length);
  return true;
}

function evidenceInScope(topic = '', evidence = '', source = {}, plan = {}) {
  const text = clean(evidence);
  if (!text || identity.relativeTimeMetadata(text)) return false;
  if (identity.hasSpecificIdentity(topic)) return identity.identityMatches(topic, text);
  if (multi.hasMultiEntityTopic(topic)) {
    return multi.matchedEntities(topic, text).length > 0 && !multi.isRoundupSideNote(topic, text);
  }

  const subjects = plan.subjects || [];
  const subjectMatches = subjectHits(plan, text);
  const eventMatches = eventHits(plan, text);

  if (subjects.length && subjectMatches.length) return true;
  if (!subjects.length && eventMatches.length) return true;

  // A sentence may omit the repeated subject but still explicitly describe the
  // requested event. This is allowed only inside an article already in scope.
  if (sourceInScope(topic, source, plan) && eventMatches.length) return true;
  return false;
}

function evidenceScore(topic = '', evidence = '', source = {}, plan = {}) {
  if (!evidenceInScope(topic, evidence, source, plan)) return -100;
  const subjects = subjectHits(plan, evidence).length;
  const events = eventHits(plan, evidence).length;
  let score = subjects * 4 + events * 1.5;

  // Unless the user explicitly asked for market data, a one-line stock move is
  // less useful than substantive product/company/event facts.
  if (!plan.marketIntent
    && /\b(?:stock|stocks|shares?|saham|trading|traded|harga\s+saham|share\s+price)\b/i.test(evidence)) score -= 3;
  if (!plan.marketIntent
    && /\b(?:rose|fell|jumped|surged|slid|gained|dropped|naik|turun|melonjak|anjlok)\b/i.test(evidence)
    && /\b\d+(?:[.,]\d+)?%\b/.test(evidence)) score -= 2;
  return score;
}

function sentences(text = '') {
  return clean(text).split(/(?<=[.!?])\s+/).map(clean).filter(Boolean);
}

function continuationSentence(value = '') {
  return /^(?:it|this|that|these|those|the\s+(?:company|model|feature|service|tool|app|application|system)|ia|ini|itu|fitur\s+ini|model\s+ini|perusahaan\s+ini|layanan\s+ini|sistem\s+ini|produk\s+ini)\b/i.test(clean(value));
}

function scopeSource(topic = '', source = {}, plan = {}) {
  if (!sourceInScope(topic, source, plan)) return { ...source, text: '' };
  const rows = sentences(source?.text || '');
  const keepIndexes = new Set();

  rows.forEach((sentence, index) => {
    if (evidenceInScope(topic, sentence, source, plan)) {
      keepIndexes.add(index);
      // Keep one immediately following pronoun/continuation sentence so useful
      // context is not lost just because the subject is not repeated verbatim.
      const next = rows[index + 1];
      if (next && continuationSentence(next)) keepIndexes.add(index + 1);
    }
  });

  const kept = rows
    .map((sentence, index) => ({ sentence, index, score: evidenceScore(topic, sentence, source, plan) }))
    .filter(row => keepIndexes.has(row.index))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(row => row.sentence);

  return {
    ...source,
    text: kept.join(' '),
    dynamicTopicScope: {
      originalSentenceCount: rows.length,
      keptSentenceCount: kept.length,
      planner: plan.planner || 'unknown'
    }
  };
}

function scopeSources(topic = '', sources = [], plan = {}) {
  return (sources || []).map(source => scopeSource(topic, source, plan));
}

function relevance(plan = {}, value = '') {
  const subjects = plan.subjects || [];
  const events = plan.eventTerms || [];
  const sHits = subjectHits(plan, value).length;
  const eHits = eventHits(plan, value).length;
  if (!subjects.length && !events.length) return 0;
  const subjectScore = subjects.length ? sHits / subjects.length : 0;
  const eventScore = events.length ? eHits / events.length : 0;
  return subjects.length ? subjectScore * 0.72 + eventScore * 0.28 : eventScore;
}

module.exports = {
  clean,
  normalize,
  looseNormalize,
  phrasePresent,
  termPresent,
  subjectHits,
  eventHits,
  requiredSubjectMatches,
  sourceInScope,
  evidenceInScope,
  evidenceScore,
  scopeSource,
  scopeSources,
  relevance
};
