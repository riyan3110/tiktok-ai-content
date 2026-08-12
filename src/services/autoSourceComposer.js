const defaultContent = require('./content');
const defaultSourceUrlFinalizer = require('./sourceUrlFinalizer');

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
function numericGroundingErrors(content) {
  const errors = [];
  (content?.slides || []).forEach((slide, slideIndex) => {
    (slide?.claims || []).forEach((claim, claimIndex) => {
      const visible = numericConcepts(claim?.text);
      const evidence = numericConcepts(claim?.evidence);
      for (const concept of visible) {
        if (!evidence.has(concept)) errors.push(`AUTO_SOURCE_NUMERIC: slide:${slideIndex}:claim:${claimIndex} angka/ordinal "${concept}" tidak didukung evidence yang sama.`);
      }
    });
  });
  return [...new Set(errors)];
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
function validationErrors(contentService, generated, options, sources) {
  const errors = [];
  if (contentService.validateContent) errors.push(...contentService.validateContent(generated, { format: options.contentFormat, manualTopic: options.requestedTopic }));
  if (contentService.validateSourceGrounding) errors.push(...contentService.validateSourceGrounding(generated, options.sourceContext, sources));
  errors.push(...numericGroundingErrors(generated), ...genericCopyErrors(generated));
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

async function compose({ content = defaultContent, previousTopics = [], options = {}, sources = [], discovery = null, finalizer = defaultSourceUrlFinalizer } = {}) {
  if (!sources.length) throw Object.assign(new Error('Tidak ada sumber otomatis yang dapat dipakai.'), { status: 422 });
  const topic = String(options.requestedTopic || discovery?.topic || sources[0]?.title || 'Topik sumber').trim();
  let generated;
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

  let errors = initialFailure ? [`INITIAL_GENERATION: ${initialFailure.message}`] : validationErrors(content, generated, options, sources);
  const needsRecovery = Boolean(errors.length || generated?.verificationStatus === 'needs_review' || genericCopyErrors(generated).length);
  if (needsRecovery) {
    generated = await finalizer.rewriteAllSourcesWithAi({
      generated,
      sources,
      topic,
      format: options.contentFormat || 'Fakta singkat',
      mode: 'manual',
      contentService: content
    });
    errors = validationErrors(content, generated, options, sources);
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

module.exports = { compose, numericConcepts, numericGroundingErrors, genericCopyErrors, recoverySeed, validationErrors };
