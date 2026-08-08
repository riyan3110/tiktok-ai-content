const test = require('node:test');
const assert = require('node:assert/strict');

const { generateFilteredContent } = require('../src/services/sourceFilter');

test('source filter tidak menghidupkan lagi duplicate-copy hard gate sebelum verifikasi fakta', async () => {
  let baseOptions;
  let validationOptions;

  const base = {
    focus: { masalah: 'Konteks perlu dipahami', penyebab: 'Informasi tersebar', solusi: 'Periksa sumber', hasil: 'Pemahaman lebih jelas' },
    topic: 'Topik uji sumber',
    hook: 'Pertanyaan yang perlu dilihat',
    body: 'Cek konteks lengkap sebelum menyimpulkan.',
    caption: 'Cek konteks lengkap sebelum menyimpulkan.',
    hashtags: [],
    cta: 'Periksa konteks lengkapnya',
    trendKeywordsUsed: [],
    content_angle: 'angle uji sumber',
    primary_tool: 'tanpa tool',
    hook_pattern: 'pertanyaan',
    slides: [{
      section: 'PEMBUKA',
      title: 'Pertanyaan yang perlu dilihat',
      body: 'Cek konteks lengkap sebelum menyimpulkan.',
      points: []
    }]
  };

  const content = {
    generateContent: async (_previousTopics, options) => {
      baseOptions = options;
      return base;
    },
    validateContent: (_value, options) => {
      validationOptions = options;
      return options.validateCopy ? ['duplicate-copy hard gate aktif'] : [];
    }
  };

  const candidate = {
    slides: [{
      section: 'PEMBUKA',
      title: 'Pertanyaan yang perlu dilihat',
      body: 'Cek konteks lengkap sebelum menyimpulkan.',
      points: [],
      claims: []
    }]
  };

  const client = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: JSON.stringify(candidate) } }] })
      }
    }
  };

  const result = await generateFilteredContent({
    content,
    previousTopics: [],
    options: {
      topicSource: 'manual',
      requestedTopic: 'Topik uji sumber',
      contentFormat: 'Listicle',
      useSources: true
    },
    sources: [{
      url: 'https://example.test/article',
      text: 'Artikel sumber menjelaskan konteks yang cukup untuk proses verifikasi fakta.'
    }],
    client
  });

  assert.equal(baseOptions.useSources, false);
  assert.equal(baseOptions.skipCopyValidation, true);
  assert.equal(validationOptions.validateCopy, false);
  assert.equal(result.verificationStatus, 'source_based');
});
