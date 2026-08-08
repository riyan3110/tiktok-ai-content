from pathlib import Path

source_path = Path('src/services/sourceFilter.js')
text = source_path.read_text()

old = "const NON_FACTUAL_START = /^(?:coba|baca|lihat|simpan|cek|pilih|mulai|bandingkan|pertimbangkan|fokus|jelajahi|ikuti|bagikan|tanyakan|pikirkan|perhatikan|gunakan|buat|atur|hindari|pastikan|sesuaikan|tentukan|uji|evaluasi|catat|pelajari)\\b/i;\n"
new = old + """const ENGLISH_DISPLAY_WORDS = new Set([\n  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'from', 'by',\n  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'do', 'does',\n  'did', 'not', \"don't\", \"doesn't\", 'can', 'could', 'should', 'would', 'will', 'most',\n  'about', 'without', 'into', 'that', 'this', 'these', 'those', 'as', 'than', 'which', 'who',\n  'when', 'why', 'how'\n]);\nconst INDONESIAN_DISPLAY_WORDS = new Set([\n  'yang', 'dan', 'atau', 'untuk', 'dengan', 'dari', 'di', 'pada', 'adalah', 'merupakan',\n  'tidak', 'bukan', 'belum', 'bisa', 'dapat', 'akan', 'ini', 'itu', 'agar', 'karena',\n  'sebagai', 'tentang', 'sebelum', 'setelah', 'lebih', 'oleh', 'dalam', 'juga', 'saat'\n]);\n"""
assert old in text, 'constant marker not found'
text = text.replace(old, new, 1)

old = """function isQuestion(value) {
  return /\\?\\s*$/.test(String(value || '').trim());
}
"""
new = old + """
function likelyEnglishDisplayText(value) {
  const displayTokens = String(value || '')
    .toLocaleLowerCase('en-US')
    .match(/[a-z]+(?:'[a-z]+)?/g) || [];
  if (displayTokens.length < 4) return false;

  const englishScore = displayTokens.filter(token => ENGLISH_DISPLAY_WORDS.has(token)).length;
  const indonesianScore = displayTokens.filter(token => INDONESIAN_DISPLAY_WORDS.has(token)).length;
  if (englishScore >= 2 && englishScore > indonesianScore) return true;
  return displayTokens.length >= 6 && englishScore >= 1 && indonesianScore === 0;
}
"""
assert old in text, 'isQuestion marker not found'
text = text.replace(old, new, 1)

old = """    if (requestedNorm && normalize(slide.title) === requestedNorm) errors.push(`Slide ${index + 1}: requestedTopic dipakai mentah sebagai judul.`);
    const rendered = `${slide.title || ''} ${slide.body || ''} ${(slide.points || []).join(' ')}`;
"""
new = """    if (requestedNorm && normalize(slide.title) === requestedNorm) errors.push(`Slide ${index + 1}: requestedTopic dipakai mentah sebagai judul.`);
    for (const field of slideFields(slide, index)) {
      if (field.value && likelyEnglishDisplayText(field.value)) {
        errors.push(`${field.key}: copy tampil harus Bahasa Indonesia.`);
      }
    }
    const rendered = `${slide.title || ''} ${slide.body || ''} ${(slide.points || []).join(' ')}`;
"""
assert old in text, 'validator marker not found'
text = text.replace(old, new, 1)

old = """- Pertahankan gaya natural ORIGINAL_CONTENT sebanyak mungkin.
- Source hanya untuk FILTER/VERIFIKASI fakta, bukan untuk menentukan struktur atau jumlah slide.
"""
new = """- Pertahankan gaya natural ORIGINAL_CONTENT sebanyak mungkin.
- SEMUA COPY YANG TAMPIL (title, body, points) WAJIB Bahasa Indonesia natural. Istilah brand/produk/AI/API boleh tetap asli, tetapi jangan salin kalimat bahasa Inggris dari sumber ke copy tampil.
- Evidence di dalam claims WAJIB tetap kutipan asli dari FACT_BANK dan BOLEH berbahasa Inggris; jangan menerjemahkan evidence.
- Source hanya untuk FILTER/VERIFIKASI fakta, bukan untuk menentukan struktur atau jumlah slide.
"""
assert old in text, 'prompt language marker not found'
text = text.replace(old, new, 1)

