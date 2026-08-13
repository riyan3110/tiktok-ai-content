const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');

// TANPA URL / AUTO SOURCE ONLY.
// Relevance is derived from the runtime topic plan. Event-shaped topics are
// locked to both the requested action and its distinguishing context so a page
// about the same subject cannot become a different news story.

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

function lightIndonesianStem(word = '') {
  let value = looseNormalize(word);
  if (!value || value.includes(' ')) return value;
  for (const prefix of ['meng','meny','men','mem','me','ber','ter','di']) {
    if (value.startsWith(prefix) && value.length - prefix.length >= 3) {
      value = value.slice(prefix.length);
      break;
    }
  }
  if (value.endsWith('kan') && value.length > 6) value = value.slice(0, -3);
  return value;
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

function actionTermPresent(term = '', value = '') {
  if (termPresent(term, value)) return true;
  const words = termWords(term);
  if (words.length !== 1) return false;
  const wanted = lightIndonesianStem(words[0]);
  if (!wanted || wanted.length < 3) return false;
  return looseNormalize(value).split(' ').filter(Boolean)
    .some(token => lightIndonesianStem(token) === wanted);
}

function conservativeNamedSubjectVariant(subject = '', value = '') {
  const rawSubject = clean(subject);
  // Fuzzy matching is only a safety net when the AI topic planner falls back.
  // Keep it deliberately narrow: one title-cased word, no version/number, same
  // length, and only one substitution or one adjacent transposition. This lets
  // an obvious query typo match the correctly-spelled name in a source without
  // broadening ordinary keywords or silently changing product identities.
  if (!/^[A-Z][A-Za-z]{4,}$/.test(rawSubject)) return false;
  const wanted = rawSubject.toLowerCase();
  const candidates = clean(value).match(/[A-Za-z][A-Za-z-]*/g) || [];

  return candidates.some(candidate => {
    if (!/^[A-Z]/.test(candidate) || candidate.length !== wanted.length) return false;
    const actual = candidate.toLowerCase();
    const differences = [];
    for (let index = 0; index < wanted.length; index += 1) {
      if (wanted[index] !== actual[index]) differences.push(index);
      if (differences.length > 2) return false;
    }
    if (differences.length === 1) return true;
    if (differences.length !== 2) return false;
    const [first, second] = differences;
    return second === first + 1
      && wanted[first] === actual[second]
      && wanted[second] === actual[first];
  });
}

function subjectPresent(subject = '', value = '') {
  return phrasePresent(subject, value) || conservativeNamedSubjectVariant(subject, value);
}

function subjectHits(plan = {}, value = '') {
  return (plan.subjects || []).filter(subject => subjectPresent(subject, value));
}

function eventHits(plan = {}, value = '') {
  return (plan.eventTerms || []).filter(term => termPresent(term, value));
}

function actionHits(plan = {}, value = '') {
  return (plan.actionTerms || []).filter(term => actionTermPresent(term, value));
}

function contextHits(plan = {}, value = '') {
  return (plan.contextTerms || []).filter(term => termPresent(term, value));
}

function eventLockRequired(plan = {}) {
  return Array.isArray(plan.actionTerms) && plan.actionTerms.length > 0;
}

function requiredContextMatches(plan = {}) {
  const contexts = plan.contextTerms || [];
  if (!contexts.length) return 0;
  if (plan.planner === 'fallback') return Math.min(2, contexts.length);
  return 1;
}

function eventLockSatisfied(plan = {}, value = '') {
  if (!eventLockRequired(plan)) return eventHits(plan, value).length > 0;
  if (!actionHits(plan, value).length) return false;
  const required = requiredContextMatches(plan);
  if (!required) return true;
  return contextHits(plan, value).length >= required;
}

function sentences(text = '') {
  return clean(text).split(/(?<=[.!?])\s+/).map(clean).filter(Boolean);
}

function eventAlignedSource(plan = {}, source = {}) {
  if (!eventLockRequired(plan)) return eventHits(plan, `${source?.title || ''} ${source?.text || ''}`).length > 0;
  const title = clean(source?.title || '');
  if (eventLockSatisfied(plan, title)) return true;
  const rows = sentences(source?.text || '');
  for (let index = 0; index < rows.length; index += 1) {
    if (eventLockSatisfied(plan, rows[index])) return true;
    const pair = `${rows[index]} ${rows[index + 1] || ''}`.trim();
    if (rows[index + 1] && eventLockSatisfied(plan, pair)) return true;
  }
  return false;
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
  const headlineLead = `${source?.title || ''} ${sentences(source?.text || '').slice(0, 4).join(' ')}`;
  const specific = identity.hasSpecificIdentity(topic);
  const multiTopic = multi.hasMultiEntityTopic(topic);

  if (specific && !identity.identityMatches(topic, combined)) return false;
  if (multiTopic) {
    const entities = multi.entities(topic);
    if (!entities.some(entity => multi.sourceStrongForEntity(source, entity))) return false;
  }
  if (eventLockRequired(plan) && !eventAlignedSource(plan, source)) return false;
  if (specific || multiTopic) return true;

  const subjects = plan.subjects || [];
  const subjectMatches = subjectHits(plan, combined);
  const eventMatches = eventHits(plan, combined);
  const contextMatches = contextHits(plan, combined);

  if (subjects.length) {
    if (subjectMatches.length < requiredSubjectMatches(plan)) return false;
    // Once the AI has separated the subject from its distinguishing context,
    // brand-name overlap alone must not admit another story about that product.
    if (plan.planner === 'ai') {
      const contexts = plan.contextTerms || [];
      const events = plan.eventTerms || [];
      if (contexts.length && !contextMatches.length) return false;
      if ((contexts.length || events.length)
        && !contextHits(plan, headlineLead).length
        && !eventHits(plan, headlineLead).length) return false;
    }
    if ((plan.eventTerms || []).length >= 2 && !eventMatches.length) {
      // A comparison can be grounded by independent articles about each side.
      // Each source still needs one interpreted context, so another story about
      // the same brand (for example pricing) cannot pass this exception.
      const complementaryComparison = contextMatches.length > 0
        && (['comparison', 'multi'].includes(plan.relation)
          || contextHits(plan, source?.title || '').length > 0);
      if (!complementaryComparison) return false;
    }
    return true;
  }

  if ((plan.eventTerms || []).length) return eventMatches.length >= Math.min(2, plan.eventTerms.length);
  if ((plan.contextTerms || []).length) {
    return contextHits(plan, combined).length >= requiredContextMatches(plan);
  }
  return true;
}

function evidenceInScope(topic = '', evidence = '', source = {}, plan = {}) {
  const text = clean(evidence);
  if (!text || identity.relativeTimeMetadata(text)) return false;
  const specific = identity.hasSpecificIdentity(topic);
  const multiTopic = multi.hasMultiEntityTopic(topic);
  const identityMatch = !specific || identity.identityMatches(topic, text);
  const entityMatches = multiTopic ? multi.matchedEntities(topic, text) : [];

  if (!identityMatch) return false;
  if (multiTopic && (!entityMatches.length || multi.isRoundupSideNote(topic, text))) return false;

  const subjects = plan.subjects || [];
  const subjectMatches = subjectHits(plan, text);
  const eventMatches = eventHits(plan, text);

  if (eventLockRequired(plan)) {
    if (!eventAlignedSource(plan, source)) return false;
    if (eventLockSatisfied(plan, text)) return true;
    if (eventLockSatisfied(plan, source?.title || '')) {
      if (specific || entityMatches.length) return true;
      if (subjectMatches.length) return true;
      if (contextHits(plan, text).length) return true;
    }
    return false;
  }

  if (specific || entityMatches.length) return true;
  if (subjects.length && subjectMatches.length) return true;
  if (!subjects.length && eventMatches.length) return true;
  if (sourceInScope(topic, source, plan) && eventMatches.length) return true;
  return false;
}

function evidenceScore(topic = '', evidence = '', source = {}, plan = {}) {
  if (!evidenceInScope(topic, evidence, source, plan)) return -100;
  const subjects = subjectHits(plan, evidence).length;
  const events = eventHits(plan, evidence).length;
  const actions = actionHits(plan, evidence).length;
  const contexts = contextHits(plan, evidence).length;
  let score = subjects * 4 + events * 1.5 + actions * 3 + contexts * 2;
  if (eventLockSatisfied(plan, evidence)) score += 5;

  if (!plan.marketIntent
    && /\b(?:stock|stocks|shares?|saham|trading|traded|harga\s+saham|share\s+price)\b/i.test(evidence)) score -= 3;
  if (!plan.marketIntent
    && /\b(?:rose|fell|jumped|surged|slid|gained|dropped|naik|turun|melonjak|anjlok)\b/i.test(evidence)
    && /\b\d+(?:[.,]\d+)?%\b/.test(evidence)) score -= 2;
  return score;
}

function continuationSentence(value = '') {
  return /^(?:it|this|that|these|those|the\s+(?:company|model|feature|service|tool|app|application|system)|ia|ini|itu|fitur\s+ini|model\s+ini|perusahaan\s+ini|layanan\s+ini|sistem\s+ini|produk\s+ini)\b/i.test(clean(value));
}

function scopeEventSource(topic = '', source = {}, plan = {}) {
  if (!sourceInScope(topic, source, plan)) return { ...source, text: '' };
  const rows = sentences(source?.text || '');
  const keepIndexes = new Set();
  const titleLocked = eventLockSatisfied(plan, source?.title || '');

  if (titleLocked) {
    // The opening core is usually the dek/lead of the requested story. Keep it,
    // but do not let later paragraphs survive merely because they repeat the
    // company/product name; later rows still need event context.
    for (let index = 0; index < Math.min(4, rows.length); index += 1) keepIndexes.add(index);
  }

  rows.forEach((sentence, index) => {
    const direct = eventLockSatisfied(plan, sentence);
    const contextual = titleLocked && contextHits(plan, sentence).length > 0;
    if (!direct && !contextual) return;
    keepIndexes.add(index);
    const next = rows[index + 1];
    if (next && (continuationSentence(next) || contextHits(plan, next).length)) keepIndexes.add(index + 1);
  });

  const kept = rows.filter((sentence, index) => keepIndexes.has(index) && !identity.relativeTimeMetadata(sentence));
  return {
    ...source,
    text: kept.join(' '),
    dynamicTopicScope: {
      originalSentenceCount: rows.length,
      keptSentenceCount: kept.length,
      planner: plan.planner || 'unknown',
      eventLocked: true
    }
  };
}

function scopeSource(topic = '', source = {}, plan = {}) {
  if (eventLockRequired(plan)) return scopeEventSource(topic, source, plan);
  if (!sourceInScope(topic, source, plan)) return { ...source, text: '' };
  const rows = sentences(source?.text || '');
  const keepIndexes = new Set();

  rows.forEach((sentence, index) => {
    if (evidenceInScope(topic, sentence, source, plan)) {
      keepIndexes.add(index);
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
      planner: plan.planner || 'unknown',
      eventLocked: false
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
  const actionScore = eventLockRequired(plan) ? (actionHits(plan, value).length ? 1 : 0) : 0;
  const contextRequired = requiredContextMatches(plan);
  const contextScore = contextRequired ? Math.min(1, contextHits(plan, value).length / contextRequired) : 0;
  if (!subjects.length && !events.length && !eventLockRequired(plan)) return 0;
  const subjectScore = subjects.length ? sHits / subjects.length : 0;
  const eventScore = events.length ? eHits / events.length : 0;
  if (eventLockRequired(plan)) return subjectScore * 0.45 + actionScore * 0.3 + contextScore * 0.25;
  return subjects.length ? subjectScore * 0.72 + eventScore * 0.28 : eventScore;
}

module.exports = {
  clean,
  normalize,
  looseNormalize,
  phrasePresent,
  conservativeNamedSubjectVariant,
  subjectPresent,
  termPresent,
  actionTermPresent,
  subjectHits,
  eventHits,
  actionHits,
  contextHits,
  eventLockRequired,
  requiredContextMatches,
  eventLockSatisfied,
  eventAlignedSource,
  requiredSubjectMatches,
  sourceInScope,
  evidenceInScope,
  evidenceScore,
  scopeEventSource,
  scopeSource,
  scopeSources,
  relevance,
  lightIndonesianStem
};
