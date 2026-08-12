const dynamicScope = require('./autoSourceDynamicScope');
const topicPlanner = require('./autoSourceDynamicTopicPlan');
const storyFocus = require('./autoSourceStoryFocus');
const simple = require('./autoSourceSimpleComposer');

// TANPA URL / AUTO SOURCE ONLY.
// One production path for every free-form topic:
// accepted sources -> story facts -> simple writer -> fact-check/editor -> output.
// Scope is used to rank/trim facts, never to turn a readable relevant article
// into an empty generation merely because wording differs from the user query.

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function readableFacts(source = {}, plan = {}) {
  return storyFocus.atomicFacts(source?.text || '')
    .map(clean)
    .filter(Boolean)
    .filter(fact => !storyFocus.editorialNoise(fact, plan));
}

function eventNeighborhoodSource(topic = '', source = {}, plan = {}, maxFacts = 10) {
  const facts = readableFacts(source, plan);
  if (!facts.length) return { ...source, text: '' };

  const selected = [];
  const push = fact => {
    if (!fact || selected.includes(fact) || selected.length >= maxFacts) return;
    selected.push(fact);
  };

  if (!dynamicScope.eventLockRequired(plan)) {
    facts.slice(0, maxFacts).forEach(push);
  } else {
    const titleLocked = dynamicScope.eventLockSatisfied(plan, source?.title || '');
    let anchor = titleLocked ? 0 : facts.findIndex(fact => dynamicScope.eventLockSatisfied(plan, fact));
    if (anchor < 0) {
      anchor = facts.findIndex(fact =>
        dynamicScope.actionHits(plan, fact).length > 0 || dynamicScope.contextHits(plan, fact).length > 0
      );
    }
    if (anchor < 0) anchor = 0;

    // Keep a compact event core. Four lead facts are enough to build four slides
    // without swallowing a separate news item pasted later in the same article.
    const coreStart = Math.max(0, anchor - (titleLocked ? 0 : 1));
    const coreEnd = Math.min(facts.length, coreStart + 4);
    facts.slice(coreStart, coreEnd).forEach(push);

    for (let index = coreEnd; index < facts.length && selected.length < maxFacts; index += 1) {
      const fact = facts[index];
      const eventRelated = dynamicScope.eventLockSatisfied(plan, fact)
        || dynamicScope.contextHits(plan, fact).length > 0;
      const continuation = /^(?:it|this|that|these|those|the\s+(?:option|feature|service|system|model|company)|ini|itu|fitur\s+ini|opsi\s+ini|layanan\s+ini|sistem\s+ini|model\s+ini)\b/i.test(fact);
      if (eventRelated || continuation) push(fact);
    }
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

function factCount(source = {}, plan = {}) {
  return readableFacts(source, plan).length;
}

function prepareSources(topic = '', sources = [], plan = {}) {
  const scoped = dynamicScope.scopeSources(topic, sources, plan);
  const focused = storyFocus.focusSources(topic, scoped, plan);

  const prepared = sources.map((original, index) => {
    const current = focused[index] || { ...original, text: '' };
    const fallback = eventNeighborhoodSource(topic, original, plan);
    // Prefer tightly focused text when it still contains enough material.
    // Otherwise keep the factual neighborhood from the already-accepted article.
    return factCount(current, plan) >= 4 ? current
      : factCount(fallback, plan) > factCount(current, plan) ? fallback
        : current;
  }).filter(source => clean(source?.text));

  const totalFacts = prepared.reduce((sum, source) => sum + factCount(source, plan), 0);
  if (totalFacts >= 4) return prepared;

  // Last factual rescue: use clean leads from the same discovery-approved
  // articles. This does not broaden to unrelated search results or external facts.
  return sources
    .map(source => eventNeighborhoodSource(topic, source, plan, 14))
    .filter(source => clean(source?.text));
}

async function compose(args = {}) {
  const topic = String(args?.options?.requestedTopic || args?.discovery?.topic || '').trim();
  const plan = args?.discovery?.topicPlan || topicPlanner.fallbackPlan(topic);
  const usableSources = prepareSources(topic, args.sources || [], plan);

  if (!usableSources.length) {
    throw Object.assign(new Error('Auto Source tidak menemukan teks artikel yang dapat dipakai setelah sumber dibaca.'), {
      status: 422,
      code: 'AUTO_SOURCE_READABLE_FACTS_EMPTY'
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
  return normalizeFactSections(result, args?.options?.contentFormat || 'Fakta singkat');
}

module.exports = {
  compose,
  normalizeFactSections,
  readableFacts,
  eventNeighborhoodSource,
  factCount,
  prepareSources
};
