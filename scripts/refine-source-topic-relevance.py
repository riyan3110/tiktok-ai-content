from pathlib import Path

source_path = Path('src/services/sourceFilter.js')
text = source_path.read_text()

old = """const TOPIC_RELEVANCE_STOPWORDS = new Set([
  ...TOPIC_STOPWORDS,
  'ai', 'api', 'gpt', 'era', 'digital', 'teknologi', 'semakin', 'maju', 'baru',
  'fitur', 'rilis', 'resmi', 'cara', 'gunakan', 'menggunakan', 'buat', 'bisa', 'dapat'
]);
"""
new = old + """const NEUTRAL_RELEVANCE_TOKENS = new Set([
  'cek', 'baca', 'lihat', 'simpan', 'bandingkan', 'perhatikan', 'pelajari', 'periksa',
  'konteks', 'sumber', 'temuan', 'detail', 'bagian', 'relevan', 'utama', 'lengkap',
  'kesimpulan', 'menyimpulkan', 'membagikan', 'informasi', 'sebelum', 'setelah',
  'fokus', 'pilih', 'kebutuhan', 'pendekatan'
]);
"""
assert old in text, 'topic relevance constants not found'
text = text.replace(old, new, 1)

old = """function validateSlideTopicRelevance(manualTopic, slides = [], verifiedClaimFields = new Set()) {
  const terms = topicRelevanceTerms(manualTopic);
  if (!manualTopic || !terms.length) return [];
  const errors = [];
  slides.forEach((slide, index) => {
    const edgeSlide = index === 0 || index === slides.length - 1 || /^(?:PEMBUKA|HOOK|PENUTUP|CTA|TRANSISI)$/i.test(String(slide?.section || '').trim());
    if (edgeSlide) return;

    const fields = slideFields(slide, index);
    if (fields.some(field => verifiedClaimFields.has(field.key))) return;

    const visibleTokens = tokens(fields.map(field => field.value).join(' '));
    if (!terms.some(term => visibleTokens.has(term))) {
      errors.push(`Slide ${index + 1}: isi claim-free menyimpang dari inti topik manual; perbaiki agar tetap membahas ${manualTopic}.`);
    }
  });
  return errors;
}
"""
new = """function validateSlideTopicRelevance(manualTopic, slides = [], verifiedClaimFields = new Set()) {
  const terms = topicRelevanceTerms(manualTopic);
  if (!manualTopic || !terms.length) return [];
  const errors = [];
  slides.forEach((slide, index) => {
    const edgeSlide = index === 0 || index === slides.length - 1 || /^(?:PEMBUKA|HOOK|PENUTUP|CTA|TRANSISI)$/i.test(String(slide?.section || '').trim());
    if (edgeSlide) return;

    const fields = slideFields(slide, index);
    if (fields.some(field => verifiedClaimFields.has(field.key))) return;

    const visibleTokens = tokens(fields.map(field => field.value).join(' '));
    if (terms.some(term => visibleTokens.has(term))) return;

    // Neutral transition/source-reading copy is allowed without repeating the
    // topic. Reject only when the slide introduces several new content concepts
    // with no verified source claim, which is how unrelated prompt/batch/tool
    // advice previously slipped into source-backed carousels.
    const introducedSpecificTerms = [...visibleTokens].filter(token =>
      token.length > 2
      && !TOPIC_RELEVANCE_STOPWORDS.has(token)
      && !NEUTRAL_RELEVANCE_TOKENS.has(token)
      && !terms.includes(token)
    );
    if (introducedSpecificTerms.length >= 2) {
      errors.push(`Slide ${index + 1}: isi claim-free menyimpang dari inti topik manual; perbaiki agar tetap membahas ${manualTopic}.`);
    }
  });
  return errors;
}
"""
assert old in text, 'strict relevance function not found'
text = text.replace(old, new, 1)
source_path.write_text(text)

# Add a regression proving neutral middle slides remain allowed.
test_path = Path('test/source-filter-production-regressions.test.js')
tests = test_path.read_text()
marker = "test('Era efisiensi AI menolak slide tengah generik prompt dan batch automation'"
assert marker in tests, 'production relevance test marker not found'
neutral_test = r'''

test('slide tengah netral untuk cek konteks sumber tidak dianggap drift topik', () => {
  const slides = [
    { section: 'PEMBUKA', title: 'OpenAI dan Keselamatan AI', body: 'Cek konteks sumber terlebih dahulu.', points: [] },
    { section: 'POIN 1', title: 'Perhatikan konteks temuan', body: 'Bandingkan sumber sebelum membagikan.', points: [] },
    { section: 'PENUTUP', title: 'Baca sumber lengkapnya', body: 'Simpan poin yang paling relevan.', points: [] }
  ];
  assert.deepEqual(validateSlideTopicRelevance('OpenAI temukan resiko', slides, new Set()), []);
});

'''
tests = tests.replace(marker, neutral_test + marker, 1)
test_path.write_text(tests)
