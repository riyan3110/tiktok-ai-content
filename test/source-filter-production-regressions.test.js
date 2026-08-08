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

test('point listicle non-faktual tidak otomatis wajib evidence, tetapi klaim faktual tetap wajib', () => {
  assert.equal(requiresEvidence('Cek kebutuhan sebelum mencoba', 'POIN 1', 'point'), false);
  assert.equal(requiresEvidence('Bandingkan hasil dengan kebutuhanmu', 'POIN 2', 'point'), false);
  assert.equal(requiresEvidence('Gemini Spark memiliki fitur pembuatan aplikasi', 'POIN 3', 'point'), true);
  assert.equal(requiresEvidence('Digunakan oleh 80% pengguna', 'POIN 4', 'point'), true);
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
