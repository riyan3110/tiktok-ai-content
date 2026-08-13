const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');
const dynamicScope = require('./autoSourceDynamicScope');
const topicPlanner = require('./autoSourceDynamicTopicPlan');
const storyFocus = require('./autoSourceStoryFocus');
const simple = require('./autoSourceSimpleComposer');
const indonesianOutput = require('./autoSourceIndonesianOutput');

// TANPA URL / AUTO SOURCE ONLY.
// One production path for every free-form topic:
// accepted sources -> story facts -> simple writer -> fact-check/editor -> output.
// Scope is used to rank/trim facts, never to turn a readable relevant article
// into an empty generation merely because wording differs from the user query.

const VISIBLE_EDITORIAL_HYPE = /\b(?:(?:pembaruan|perubahan|transformasi)\s+(?:besar(?:-besaran)?|fundamental)|secara\s+fundamental\s+(?:mengubah|mengubah\s+pengalaman)|membayangkan\s+ulang\s+(?:cara|pengalaman)|visi\s+(?:navigasi\s+)?digital\s+baru|era\s+baru\s+(?:navigasi|digital)|reimag(?:e|ines|ined|ining)\s+(?:navigation|the\s+experience)|fundamentally\s+(?:changes?|reshapes?|reimagines?))\b/i;
const REQUIRED_DISTINCT_FACTS = 4;
const NEAR_DUPLICATE_SIMILARITY = 0.64;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function visibleEditorialHype(value = '', plan = {}) {
  const text = clean(value);
  if (!text) return false;
  const requested = storyFocus.requestedText(plan);
  return VISIBLE_EDITORIAL_HYPE.test(text) && !VISIBLE_EDITORIAL_HYPE.test(requested);
}

function normalizeFactSections(result, format = '') {
  if (String(format || '').toLocaleLowerCase('id-ID') !== 'fakta singkat') return result;
  if (!Array.isArray(result?.slides) || !result.slides[3]) return result;
  if (String(result.slides[3].section || '').trim().toLocaleUpperCase('id-ID') !== 'KESIMPULAN') return result;
  return {
    ...result,
    slides: result.slides.map((slide, index) => index === 3 ? { ...slide, section: 'FAKTA LANJUTAN' } : slide)
  };
}

function continuationFact(value = '') {
  return /^(?:it|this|that|these|those|its|their|users?|people|according\s+to\s+the\s+company|the\s+(?:option|feature|service|system|model|company|product|tool|reset|control|mechanism|technology|capability|policy|initiative|watermark|mark|signal)|ini|itu|mereka|pengguna|orang|menurut\s+perusahaan|fitur\s+ini|opsi\s+ini|layanan\s+ini|sistem\s+ini|model\s+ini|produk\s+ini|reset\s+ini|mekanisme\s+ini|teknologi\s+ini|kebijakan\s+ini)\b/i.test(clean(value));
}

function storySubjectAnchored(plan = {}, value = '') {
  const subjects = plan.subjects || [];
  const hits = dynamicScope.subjectHits(plan, value);
  if (!subjects.length) return true;
  const specific = subjects.filter(subject => dynamicScope.looseNormalize(subject).split(' ').filter(Boolean).length >= 2);
  if (!specific.length) return hits.length > 0;
  const hitKeys = new Set(hits.map(dynamicScope.looseNormalize));
  return specific.some(subject => hitKeys.has(dynamicScope.looseNormalize(subject)));
}

function hasSpecificStorySubject(plan = {}) {
  return (plan.subjects || []).some(subject =>
    dynamicScope.looseNormalize(subject).split(' ').filter(Boolean).length >= 2
  );
}

function factRelevant(topic = '', fact = '', plan = {}, previousKept = false, source = {}) {
  if (!fact
    || storyFocus.editorialNoise(fact, plan)
    || visibleEditorialHype(fact, plan)
    || storyFocus.marketSnapshot(fact, plan)) return false;
  if (previousKept && continuationFact(fact)) return true;

  if (identity.hasSpecificIdentity(topic)) return identity.identityMatches(topic, fact);
  if (multi.hasMultiEntityTopic(topic)) return multi.matchedEntities(topic, fact).length > 0;

  if (dynamicScope.eventLockRequired(plan)) {
    if (!dynamicScope.eventAlignedSource(plan, source)) return false;
    const eventRelated = dynamicScope.eventLockSatisfied(plan, fact)
      || dynamicScope.actionHits(plan, fact).length > 0
      || dynamicScope.contextHits(plan, fact).length > 0
      || dynamicScope.eventHits(plan, fact).length > 0;
    if (hasSpecificStorySubject(plan)) {
      return storySubjectAnchored(plan, fact)
        || (previousKept
          && continuationFact(fact)
          && !dynamicScope.introducesForeignNamedActor(plan, source, fact));
    }
    return (storySubjectAnchored(plan, fact) && eventRelated)
      || (previousKept && eventRelated && !dynamicScope.introducesForeignNamedActor(plan, source, fact));
  }

  if ((plan.subjects || []).length) return dynamicScope.subjectHits(plan, fact).length > 0;
  if ((plan.eventTerms || []).length) return dynamicScope.eventHits(plan, fact).length > 0;
  return true;
}

