from pathlib import Path

# 1) Preserve manual topic mode while allowing sourceFilter to bypass only the
# legacy literal manual-topic validator.
content_path = Path('src/services/content.js')
content = content_path.read_text()
old = "const manualTopic = options.topicSource === 'manual' ? options.requestedTopic : '';"
new = "const manualTopic = options.topicSource === 'manual' && options.skipManualTopicValidation !== true ? options.requestedTopic : '';"
assert old in content, 'content.js manualTopic marker not found'
content = content.replace(old, new, 1)
content_path.write_text(content)

# 2) Keep source-filter base generation in MANUAL mode and add a relevance guard
# for claim-free middle slides.
source_path = Path('src/services/sourceFilter.js')
text = source_path.read_text()

old = "const GENERIC_ENTITY_TOKENS = new Set(['ai', 'api', 'gpt']);\n"
new = old + """const TOPIC_RELEVANCE_STOPWORDS = new Set([
  ...TOPIC_STOPWORDS,
  'ai', 'api', 'gpt', 'era', 'digital', 'teknologi', 'semakin', 'maju', 'baru',
  'fitur', 'rilis', 'resmi', 'cara', 'gunakan', 'menggunakan', 'buat', 'bisa', 'dapat'
]);
"""
assert old in text, 'generic entity marker not found'
text = text.replace(old, new, 1)

marker = """function validateManualTopicIdentity(manualTopic, slides = []) {
"""
insert = """function topicRelevanceTerms(manualTopic) {
  const entityTerms = topicEntityTokens(manualTopic).filter(token => !GENERIC_ENTITY_TOKENS.has(token));
  if (entityTerms.length) return entityTerms;
  return [...tokens(manualTopic)].filter(token => token.length > 2 && !TOPIC_RELEVANCE_STOPWORDS.has(token));
}

function validateSlideTopicRelevance(manualTopic, slides = [], verifiedClaimFields = new Set()) {
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

""" + marker
assert marker in text, 'manual identity marker not found'
text = text.replace(marker, insert, 1)

old = """  const claims = normalizeClaims(candidate.slides);
  const claimByField = new Map();
  for (const claim of claims) {
    if (!claim.field || !claim.text || !claim.sourceId || !claim.evidence) {
      errors.push('Claim verifier tidak lengkap.');
      continue;
    }
    if (!maps.has(claim.sourceId)) {
      errors.push(`Claim memakai sourceId yang tidak tersedia: ${claim.sourceId}.`);
      continue;
    }
    const evidenceNorm = normalize(claim.evidence);
    if (!evidenceNorm || !maps.get(claim.sourceId).includes(evidenceNorm)) {
      errors.push(`Evidence tidak ditemukan pada ${claim.sourceId}.`);
      continue;
    }
    if (words(claim.evidence).length < 4 || words(claim.evidence).length > 32) errors.push('Evidence harus 4–32 kata.');
    const claimNumbers = numericTokens(claim.text);
    const evidenceNumbers = new Set(numericTokens(claim.evidence));
    if (!claimNumbers.every(number => evidenceNumbers.has(number))) errors.push(`Angka pada claim tidak didukung evidence: ${claim.text}.`);
    if (claimByField.has(claim.field)) errors.push(`Field ${claim.field} memiliki claim ganda.`);
    claimByField.set(claim.field, claim);
  }
"""
new = """  const claims = normalizeClaims(candidate.slides);
  const claimByField = new Map();
  const verifiedClaimFields = new Set();
  for (const claim of claims) {
    let validClaim = true;
    if (!claim.field || !claim.text || !claim.sourceId || !claim.evidence) {
      errors.push('Claim verifier tidak lengkap.');
      continue;
    }
    if (!maps.has(claim.sourceId)) {
      errors.push(`Claim memakai sourceId yang tidak tersedia: ${claim.sourceId}.`);
      validClaim = false;
    }
    const evidenceNorm = normalize(claim.evidence);
    if (!evidenceNorm || !maps.get(claim.sourceId)?.includes(evidenceNorm)) {
      errors.push(`Evidence tidak ditemukan pada ${claim.sourceId}.`);
      validClaim = false;
    }
    if (words(claim.evidence).length < 4 || words(claim.evidence).length > 32) {
      errors.push('Evidence harus 4–32 kata.');
      validClaim = false;
    }
    const claimNumbers = numericTokens(claim.text);
    const evidenceNumbers = new Set(numericTokens(claim.evidence));
    if (!claimNumbers.every(number => evidenceNumbers.has(number))) {
      errors.push(`Angka pada claim tidak didukung evidence: ${claim.text}.`);
      validClaim = false;
    }
    if (claimByField.has(claim.field)) {
      errors.push(`Field ${claim.field} memiliki claim ganda.`);
      validClaim = false;
    }
    claimByField.set(claim.field, claim);
    if (validClaim) verifiedClaimFields.add(claim.field);
  }
"""
assert old in text, 'claims validation block not found'
text = text.replace(old, new, 1)

