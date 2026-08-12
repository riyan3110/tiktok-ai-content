const expanded = require('./autoSourceExpandedDiscovery');
const identity = require('./autoSourceTopicIdentity');

// TANPA URL / AUTO SOURCE ONLY.
// Generic topics keep the normal expanded discovery. Versioned model/product
// topics get one extra identity gate after article fetch so a broad search hit
// cannot inject an unrelated page into the final source set.

async function discover(options = {}) {
  const result = await expanded.discover(options);
  const topic = String(options.topic || result?.topic || '').trim();
  if (!identity.hasSpecificIdentity(topic)) return result;

  const sources = (result.sources || []).filter(source =>
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

module.exports = { discover };