old = """- Jika error sebelumnya menyebut body/title/point terlalu panjang, ringkas field itu pada percobaan ini tanpa menambah fakta baru.
- Jika error sebelumnya menyebut slide:X:... klaim faktual tidak memiliki evidence, wajib lakukan salah satu: tambahkan claim untuk FIELD PERSIS itu memakai satu evidence FACT_BANK yang benar-benar mendukung, atau ubah field tersebut menjadi copy non-faktual yang akurat. Jangan kembalikan field faktual yang sama tanpa claim.
"""
new = """- Jika error sebelumnya menyebut body/title/point terlalu panjang, ringkas field itu pada percobaan ini tanpa menambah fakta baru.
- Jika error sebelumnya menyebut copy tampil harus Bahasa Indonesia, terjemahkan/parafrase FIELD PERSIS itu ke Bahasa Indonesia natural tanpa menambah fakta; evidence claim tetap kutipan asli FACT_BANK.
- Jika error sebelumnya menyebut slide:X:... klaim faktual tidak memiliki evidence, wajib lakukan salah satu: tambahkan claim untuk FIELD PERSIS itu memakai satu evidence FACT_BANK yang benar-benar mendukung, atau ubah field tersebut menjadi copy non-faktual yang akurat. Jangan kembalikan field faktual yang sama tanpa claim.
"""
assert old in text, 'retry marker not found'
text = text.replace(old, new, 1)

old = """  evidenceSupport,
  MAX_VERIFY_ATTEMPTS
};"""
new = """  evidenceSupport,
  likelyEnglishDisplayText,
  MAX_VERIFY_ATTEMPTS
};"""
assert old in text, 'exports marker not found'
text = text.replace(old, new, 1)
source_path.write_text(text)

test_path = Path('test/source-filter-production-regressions.test.js')
tests = test_path.read_text()
marker = "test('source verifier menerjemahkan copy Inggris ke Indonesia tetapi mempertahankan evidence asli'"
assert marker not in tests, 'language regression test already present'
tests += r'''

test('source verifier menerjemahkan copy Inggris ke Indonesia tetapi mempertahankan evidence asli', async () => {
  const evidence = "Skyrocketing AI bills have forced companies to realize most tasks don't require expensive frontier models.";
  const englishBody = evidence;
  const indonesianBody = 'Lonjakan biaya AI membuat perusahaan sadar banyak tugas tidak memerlukan model frontier mahal.';
  const baseSlides = [
    { section: 'MASALAH', title: 'Proses manual menghambat produktivitas', body: 'Biaya AI perlu ditinjau sesuai kebutuhan.', points: [] },
    { section: 'SOLUSI', title: 'Buat prompt AI yang jelas', body: 'Tentukan input dan format output yang dibutuhkan.', points: [] },
    { section: 'SOLUSI', title: 'Jalankan batch otomatis dengan AI', body: 'Gunakan alat yang sesuai alur kerja.', points: [] }
  ];
  const content = {
    async generateContent() { return baseContent(baseSlides); },
    validateContent() { return []; }
  };
  const firstDraft = [
    {
      ...baseSlides[0],
      body: englishBody,
      claims: [{ field: 'slide:0:body', text: englishBody, sourceId: 'source-1', evidence }]
    },
    { ...baseSlides[1], claims: [] },
    { ...baseSlides[2], claims: [] }
  ];
  const repairedDraft = [
    {
      ...baseSlides[0],
      body: indonesianBody,
      claims: [{ field: 'slide:0:body', text: indonesianBody, sourceId: 'source-1', evidence }]
    },
    { ...baseSlides[1], claims: [] },
    { ...baseSlides[2], claims: [] }
  ];
  const prompts = [];
  let calls = 0;
  const client = {
    chat: { completions: { async create({ messages }) {
      calls += 1;
      prompts.push(messages[1].content);
      return { choices: [{ message: { content: JSON.stringify({ slides: calls === 1 ? firstDraft : repairedDraft }) } }] };
    } } }
  };

  const result = await generateFilteredContent({
    content,
    options: { topicSource: 'trending', requestedTopic: 'Efisiensi biaya AI', contentFormat: 'Listicle' },
    sources: [{ text: evidence }],
    client
  });

  assert.equal(calls, 2);
  assert.match(prompts[0], /SEMUA COPY YANG TAMPIL.*Bahasa Indonesia/);
  assert.match(prompts[1], /slide:0:body: copy tampil harus Bahasa Indonesia/);
  assert.equal(result.slides[0].body, indonesianBody);
  assert.equal(result.caption, indonesianBody);
  assert.equal(result.slides[0].claims[0].evidence, evidence);
});
'''
test_path.write_text(tests)