old = """  candidate.slides.forEach((slide, slideIndex) => {
    for (const field of slideFields(slide, slideIndex)) {
      if (!field.value) continue;
      const needsEvidence = requiresEvidence(field.value, slide.section, field.kind);
      const claim = claimByField.get(field.key);
      if (needsEvidence && !claim) errors.push(`${field.key}: klaim faktual tidak memiliki evidence.`);
      if (claim && normalize(claim.text) !== normalize(field.value)) errors.push(`${field.key}: claim.text tidak sama dengan copy field.`);
    }
  });

  const verified = {
"""
new = """  candidate.slides.forEach((slide, slideIndex) => {
    for (const field of slideFields(slide, slideIndex)) {
      if (!field.value) continue;
      const needsEvidence = requiresEvidence(field.value, slide.section, field.kind);
      const claim = claimByField.get(field.key);
      if (needsEvidence && !claim) errors.push(`${field.key}: klaim faktual tidak memiliki evidence.`);
      if (claim && normalize(claim.text) !== normalize(field.value)) errors.push(`${field.key}: claim.text tidak sama dengan copy field.`);
    }
  });
  errors.push(...validateSlideTopicRelevance(manualTopic, candidate.slides, verifiedClaimFields));

  const verified = {
"""
assert old in text, 'field validation tail not found'
text = text.replace(old, new, 1)

old = """- Pertahankan gaya natural ORIGINAL_CONTENT sebanyak mungkin.
- SEMUA COPY YANG TAMPIL (title, body, points) WAJIB Bahasa Indonesia natural. Istilah brand/produk/AI/API boleh tetap asli, tetapi jangan salin kalimat bahasa Inggris dari sumber ke copy tampil.
"""
new = """- Pertahankan gaya natural ORIGINAL_CONTENT sebanyak mungkin.
- SETIAP slide wajib tetap berada pada inti TOPIK REFERENSI dan tema FACT_BANK. Dilarang memperkenalkan tutorial, tool, workflow, prompting, otomatisasi, strategi, atau saran baru yang tidak benar-benar terkait dengan topik/sumber hanya untuk mengisi slide.
- Jika CURRENT_DRAFT punya slide generik atau menyimpang, tulis ulang slide itu memakai fakta/sudut yang relevan dari FACT_BANK; jangan mempertahankan isi generik hanya karena non-faktual.
- SEMUA COPY YANG TAMPIL (title, body, points) WAJIB Bahasa Indonesia natural. Istilah brand/produk/AI/API boleh tetap asli, tetapi jangan salin kalimat bahasa Inggris dari sumber ke copy tampil.
"""
assert old in text, 'prompt relevance marker not found'
text = text.replace(old, new, 1)

