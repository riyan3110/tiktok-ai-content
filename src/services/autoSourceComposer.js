const defaultContent = require('./content');
const defaultAutoSourceFinalizer = require('./autoSourceFinalizer');
const autoSourceValidation = require('./autoSourceValidation');
const { sourceFacts } = require('./manualSourceFallback');

const NUMBER_WORDS = new Map([
  ['nol','0'],['zero','0'],['satu','1'],['one','1'],['pertama','1'],['first','1'],
  ['dua','2'],['two','2'],['kedua','2'],['second','2'],['tiga','3'],['three','3'],['ketiga','3'],['third','3'],
  ['empat','4'],['four','4'],['keempat','4'],['fourth','4'],['lima','5'],['five','5'],['kelima','5'],['fifth','5'],
  ['enam','6'],['six','6'],['keenam','6'],['sixth','6'],['tujuh','7'],['seven','7'],['ketujuh','7'],['seventh','7'],
  ['delapan','8'],['eight','8'],['kedelapan','8'],['eighth','8'],['sembilan','9'],['nine','9'],['kesembilan','9'],['ninth','9'],
  ['sepuluh','10'],['ten','10'],['kesepuluh','10'],['tenth','10'],['sebelas','11'],['eleven','11'],['kesebelas','11'],['eleventh','11'],
  ['dua belas','12'],['twelve','12'],['kedua belas','12'],['twelfth','12'],
  ['ratus','hundred'],['hundred','hundred'],['ribu','thousand'],['thousand','thousand'],
  ['juta','million'],['million','million'],['miliar','billion'],['billion','billion'],['triliun','trillion'],['trillion','trillion']
]);

const GENERIC_COPY_PATTERNS = [
  /\bfakta utama tentang\b/i,
  /\bfakta berikutnya tentang\b/i,
  /\bsumber membahas fakta tentang\b/i,
  /\blanjut baca tentang\b/i,
  /\bcek konteks lengkapnya\b/i,
  /\bringkasan sumber tentang\b/i,
  /\bkonten dibangun dari fakta sumber\b/i
];

