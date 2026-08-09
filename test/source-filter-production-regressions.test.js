const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateFilteredContent,
  requiresEvidence,
  validateVerifiedContent,
  validateManualTopicIdentity,
  validateSlideTopicRelevance
} = require('../src/services/sourceFilter');

function baseContent(slides) {
  return {
    focus: { masalah: 'Konteks', penyebab: 'Perubahan AI', solusi: 'Periksa sumber', hasil: 'Pemahaman lebih jelas' },
    topic: 'Topik AI',
    hook: slides[0].title,
    body: slides[0].body || slides[0].points?.join(' ') || 'Isi',
    caption: 'Ringkasan konten',
    hashtags: [],
    cta: slides.at(-1).title,
    trendKeywordsUsed: [],
    content_angle: 'edukasi AI',
    primary_tool: 'tanpa tool',
    hook_pattern: 'langsung',
    slides
  };
}

const permissiveContentService = {
  validateContent() { return []; }
};

test('point listicle non-faktual tidak otomatis wajib evidence, tetapi klaim faktual tetap wajib', () => {
  assert.equal(requiresEvidence('Cek kebutuhan sebelum mencoba', 'POIN 1', 'point'), false);
  assert.equal(requiresEvidence('Bandingkan hasil dengan kebutuhanmu', 'POIN 2', 'point'), false);
  assert.equal(requiresEvidence('Gemini Spark memiliki fitur pembuatan aplikasi', 'POIN 3', 'point'), true);
  assert.equal(requiresEvidence('Digunakan oleh 80% pengguna', 'POIN 4', 'point'), true);
});

test('instruksi listicle tidak berubah menjadi klaim faktual hanya karena mengandung kata kerja atau marker fakta', () => {
  assert.equal(requiresEvidence('Gunakan AI untuk membantu peneliti membaca data', 'POIN 1', 'point'), false);
  assert.equal(requiresEvidence('Pelajari fitur AI sebelum digunakan', 'POIN 2', 'point'), false);
  assert.equal(requiresEvidence('Fitur AI untuk riset', 'POIN 3', 'point'), false);
  assert.equal(requiresEvidence('Peneliti menggunakan AI untuk membaca data', 'POIN 4', 'point'), true);
  assert.equal(requiresEvidence('Google Maps rilis fitur AI', 'POIN 5', 'point'), true);
  assert.equal(requiresEvidence('Resmi rilis fitur AI baru', 'POIN 6', 'point'), true);
});

test('topik manual dengan nama entitas menerima paraphrase dan tidak menuntut overlap kata literal', () => {
  const slides = [
    { section: 'PEMBUKA', title: 'OpenAI Bahas Tantangan Keselamatan AI', body: 'Cek konteks sebelum menarik kesimpulan.', points: [], claims: [] },
    { section: 'POIN 1', title: 'Perhatikan konteks temuan', body: 'Bandingkan sumber sebelum membagikan.', points: [], claims: [] },
    { section: 'PENUTUP', title: 'Baca sumber lengkapnya', body: 'Simpan poin yang paling relevan.', points: [], claims: [] }
  ];
  assert.deepEqual(validateManualTopicIdentity('OpenAI temukan resiko', slides), []);

  let receivedManualTopic = null;
  const contentService = {
    validateContent(_content, options) {
      receivedManualTopic = options.manualTopic;
      return [];
    }
  };
  const checked = validateVerifiedContent(baseContent(slides), { slides }, {
    contentService,
    format: 'Listicle',
    manualTopic: 'OpenAI temukan resiko',
    sources: [{ text: 'OpenAI published a source article about AI safety and risk research for developers.' }]
  });
  assert.deepEqual(checked.errors, []);
  assert.equal(receivedManualTopic, '');
});

test('nama entitas utama tetap wajib muncul walau kata-kata topik lain boleh diparafrasekan', () => {
  const slides = [
    { section: 'PEMBUKA', title: 'Tantangan Keselamatan AI', body: 'Cek konteks sebelum menarik kesimpulan.', points: [] },
    { section: 'PENUTUP', title: 'Baca sumber lengkapnya', body: 'Simpan bagian yang relevan.', points: [] }
  ];
  const errors = validateManualTopicIdentity('OpenAI temukan resiko', slides);
  assert.ok(errors.some(error => /openai/i.test(error)));
});

test('Google Maps tidak gagal hanya karena nama produk dipendekkan menjadi Maps', () => {
  const slides = [
    { section: 'PEMBUKA', title: 'Maps Hadirkan Fitur Berbasis AI', body: 'Fitur navigasi mendapat pembaruan baru.', points: [] },
    { section: 'PENUTUP', title: 'Cek Cara Kerjanya', body: 'Pelajari detail sebelum mencoba.', points: [] }
  ];
  assert.deepEqual(validateManualTopicIdentity('Google Maps rilis fitur AI', slides), []);

  const unrelated = [
    { section: 'PEMBUKA', title: 'Fitur Navigasi Berbasis AI', body: 'Ada pembaruan untuk pengguna.', points: [] },
    { section: 'PENUTUP', title: 'Cek Detailnya', body: 'Pelajari sebelum mencoba.', points: [] }
  ];
  const errors = validateManualTopicIdentity('Google Maps rilis fitur AI', unrelated);
  assert.ok(errors.some(error => /google \/ maps/i.test(error)));
});