function titleAnchorsTopic(topic = '', source = {}, plan = {}) {
  if (identity.hasSpecificIdentity(topic) || multi.hasMultiEntityTopic(topic)) return false;
  const title = clean(source?.title || '');
  if (!title) return false;
  if (dynamicScope.eventLockRequired(plan)) return dynamicScope.eventLockSatisfied(plan, title);
  if ((plan.subjects || []).length) return dynamicScope.subjectHits(plan, title).length > 0;
  if ((plan.eventTerms || []).length) return dynamicScope.eventHits(plan, title).length > 0;
  return false;
}

function readableFacts(topic = '', source = {}, plan = {}) {
  const raw = storyFocus.atomicFacts(source?.text || '', plan).map(clean).filter(Boolean);
  const out = [];
  const anchoredLead = titleAnchorsTopic(topic, source, plan);
  let previousKept = false;
  for (let index = 0; index < raw.length; index += 1) {
    const fact = raw[index];
    let keep = factRelevant(topic, fact, plan, previousKept, source);
    // If the headline already anchors the topic, only a true pronoun/reference
    // continuation may borrow that headline context. Independent lead sentences
    // still need to match the topic themselves so market/roundup side-notes stay out.
    if (!keep && anchoredLead && index < 4 && continuationFact(fact)
      && !storyFocus.editorialNoise(fact, plan)
      && !visibleEditorialHype(fact, plan)
      && !storyFocus.marketSnapshot(fact, plan)) keep = true;
    if (keep) out.push(fact);
    previousKept = keep;
  }
  return out;
}

function eventNeighborhoodSource(topic = '', source = {}, plan = {}, maxFacts = 10) {
  const facts = readableFacts(topic, source, plan);
  if (!facts.length) return { ...source, text: '' };

  let selected = facts.slice(0, maxFacts);
  if (dynamicScope.eventLockRequired(plan) && facts.length > maxFacts) {
    let anchor = facts.findIndex(fact => dynamicScope.eventLockSatisfied(plan, fact));
    if (anchor < 0) anchor = facts.findIndex(fact =>
      dynamicScope.actionHits(plan, fact).length > 0 || dynamicScope.contextHits(plan, fact).length > 0
    );
    if (anchor < 0) anchor = 0;
    const start = Math.max(0, anchor - 1);
    selected = facts.slice(start, Math.min(facts.length, start + maxFacts));
  }

  return {
    ...source,
    text: selected.map(fact => /[.!?]$/.test(fact) ? fact : `${fact}.`).join(' '),
    autoSourceFallback: {
      mode: dynamicScope.eventLockRequired(plan) ? 'event-neighborhood' : 'article-lead',
      keptFactCount: selected.length
    }
  };
}

function factCount(topic = '', source = {}, plan = {}) {
  return readableFacts(topic, source, plan).length;
}

function keepOnlyReadableFacts(topic = '', source = {}, plan = {}) {
  const facts = readableFacts(topic, source, plan);
  return {
    ...source,
    text: facts.map(fact => /[.!?]$/.test(fact) ? fact : `${fact}.`).join(' ')
  };
}

function isSearchSnippet(source = {}) {
  return source?.discovery?.evidenceMode === 'search-snippet';
}

function distinctFactRows(topic = '', sources = [], count = REQUIRED_DISTINCT_FACTS) {
  const candidates = simple.buildFactCandidates(sources, topic);
  const selected = [];
  for (const candidate of candidates) {
    const duplicate = selected.some(existing => {
      if (simple.sameFactContext(existing.evidence, candidate.evidence, topic)) return true;
      const similarity = Math.max(
        simple.semanticSimilarity(existing.evidence, candidate.evidence, topic),
        simple.semanticSimilarity(existing.evidence, candidate.evidence)
      );
      return similarity >= NEAR_DUPLICATE_SIMILARITY;
    });
    if (duplicate) continue;
    selected.push(candidate);
    if (selected.length >= count) break;
  }
  return selected;
}

