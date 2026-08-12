const expanded = require('./autoSourceExpandedDiscovery');
const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');
const topicPlanner = require('./autoSourceDynamicTopicPlan');
const dynamicScope = require('./autoSourceDynamicScope');

// TANPA URL / AUTO SOURCE ONLY.
// Search starts from the exact free-form topic typed by the user. Strict scope is
// preferred, but it is a ranking signal rather than a reason to destroy a valid
// generation. If strict sentence-level wording misses a real article, fall back
// to sources that still contain the requested subject + event context.

function sourceUrl(source = {}) {
  return String(source?.finalUrl || source?.url || '').trim();
}

function uniqueSources(sources = [], limit = 8) {
  const seen = new Set();
  const out = [];
  for (const source of sources) {
    const key = sourceUrl(source);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(source);
    if (out.length >= limit) break;
  }
  return out;
}

function entityCoverage(sources = [], entities = []) {
  return new Map(entities.map(entity => [
    entity,
    sources.filter(source => multi.sourceStrongForEntity(source, entity)).length
  ]));
}

function distinctAlternateQuery(topic, plan = {}) {
  const normalize = value => String(value || '').toLocaleLowerCase('id-ID').replace(/\s+/g, ' ').trim();
  const original = normalize(topic);
  return (plan.searchQueries || []).find(query => {
    const value = normalize(query);
    return value && value !== original && value !== `${original} terbaru` && value !== `${original} latest`;
  }) || '';
}

function mergeBundle(base, extra) {
  if (!extra) return base;
  return {
    ...base,
    sources: uniqueSources([...(base?.sources || []), ...(extra.sources || [])]),
    queries: [...new Set([...(base?.queries || []), ...(extra.queries || [])])],
    providers: [...new Set([...(base?.providers || []), ...(extra.providers || [])])],
    publishers: [...new Set([...(base?.publishers || []), ...(extra.publishers || [])])]
  };
}

async function safeDiscover(options, topic) {
  try {
    return await expanded.discover({ ...options, topic });
  } catch (error) {
    return { topic, sources: [], queries: [], providers: [], publishers: [], discoveryError: error.message };
  }
}

function softSourceScore(topic = '', source = {}, plan = {}) {
  const title = String(source?.title || '');
  const text = String(source?.text || '').slice(0, 12000);
  const combined = `${title} ${text}`;
  const subjects = plan.subjects || [];
  const contexts = plan.contextTerms || [];
  const subjectHits = dynamicScope.subjectHits(plan, combined).length;
  const actionHits = dynamicScope.actionHits(plan, combined).length;
  const contextHits = dynamicScope.contextHits(plan, combined).length;
  const eventHits = dynamicScope.eventHits(plan, combined).length;

  // Version/model identity never becomes soft. Relax only the placement of event
  // wording inside an article, not which model/version the article is about.
  if (identity.hasSpecificIdentity(topic) && !identity.identityMatches(topic, combined)) return -1;

  // Event-shaped topics still need the same event ingredients. The relaxed
  // fallback merely allows those ingredients to appear across the article
  // instead of requiring them in one exact sentence/pair.
  if (dynamicScope.eventLockRequired(plan)) {
    if (subjects.length && !subjectHits) return -1;
    if (!actionHits) return -1;
    if (contexts.length && !contextHits) return -1;
  } else if (subjects.length && !subjectHits) {
    return -1;
  } else if (!subjects.length && (plan.eventTerms || []).length && !eventHits) {
    return -1;
  }

  const titleValue = `${title}`;
  const titleSubjects = dynamicScope.subjectHits(plan, titleValue).length;
  const titleActions = dynamicScope.actionHits(plan, titleValue).length;
  const titleContexts = dynamicScope.contextHits(plan, titleValue).length;
  return dynamicScope.relevance(plan, combined)
    + subjectHits * 0.35
    + actionHits * 0.45
    + contextHits * 0.3
    + eventHits * 0.2
    + titleSubjects * 0.8
    + titleActions * 0.6
    + titleContexts * 0.45
    + Math.min(0.5, Math.max(0, Number(source?.discovery?.score || 0)) * 0.01);
}