test('fakta tanpa claim dipulihkan hanya ketika ada evidence sumber yang sangat kuat', () => {
  const slides = [
    {
      section: 'POIN 1',
      title: 'Konteks Analisis Data',
      body: 'Cek konteksnya sebelum menyimpulkan.',
      points: ['Peneliti menggunakan AI untuk menganalisis pola data.'],
      claims: []
    }
  ];
  const sources = [{
    text: 'Peneliti menggunakan AI untuk menganalisis pola data dalam studi terbaru.'
  }];
  const checked = validateVerifiedContent(baseContent(slides), { slides }, {
    contentService: permissiveContentService,
    format: 'Listicle',
    manualTopic: '',
    sources
  });
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.content.slides[0].claims.length, 1);
  assert.equal(checked.content.slides[0].claims[0].field, 'slide:0:point:0');
  assert.match(checked.content.slides[0].claims[0].evidence, /menganalisis pola data/i);
});

test('kemiripan kata generik tidak boleh mengubah klaim berbeda menjadi terverifikasi', () => {
  const slides = [
    {
      section: 'POIN 1',
      title: 'Konteks Penggunaan AI',
      body: 'Cek konteksnya sebelum menyimpulkan.',
      points: ['AI membantu diagnosis penyakit.'],
      claims: []
    }
  ];
  const sources = [{ text: 'AI membantu pemasaran produk untuk tim bisnis.' }];
  const checked = validateVerifiedContent(baseContent(slides), { slides }, {
    contentService: permissiveContentService,
    format: 'Listicle',
    manualTopic: '',
    sources
  });
  assert.ok(checked.errors.some(error => /slide:0:point:0: klaim faktual tidak memiliki evidence/i.test(error)));
});

test('fakta tanpa dukungan sumber tetap ditolak setelah recovery evidence', () => {
  const slides = [
    {
      section: 'POIN 1',
      title: 'Konteks Analisis Data',
      body: 'Cek konteksnya sebelum menyimpulkan.',
      points: ['Peneliti menggunakan AI untuk menggantikan semua ahli.'],
      claims: []
    }
  ];
  const sources = [{
    text: 'Peneliti menggunakan AI untuk menganalisis pola data dalam studi terbaru.'
  }];
  const checked = validateVerifiedContent(baseContent(slides), { slides }, {
    contentService: permissiveContentService,
    format: 'Listicle',
    manualTopic: '',
    sources
  });
  assert.ok(checked.errors.some(error => /slide:0:point:0: klaim faktual tidak memiliki evidence/i.test(error)));
});

test('source filter mempertahankan mode manual dan hanya melewati validator literal lama', async () => {
  let baseOptions;
  const slides = [
    { section: 'PEMBUKA', title: 'OpenAI dan Keselamatan AI', body: 'Cek konteks sumber terlebih dahulu.', points: [] },
    { section: 'POIN 1', title: 'Baca temuan lengkap', body: 'Bandingkan bagian yang paling relevan.', points: [] },
    { section: 'PENUTUP', title: 'Jangan berhenti di judul', body: 'Periksa detail sebelum menyimpulkan.', points: [] }
  ];
  const content = {
    async generateContent(_previous, options) {
      baseOptions = options;
      if (options.topicSource !== 'manual') throw new Error('mode manual berubah sebelum base generation');
      if (options.skipManualTopicValidation !== true) throw new Error('validator literal lama belum dilewati');
      return baseContent(slides);
    },
    validateContent() { return []; }
  };
  const client = {
    chat: {
      completions: {
        async create() {
          return { choices: [{ message: { content: JSON.stringify({ slides }) } }] };
        }
      }
    }
  };
  const sources = [{ text: 'OpenAI published a source article about AI safety and risk research for developers.' }];
  const result = await generateFilteredContent({
    content,
    previousTopics: [],
    options: {
      topicSource: 'manual',
      requestedTopic: 'OpenAI temukan resiko',
      contentFormat: 'Listicle'
    },
    sources,
    client
  });
  assert.equal(baseOptions.requestedTopic, 'OpenAI temukan resiko');
  assert.equal(baseOptions.topicSource, 'manual');
  assert.equal(baseOptions.skipManualTopicValidation, true);
  assert.equal(result.verificationStatus, 'source_based');
});





