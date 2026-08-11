const defaultContent = require('./content');

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
function validationErrors(contentService, generated, options, sources) {
  const errors = [];
  if (contentService.validateContent) errors.push(...contentService.validateContent(generated, { format: options.contentFormat, manualTopic: options.requestedTopic }));
  if (contentService.validateSourceGrounding) errors.push(...contentService.validateSourceGrounding(generated, options.sourceContext, sources));
  errors.push(...numericGroundingErrors(generated));
  return [...new Set(errors)];
}

async function compose({ content = defaultContent, previousTopics = [], options = {}, sources = [], discovery = null } = {}) {
  if (!sources.length) throw Object.assign(new Error('Tidak ada sumber otomatis yang dapat dipakai.'), { status: 422 });
  const generated = await content.generateContent(previousTopics, {
    ...options,
    topicSource: 'manual',
    useSources: true,
    sources,
    deferSourceGroundingValidation: false
  });
  const errors = validationErrors(content, generated, options, sources);
  if (errors.length) throw Object.assign(new Error(`Konten dari sumber otomatis belum lolos validasi: ${errors[0].replace(/^SOURCE_GROUNDING:\s*/, '')}`), { status: 422, validationErrors: errors });
  generated.verificationStatus = generated.verificationStatus === 'needs_review' ? 'needs_review' : 'source_based';
  if (!Array.isArray(generated.unsupportedClaims)) generated.unsupportedClaims = [];
  generated.sourceMode = 'auto';
  if (discovery) generated.sourceDiscovery = {
    searchedAt: discovery.searchedAt,
    queries: discovery.queries || [],
    providers: discovery.providers || []
  };
  return generated;
}

module.exports = { compose, numericConcepts, numericGroundingErrors, validationErrors };