old = """- Jika error sebelumnya menyebut copy tampil harus Bahasa Indonesia, terjemahkan/parafrase FIELD PERSIS itu ke Bahasa Indonesia natural tanpa menambah fakta; evidence claim tetap kutipan asli FACT_BANK.
- Jika error sebelumnya menyebut slide:X:... klaim faktual tidak memiliki evidence, wajib lakukan salah satu: tambahkan claim untuk FIELD PERSIS itu memakai satu evidence FACT_BANK yang benar-benar mendukung, atau ubah field tersebut menjadi copy non-faktual yang akurat. Jangan kembalikan field faktual yang sama tanpa claim.
"""
new = """- Jika error sebelumnya menyebut copy tampil harus Bahasa Indonesia, terjemahkan/parafrase FIELD PERSIS itu ke Bahasa Indonesia natural tanpa menambah fakta; evidence claim tetap kutipan asli FACT_BANK.
- Jika error sebelumnya menyebut slide claim-free menyimpang dari inti topik manual, tulis ulang slide itu agar langsung terkait dengan TOPIK REFERENSI dan FACT_BANK. Jangan menggantinya dengan tips AI generik.
- Jika error sebelumnya menyebut slide:X:... klaim faktual tidak memiliki evidence, wajib lakukan salah satu: tambahkan claim untuk FIELD PERSIS itu memakai satu evidence FACT_BANK yang benar-benar mendukung, atau ubah field tersebut menjadi copy non-faktual yang akurat. Jangan kembalikan field faktual yang sama tanpa claim.
"""
assert old in text, 'retry relevance marker not found'
text = text.replace(old, new, 1)

old = """  // The legacy manual-topic validator is a literal token-overlap gate. Keep the
  // requested topic in generation, but let the source verifier perform the
  // entity-aware final topic check instead of that older hard gate.
  const baseTopicSource = options.topicSource === 'manual' ? 'trending' : options.topicSource;
  const base = await content.generateContent(previousTopics, {
    ...options,
    topicSource: baseTopicSource,
    useSources: false,
    skipCopyValidation: true,
    sourceContext: '',
    sources: []
  }, client);
"""
new = """  // Preserve MANUAL mode so the generator receives its strongest instruction
  // to keep the requested topic. Only the legacy literal manual-topic validator
  // is bypassed; the source verifier below performs the entity/relevance checks.
  const base = await content.generateContent(previousTopics, {
    ...options,
    useSources: false,
    skipCopyValidation: true,
    skipManualTopicValidation: true,
    sourceContext: '',
    sources: []
  }, client);
"""
assert old in text, 'base topicSource hack block not found'
text = text.replace(old, new, 1)

old = """  validateManualTopicIdentity,
  topicEntityTokens,
"""
new = """  validateManualTopicIdentity,
  validateSlideTopicRelevance,
  topicRelevanceTerms,
  topicEntityTokens,
"""
assert old in text, 'exports marker not found'
text = text.replace(old, new, 1)
source_path.write_text(text)

# 3) Update/add production regressions.
test_path = Path('test/source-filter-production-regressions.test.js')
tests = test_path.read_text()
tests = tests.replace(
"""test('source filter mempertahankan requestedTopic tetapi tidak menjalankan literal manual-topic gate pada base generation', async () => {
""",
"""test('source filter mempertahankan mode manual dan hanya melewati validator literal lama', async () => {
""",
1)
tests = tests.replace(
"""      if (options.topicSource === 'manual') throw new Error('literal manual-topic gate masih aktif');
      return baseContent(slides);
""",
"""      if (options.topicSource !== 'manual') throw new Error('mode manual berubah sebelum base generation');
      if (options.skipManualTopicValidation !== true) throw new Error('validator literal lama belum dilewati');
      return baseContent(slides);
""",
1)
tests = tests.replace(
"""  assert.equal(baseOptions.requestedTopic, 'OpenAI temukan resiko');
  assert.notEqual(baseOptions.topicSource, 'manual');
  assert.equal(result.verificationStatus, 'source_based');
});
""",
"""  assert.equal(baseOptions.requestedTopic, 'OpenAI temukan resiko');
  assert.equal(baseOptions.topicSource, 'manual');
  assert.equal(baseOptions.skipManualTopicValidation, true);
  assert.equal(result.verificationStatus, 'source_based');
});
""",
1)