function distinctFactCount(topic = '', sources = [], count = REQUIRED_DISTINCT_FACTS) {
  return distinctFactRows(topic, sources, count).length;
}

function preparedVariant(topic = '', sources = [], plan = {}) {
  return sources
    .map(source => keepOnlyReadableFacts(topic, source, plan))
    .filter(source => clean(source?.text));
}

function prepareSources(topic = '', sources = [], plan = {}) {
  const scoped = dynamicScope.scopeSources(topic, sources, plan);
  const focused = storyFocus.focusSources(topic, scoped, plan);

  const focusedPrepared = sources.map((original, index) => {
    const current = focused[index] || { ...original, text: '' };
    const fallback = eventNeighborhoodSource(topic, original, plan);
    const currentCount = factCount(topic, current, plan);
    const fallbackCount = factCount(topic, fallback, plan);
    return currentCount >= 4 ? current : fallbackCount > currentCount ? fallback : current;
  }).map(source => keepOnlyReadableFacts(topic, source, plan)).filter(source => clean(source?.text));

  // Search snippets are a rescue mechanism, not a diversity quota. If readable
  // full articles already contain four substantively different facts, keep the
  // weaker snippet supplements out of the writer entirely.
  const fullArticleFocused = focusedPrepared.filter(source => !isSearchSnippet(source));
  if (distinctFactCount(topic, fullArticleFocused) >= REQUIRED_DISTINCT_FACTS) {
    return fullArticleFocused;
  }

  if (distinctFactCount(topic, focusedPrepared) >= REQUIRED_DISTINCT_FACTS) {
    return focusedPrepared;
  }

  // If focused text was too narrow, widen only inside the same discovery-approved
  // articles and keep every sentence behind the existing factRelevant gate.
  const fullArticleWide = preparedVariant(topic, sources.filter(source => !isSearchSnippet(source)), plan);
  if (distinctFactCount(topic, fullArticleWide) >= REQUIRED_DISTINCT_FACTS) {
    return fullArticleWide;
  }

  const allWide = preparedVariant(topic, sources, plan);
  return allWide;
}

async function compose(args = {}) {
  const topic = String(args?.options?.requestedTopic || args?.discovery?.topic || '').trim();
  const format = args?.options?.contentFormat || 'Fakta singkat';
  const plan = args?.discovery?.topicPlan || topicPlanner.fallbackPlan(topic);
  const usableSources = prepareSources(topic, args.sources || [], plan);

  if (!usableSources.length) {
    throw Object.assign(new Error('Auto Source tidak menemukan teks artikel yang dapat dipakai setelah sumber dibaca.'), {
      status: 422,
      code: 'AUTO_SOURCE_READABLE_FACTS_EMPTY'
    });
  }

  const uniqueFacts = distinctFactRows(topic, usableSources, REQUIRED_DISTINCT_FACTS);
  if (uniqueFacts.length < REQUIRED_DISTINCT_FACTS) {
    throw Object.assign(new Error(`Auto Source baru menemukan ${uniqueFacts.length} fakta yang benar-benar berbeda; sumber perlu dicari lagi sebelum menulis 4 slide.`), {
      status: 422,
      code: 'AUTO_SOURCE_DISTINCT_FACTS_EMPTY',
      distinctFactCount: uniqueFacts.length
    });
  }

  const scopedArgs = {
    ...args,
    sources: usableSources,
    discovery: args.discovery
      ? { ...args.discovery, sources: usableSources, topicPlan: plan }
      : { topic, sources: usableSources, topicPlan: plan }
  };

  const result = await simple.compose(scopedArgs);
  const languageSafe = await indonesianOutput.ensureIndonesian({
    result,
    topic,
    format,
    sources: usableSources,
    client: args.client
  });
  return normalizeFactSections(languageSafe, format);
}

module.exports = {
  compose,
  normalizeFactSections,
  continuationFact,
  storySubjectAnchored,
  hasSpecificStorySubject,
  factRelevant,
  titleAnchorsTopic,
  readableFacts,
  eventNeighborhoodSource,
  factCount,
  keepOnlyReadableFacts,
  isSearchSnippet,
  distinctFactRows,
  distinctFactCount,
  preparedVariant,
  prepareSources,
  visibleEditorialHype,
  REQUIRED_DISTINCT_FACTS,
  NEAR_DUPLICATE_SIMILARITY
};