const expanded = require('./autoSourceExpandedDiscovery');
const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');
const topicScope = require('./autoSourceTopicScope');

// TANPA URL / AUTO SOURCE ONLY.
// Every discovered article must first be strongly inside the requested topic.
// Versioned and multi-entity topics then receive their stricter existing gates.

function sourceUrl(source = {}) {
  return String(source?.finalUrl || source?.url || '').trim();
}

function uniqueSources(sources = [], limit = 6) {
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

async function discover(options = {}) {
  const result = await expanded.discover(options);
  const topic = String(options.topic || result?.topic || '').trim();
  const baseSources = (result.sources || []).filter(source => topicScope.sourceInScope(topic, source));

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
      sources,
      publishers: sources.map(source => source?.discovery?.publisher).filter(Boolean)
    };
  }

  if (!multi.hasMultiEntityTopic(topic)) {
    if (!baseSources.length) {
      throw Object.assign(new Error('Sumber terbaru ditemukan, tetapi tidak ada artikel yang cukup kuat membahas inti topik.'), {
        status: 422,
        code: 'AUTO_SOURCE_TOPIC_SCOPE_EMPTY'
      });
    }
    return {
      ...result,
      topic,
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
    sources: uniqueSources(sources),
    queries: [...new Set([...(result.queries || []), ...extraQueries])],
    providers: [...new Set([...(result.providers || []), ...extraProviders])],
    publishers: [...new Set(sources.map(source => source?.discovery?.publisher).filter(Boolean))]
  };
}

module.exports = {
  discover,
  uniqueSources,
  entityCoverage
};