marker = "test('retry verifier membawa draft sebelumnya dan memperbaiki body panjang + claim title'"
assert marker in tests, 'regression insertion marker not found'
new_tests = r'''

test('Era efisiensi AI menolak slide tengah generik prompt dan batch automation', () => {
  const slides = [
    { section: 'PEMBUKA', title: 'Efisiensi AI Jadi Fokus Baru', body: 'Cek perubahan cara perusahaan memakai AI.', points: [], claims: [] },
    { section: 'SOLUSI', title: 'Buat prompt AI yang jelas', body: 'Tentukan input dan format output yang dibutuhkan.', points: [], claims: [] },
    { section: 'SOLUSI', title: 'Jalankan batch otomatis dengan AI', body: 'Gunakan tool tanpa kode untuk mempercepat pekerjaan.', points: [], claims: [] },
    { section: 'PENUTUP', title: 'Pilih Sesuai Kebutuhan', body: 'Cek sumber sebelum menentukan pendekatan.', points: [], claims: [] }
  ];
  const checked = validateVerifiedContent(baseContent(slides), { slides }, {
    contentService: permissiveContentService,
    format: 'Listicle',
    manualTopic: 'Era efisiensi AI',
    sources: [{ text: "Skyrocketing AI bills have forced companies to realize most tasks don't require expensive frontier models." }]
  });
  assert.ok(checked.errors.some(error => /Slide 2: isi claim-free menyimpang/i.test(error)));
  assert.ok(checked.errors.some(error => /Slide 3: isi claim-free menyimpang/i.test(error)));
});

test('slide claim-free tetap boleh jika langsung menyebut konsep inti topik manual', () => {
  const slides = [
    { section: 'PEMBUKA', title: 'Efisiensi AI Jadi Fokus Baru', body: 'Cek konteks sumbernya.', points: [], claims: [] },
    { section: 'PENJELASAN', title: 'Fokus pada efisiensi biaya', body: 'Bandingkan kebutuhan sebelum memilih pendekatan AI.', points: [], claims: [] },
    { section: 'PENUTUP', title: 'Pilih Sesuai Kebutuhan', body: 'Cek detail sumber sebelum memutuskan.', points: [], claims: [] }
  ];
  const errors = validateSlideTopicRelevance('Era efisiensi AI', slides, new Set());
  assert.deepEqual(errors, []);
});

test('slide tengah dengan claim sumber valid tidak diwajibkan mengulang keyword topik', () => {
  const evidence = "Skyrocketing AI bills have forced companies to realize most tasks don't require expensive frontier models.";
  const body = 'Banyak tugas tidak memerlukan model frontier yang mahal.';
  const slides = [
    { section: 'PEMBUKA', title: 'Efisiensi AI Jadi Fokus Baru', body: 'Cek konteksnya.', points: [], claims: [] },
    { section: 'PENJELASAN', title: 'Model terbesar bukan selalu perlu', body, points: [], claims: [{ field: 'slide:1:body', text: body, sourceId: 'source-1', evidence }] },
    { section: 'PENUTUP', title: 'Pilih Sesuai Kebutuhan', body: 'Baca sumber lengkapnya.', points: [], claims: [] }
  ];
  const checked = validateVerifiedContent(baseContent(slides), { slides }, {
    contentService: permissiveContentService,
    format: 'Listicle',
    manualTopic: 'Era efisiensi AI',
    sources: [{ text: evidence }]
  });
  assert.ok(!checked.errors.some(error => /claim-free menyimpang/i.test(error)));
});

'''
tests = tests.replace(marker, new_tests + marker, 1)

# Ensure imports include the new helper.
tests = tests.replace(
"""  validateVerifiedContent,
  validateManualTopicIdentity
""",
"""  validateVerifiedContent,
  validateManualTopicIdentity,
  validateSlideTopicRelevance
""",
1)
test_path.write_text(tests)