function softRelevantSources(topic = '', sources = [], plan = {}, limit = 6) {
  return uniqueSources(sources, 12)
    .map((source, order) => ({ source, order, score: softSourceScore(topic, source, plan) }))
    .filter(row => row.score >= 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(row => row.source);
}

async function discover(options = {}) {
  const topic = String(options.topic || '').trim().replace(/\s+/g, ' ');
  if (!topic) throw Object.assign(new Error('Topik wajib diisi untuk pencarian sumber otomatis.'), { status: 400 });

  let plan = topicPlanner.fallbackPlan(topic);
  let result = await safeDiscover(options, topic);
  let baseSources = uniqueSources(result.sources || []).filter(source =>
    dynamicScope.sourceInScope(topic, source, plan)
  );
  let scopeMode = baseSources.length ? 'strict' : 'none';

  // If the literal Indonesian wording is too narrow, ask the configured model
  // once for a same-event alternate/global query. This remains a search rescue,
  // not another content-generation loop.
  if (!baseSources.length) {
    plan = await topicPlanner.createPlan(topic, { client: options.topicPlannerClient });
    baseSources = uniqueSources(result.sources || []).filter(source =>
      dynamicScope.sourceInScope(topic, source, plan)
    );
    if (baseSources.length) scopeMode = 'strict-ai-plan';

    const alternate = distinctAlternateQuery(topic, plan);
    if (!baseSources.length && alternate) {
      const extra = await safeDiscover(options, alternate);
      result = mergeBundle(result, extra);
      baseSources = uniqueSources(result.sources || []).filter(source =>
        dynamicScope.sourceInScope(topic, source, plan)
      );
      if (baseSources.length) scopeMode = 'strict-alternate';
    }
  }

  // FAIL-SOFT: never turn a valid search into a 422 merely because the strict
  // wording matcher could not place action/context in the same sentence. The
  // relaxed fallback still requires the same subject/event ingredients.
  if (!baseSources.length) {
    baseSources = softRelevantSources(topic, result.sources || [], plan);
    if (baseSources.length) scopeMode = 'soft-relevant';
  }

  if (!baseSources.length) {
    throw Object.assign(new Error('Auto Source belum menemukan artikel yang cukup relevan dan dapat dibaca untuk topik ini.'), {
      status: 422,
      code: 'AUTO_SOURCE_RELEVANT_SOURCE_EMPTY'
    });
  }

  if (identity.hasSpecificIdentity(topic)) {
    const exactIdentity = baseSources.filter(source =>
      identity.identityMatches(topic, `${source?.title || ''} ${source?.text || ''}`)
    );
    if (exactIdentity.length) baseSources = exactIdentity;
  }

  if (multi.hasMultiEntityTopic(topic)) {
    const entities = multi.entities(topic);
    let sources = baseSources.filter(source =>
      entities.some(entity => multi.sourceStrongForEntity(source, entity))
    );
    if (!sources.length) sources = [...baseSources];

    const extraQueries = [];
    const extraProviders = [];
    let coverage = entityCoverage(sources, entities);

    // Try to balance coverage, but missing one entity is no longer a generation
    // failure. The writer still receives the best verified facts we actually found.
    for (const entity of entities) {
      if ((coverage.get(entity) || 0) > 0) continue;
      try {
        const targeted = await expanded.discover({ ...options, topic: entity });
        extraQueries.push(...(targeted.queries || []));
        extraProviders.push(...(targeted.providers || []));
        sources = uniqueSources([
          ...sources,
          ...(targeted.sources || []).filter(source => multi.sourceStrongForEntity(source, entity))
        ]);
        coverage = entityCoverage(sources, entities);
      } catch {}
    }

    return {
      ...result,
      topic,
      topicPlan: plan,
      scopeMode,
      sources: uniqueSources(sources.length ? sources : baseSources),
      queries: [...new Set([...(result.queries || []), ...extraQueries])],
      providers: [...new Set([...(result.providers || []), ...extraProviders])],
      publishers: [...new Set((sources.length ? sources : baseSources).map(source => source?.discovery?.publisher).filter(Boolean))]
    };
  }

  return {
    ...result,
    topic,
    topicPlan: plan,
    scopeMode,
    sources: baseSources,
    publishers: [...new Set(baseSources.map(source => source?.discovery?.publisher).filter(Boolean))]
  };
}

module.exports = {
  discover,
  uniqueSources,
  entityCoverage,
  distinctAlternateQuery,
  mergeBundle,
  softSourceScore,
  softRelevantSources
};