test('slide tengah netral untuk cek konteks sumber tidak dianggap drift topik', () => {
  const slides = [
    { section: 'PEMBUKA', title: 'OpenAI dan Keselamatan AI', body: 'Cek konteks sumber terlebih dahulu.', points: [] },
    { section: 'POIN 1', title: 'Perhatikan konteks temuan', body: 'Bandingkan sumber sebelum membagikan.', points: [] },
    { section: 'PENUTUP', title: 'Baca sumber lengkapnya', body: 'Simpan poin yang paling relevan.', points: [] }
  ];
  assert.deepEqual(validateSlideTopicRelevance('OpenAI temukan resiko', slides, new Set()), []);
});

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
    { section: 'PENUTUP', title: 'Pilih Sesuai Kebutuhan', body: 'Cek detail sumber sebelum memutuskan.', points: [] }
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

test('retry verifier membawa draft sebelumnya dan memperbaiki body panjang + claim title', async () => {
  const requestedTopic = 'Menurut Survei Strategi AI Perusahaan 2026';
  const generatedTitle = 'Survei 2026 Ungkap Strategi AI Perusahaan';
  const longBody = 'Cek rincian survei ini secara lengkap sebelum menarik kesimpulan agar konteks temuan metode responden tujuan penerapan batasan strategi perusahaan dan dampaknya tetap dipahami dengan benar oleh setiap pembaca.';
  const baseSlides = [
    { section: 'PEMBUKA', title: generatedTitle, body: 'Cek konteks survei sebelum menyimpulkan.', points: [] },
    { section: 'POIN 1', title: 'Cek Temuan Utama', body: 'Bandingkan konteks sumber sebelum menyimpulkan.', points: [] },
    { section: 'PENUTUP', title: 'Baca Detail Survei', body: 'Simpan bagian yang paling relevan.', points: [] }
  ];
  const content = {
    async generateContent() { return baseContent(baseSlides); },
    validateContent(value) {
      const errors = [];
      value.slides.forEach((slide, index) => {
        if (String(slide.body || '').trim().split(/\s+/).filter(Boolean).length > 24) {
          errors.push(`Slide ${index + 1}: body maksimal 24 kata.`);
        }
      });
      return errors;
    }
  };
  const evidence = 'The 2026 Enterprise AI Strategy Survey reports company plans for artificial intelligence.';
  const firstDraft = [
    { section: 'PEMBUKA', title: generatedTitle, body: longBody, points: [], claims: [] },
    { section: 'POIN 1', title: 'Cek Temuan Utama', body: 'Bandingkan konteks sumber sebelum menyimpulkan.', points: [], claims: [] },
    { section: 'PENUTUP', title: 'Baca Detail Survei', body: 'Simpan bagian yang paling relevan.', points: [], claims: [] }
  ];
  const repairedDraft = [
    {
      section: 'PEMBUKA', title: generatedTitle, body: 'Cek rincian survei sebelum menarik kesimpulan.', points: [],
      claims: [{ field: 'slide:0:title', text: generatedTitle, sourceId: 'source-1', evidence }]
    },
    { section: 'POIN 1', title: 'Cek Temuan Utama', body: 'Bandingkan konteks sumber sebelum menyimpulkan.', points: [], claims: [] },
    { section: 'PENUTUP', title: 'Baca Detail Survei', body: 'Simpan bagian yang paling relevan.', points: [] }
  ];
  const prompts = [];
  let calls = 0;
  const client = {
    chat: { completions: { async create({ messages }) {
      const prompt = messages[1].content;
      if (/auditor entailment fakta bilingual/i.test(prompt)) {
        return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
      }
      calls += 1;
      prompts.push(prompt);
      if (calls === 1) {
        return { choices: [{ message: { content: JSON.stringify({ slides: firstDraft }) } }] };
      }
      return { choices: [{ message: { content: JSON.stringify({ slides: repairedDraft }) } }] };
    } } }
  };
  const result = await generateFilteredContent({
    content,
    options: { topicSource: 'manual', requestedTopic, contentFormat: 'Listicle' },
    sources: [{ text: evidence }],
    client
  });

  assert.equal(calls, 2);
  assert.match(prompts[0], /FIELD FAKTUAL CURRENT_DRAFT/);
  assert.match(prompts[0], /slide:0:title/);
  assert.match(prompts[1], /CURRENT_DRAFT/);
  assert.ok(prompts[1].includes(longBody));
  assert.match(prompts[1], /Slide 1: body maksimal 24 kata/);
  assert.match(prompts[1], /slide:0:title: klaim faktual tidak memiliki evidence/);
  assert.equal(result.verificationStatus, 'source_based');
  assert.equal(result.slides[0].body, 'Cek rincian survei sebelum menarik kesimpulan.');
  assert.equal(result.slides[0].claims[0].field, 'slide:0:title');
});


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
      const prompt = messages[1].content;
      if (/auditor entailment fakta bilingual/i.test(prompt)) {
        return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
      }
      calls += 1;
      prompts.push(prompt);
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
