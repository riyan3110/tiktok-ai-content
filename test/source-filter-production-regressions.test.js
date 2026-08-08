const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateFilteredContent,
  requiresEvidence,
  validateVerifiedContent,
  validateManualTopicIdentity
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

test('fakta tanpa claim dipulihkan hanya ketika ada evidence sumber yang kuat', () => {
  const slides = [
    {
      section: 'POIN 1',
      title: 'Cara AI Dipakai dalam Riset',
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

test('fakta tanpa dukungan sumber tetap ditolak setelah recovery evidence', () => {
  const slides = [
    {
      section: 'POIN 1',
      title: 'Cara AI Dipakai dalam Riset',
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

test('source filter mempertahankan requestedTopic tetapi tidak menjalankan literal manual-topic gate pada base generation', async () => {
  let baseOptions;
  const slides = [
    { section: 'PEMBUKA', title: 'OpenAI dan Keselamatan AI', body: 'Cek konteks sumber terlebih dahulu.', points: [] },
    { section: 'POIN 1', title: 'Baca temuan lengkap', body: 'Bandingkan bagian yang paling relevan.', points: [] },
    { section: 'PENUTUP', title: 'Jangan berhenti di judul', body: 'Periksa detail sebelum menyimpulkan.', points: [] }
  ];
  const content = {
    async generateContent(_previous, options) {
      baseOptions = options;
      if (options.topicSource === 'manual') throw new Error('literal manual-topic gate masih aktif');
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
  assert.notEqual(baseOptions.topicSource, 'manual');
  assert.equal(result.verificationStatus, 'source_based');
});