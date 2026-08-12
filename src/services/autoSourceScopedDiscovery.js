const expanded = require('./autoSourceExpandedDiscovery');
const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');
const topicPlanner = require('./autoSourceDynamicTopicPlan');
const dynamicScope = require('./autoSourceDynamicScope');

// TANPA URL / AUTO SOURCE ONLY.
// The topic is interpreted fresh for every request. Search starts with the exact
// user text; only when those results are weak do we try one dynamically planned
// alternate query. No catalog of known/trending topics is required.

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

async function discover(options = {}) {
  const topic = String(options.topic || '').trim().replace(/\s+/g, ' ');
  if (!topic) throw Object.assign(new Error('Topik wajib diisi untuk pencarian sumber otomatis.'), { status: 400 });

  const plan = await topicPlanner.createPlan(topic, { client: options.topicPlannerClient });
  let result = await safeDiscover(options, topic);
  let baseSources = uniqueSources(result.sources || []).filter(source =>
    dynamicScope.sourceInScope(topic, source, plan)
  );

  // Keep the normal path cheap/fast. Only broaden dynamically when the exact
  // user query did not yield enough strong articles for a four-slide carousel.
  if (baseSources.length < 3) {
    const alternate = distinctAlternateQuery(topic, plan);
    if (alternate) {
      const extra = await safeDiscover(options, alternate);
      result = mergeBundle(result, extra);
      baseSources = uniqueSources(result.sources || []).filter(source =>
        dynamicScope.sourceInScope(topic, source, plan)
      );
    }
  }

  if (identity.hasSpecificIdentity(topic)) {
    const sources = baseSources.filter(source =>
      identity.identityMatches(topic, `${source?.title || ''} ${source?.text || ''}`)
    );
    if (!sources.length) {
      throw Object.assign(new Error('Sumber terbaru ditemukan, tetapi tidak ada artikel yang benar-benar membahas model/versi spesifik pada topik.'), {
        status: 422,
        code: 'AUTO_SOURCE_IDENTITY_SOURCE_EMPTY'
      });
    }
    return {
      ...result,
      topic,
      topicPlan: plan,
      sources,
      publishers: [...new Set(sources.map(source => source?.discovery?.publisher).filter(Boolean))]
    };
  }

  if (!multi.hasMultiEntityTopic(topic)) {
    if (!baseSources.length) {
      throw Object.assign(new Error('Sumber terbaru ditemukan, tetapi tidak ada artikel yang benar-benar membahas inti topik yang kamu masukkan.'), {
        status: 422,
        code: 'AUTO_SOURCE_DYNAMIC_SCOPE_EMPTY'
      });
    }
    return {
      ...result,
      topic,
      topicPlan: plan,
      sources: baseSources,
      publishers: [...new Set(baseSources.map(source => source?.discovery?.publisher).filter(Boolean))]
    };
  }

  const entities = multi.entities(topic);
  let sources = baseSources.filter(source =>
    entities.some(entity => multi.sourceStrongForEntity(source, entity))
  );
  const extraQueries = [];
  const extraProviders = [];

  let coverage = entityCoverage(sources, entities);
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

  const missing = entities.filter(entity => (coverage.get(entity) || 0) === 0);
  if (missing.length) {
    throw Object.assign(new Error(`Sumber terbaru ditemukan, tetapi belum ada artikel kuat untuk: ${missing.join(', ')}.`), {
      status: 422,
      code: 'AUTO_SOURCE_MULTI_ENTITY_SOURCE_EMPTY'
    });
  }

  return {
    ...result,
    topic,
    topicPlan: plan,
    sources: uniqueSources(sources),
    queries: [...new Set([...(result.queries || []), ...extraQueries])],
    providers: [...new Set([...(result.providers || []), ...extraProviders])],
    publishers: [...new Set(sources.map(source => source?.discovery?.publisher).filter(Boolean))]
  };
}

module.exports = {
  discover,
  uniqueSources,
  entityCoverage,
  distinctAlternateQuery,
  mergeBundle
};