function normalize(value) { return String(value || '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9%.,\s-]/g, ' ').replace(/\s+/g, ' ').trim(); }
function numericConcepts(value) {
  const raw = String(value || '');
  const concepts = new Set((raw.match(/\b\d+(?:[.,]\d+)?%?/g) || []).map(number => number.replace(/(?<=\d),(?=\d)/g, '.')));
  const normalized = normalize(raw);
  for (const [word, concept] of NUMBER_WORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(normalized)) concepts.add(concept);
  }
  return concepts;
}
function numericGroundingErrors(content, sources = []) {
  return autoSourceValidation.numericGroundingErrors(content, sources);
}
function genericCopyErrors(content) {
  const errors = [];
  (content?.slides || []).forEach((slide, slideIndex) => {
    const fields = [slide?.title, slide?.body, ...(Array.isArray(slide?.points) ? slide.points : [])].filter(Boolean);
    if (fields.some(value => GENERIC_COPY_PATTERNS.some(pattern => pattern.test(String(value))))) {
      errors.push(`AUTO_SOURCE_GENERIC: slide ${slideIndex + 1} masih memakai copy placeholder/fallback.`);
    }
  });
  return errors;
}

// AUTO SOURCE / TANPA URL ONLY.
// The resilient/strict finalizer has its own duplicate contract. Before the
// final composer handoff, normalize any overlong bullet with the existing
// deterministic Auto Source helper so the generic save validator cannot
// reintroduce an already-recoverable >7-word point error.
function prepareFinalAutoSourceOutput(generated) {
  return defaultAutoSourceFinalizer.compactOverlongPoints(generated);
}

function validationErrors(contentService, generated, options, sources, finalizer = defaultAutoSourceFinalizer) {
  generated = prepareFinalAutoSourceOutput(generated);
  let errors = [];

  // Keep generic structural/layout validation, but disable its legacy
  // duplicateSlideCopy gate for Auto Source. Auto Source already runs the
  // dedicated semantic-aware duplicate contract below and in its finalizer.
  if (contentService.validateContent) errors.push(...contentService.validateContent(generated, {
    format: options.contentFormat,
    manualTopic: options.requestedTopic,
    validateCopy: false
  }));
  if (contentService.validateSourceGrounding) errors.push(...contentService.validateSourceGrounding(generated, options.sourceContext, sources));

  errors.push(
    ...numericGroundingErrors(generated, sources),
    ...genericCopyErrors(generated),
    ...autoSourceValidation.autoSourceStructureErrors(generated)
  );
  if (finalizer?.richnessErrors) errors.push(...finalizer.richnessErrors(generated, sourceFacts(sources)));
  if (finalizer?.filterFalsePositiveMetadataErrors) errors = finalizer.filterFalsePositiveMetadataErrors(errors, generated);
  errors = autoSourceValidation.filterFalsePositives(errors, generated);
  return [...new Set(errors)];
}

function recoverySeed(topic, format = 'Fakta singkat') {
  const structures = {
    'Tutorial langkah': ['PEMBUKA', 'LANGKAH 1', 'LANGKAH 2', 'HASIL/PENUTUP'],
    'Masalah dan solusi': ['MASALAH', 'SOLUSI', 'SOLUSI', 'PENUTUP'],
    'Fakta singkat': ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'],
    Listicle: ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4'],
    'Tips cepat': ['PEMBUKA', 'TIPS 1', 'TIPS 2', 'PENUTUP'],
    'Before-after': ['BEFORE', 'PERUBAHAN', 'AFTER', 'PENUTUP']
  };
  const sections = structures[format] || structures['Fakta singkat'];
  return {
    focus: { masalah: topic, penyebab: topic, solusi: topic, hasil: topic },
    topic,
    hook: topic,
    body: topic,
    caption: topic,
    hashtags: [],
    cta: topic,
    trendKeywordsUsed: [],
    content_angle: `fakta sumber tentang ${topic}`,
    primary_tool: 'tanpa tool',
    hook_pattern: 'source-grounded',
    verificationStatus: 'needs_review',
    unsupportedClaims: [],
    slides: sections.map(section => ({ section, title: topic, body: '', points: [], claims: [] }))
  };
}

async function compose({ content = defaultContent, previousTopics = [], options = {}, sources = [], discovery = null, finalizer = defaultAutoSourceFinalizer } = {}) {
  if (!sources.length) throw Object.assign(new Error('Tidak ada sumber otomatis yang dapat dipakai.'), { status: 422 });
  const topic = String(options.requestedTopic || discovery?.topic || sources[0]?.title || 'Topik sumber').trim();
  let generated;
  let errors = [];

  if (options.fastAutoSource === true) {
    generated = recoverySeed(topic, options.contentFormat);
    generated = await finalizer.rewriteAllSourcesWithAi({
      generated,
      sources,
      topic,
      format: options.contentFormat || 'Fakta singkat',
      contentService: content
    });
    generated = prepareFinalAutoSourceOutput(generated);
    errors = validationErrors(content, generated, options, sources, finalizer);
  } else {
    let initialFailure = null;
    try {
      generated = await content.generateContent(previousTopics, {
        ...options,
        topicSource: 'manual',
        useSources: true,
        sources,
        deferSourceGroundingValidation: false
      });
    } catch (error) {
      initialFailure = error;
      generated = recoverySeed(topic, options.contentFormat);
    }

    errors = initialFailure ? [`INITIAL_GENERATION: ${initialFailure.message}`] : validationErrors(content, generated, options, sources, finalizer);
    const needsRecovery = Boolean(errors.length || generated?.verificationStatus === 'needs_review' || genericCopyErrors(generated).length);
    if (needsRecovery) {
      generated = await finalizer.rewriteAllSourcesWithAi({
        generated,
        sources,
        topic,
        format: options.contentFormat || 'Fakta singkat',
        contentService: content
      });
      generated = prepareFinalAutoSourceOutput(generated);
      errors = validationErrors(content, generated, options, sources, finalizer);
    }
  }

  if (errors.length) throw Object.assign(new Error(`Konten dari sumber otomatis belum lolos validasi: ${errors[0].replace(/^SOURCE_GROUNDING:\s*/, '')}`), { status: 422, validationErrors: errors });
  generated.verificationStatus = 'source_based';
  generated.unsupportedClaims = [];
  generated.sourceMode = 'auto';
  if (discovery) generated.sourceDiscovery = {
    searchedAt: discovery.searchedAt,
    queries: discovery.queries || [],
    providers: discovery.providers || []
  };
  return generated;
}

module.exports = {
  compose,
  numericConcepts,
  numericGroundingErrors,
  genericCopyErrors,
  recoverySeed,
  validationErrors,
  prepareFinalAutoSourceOutput
};
