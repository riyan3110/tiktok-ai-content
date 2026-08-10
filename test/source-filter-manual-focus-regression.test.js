const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { generateFilteredContent } = require('../src/services/sourceFilter');

const evidence = 'ChatGPT memiliki fitur yang dibahas dalam sumber.';
const source = { url: 'https://example.test/chatgpt', text: evidence };

function slide() {
  return {
    section: 'ITEM 1',
    title: 'Fakta ChatGPT',
    body: evidence,
    points: [],
    claims: [{ field: 'slide:0:body', text: evidence, sourceId: 'source-1', evidence }]
  };
}

function baseContent(requestedTopic, focus) {
  const currentSlide = slide();
  return {
    focus,
    topic: requestedTopic,
    hook: currentSlide.title,
    body: currentSlide.body,
    caption: currentSlide.body,
    hashtags: [],
    cta: currentSlide.title,
    trendKeywordsUsed: [],
    content_angle: 'fakta sumber',
    primary_tool: 'ChatGPT',
    hook_pattern: 'langsung',
    slides: [{ section: currentSlide.section, title: currentSlide.title, body: currentSlide.body, points: [] }]
  };
}

function client() {
  return { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    return { choices: [{ message: { content: JSON.stringify({ slides: [slide()] }) } }] };
  } } } };
}

const cases = [
  {
    name: 'penyebab bootstrap tidak boleh memblokir manual',
    requestedTopic: 'ChatGPT',
    focus: {
      masalah: 'Konteks ChatGPT',
      penyebab: 'Data pelatihan terbatas pada 2023.',
      solusi: 'Periksa sumber',
      hasil: 'Ringkasan ChatGPT'
    }
  },
  {
    name: 'masalah bootstrap email tidak boleh memblokir manual',
    requestedTopic: 'ChatGPT',
    focus: {
      masalah: 'Menulis email resmi memakan waktu.',
      penyebab: 'Konteks penggunaan',
      solusi: 'Periksa sumber',
      hasil: 'Ringkasan ChatGPT'
    }
  },
  {
    name: 'masalah bootstrap langganan tidak boleh memblokir manual',
    requestedTopic: 'ChatGPT gratis',
    focus: {
      masalah: 'Banyak orang ingin menggunakan AI tanpa harus membayar langganan.',
      penyebab: 'Konteks penggunaan',
      solusi: 'Periksa sumber',
      hasil: 'Ringkasan ChatGPT'
    }
  }
];

for (const scenario of cases) {
  test(`manual + URL: ${scenario.name}`, async () => {
    let finalGroundingCalls = 0;
    const base = baseContent(scenario.requestedTopic, scenario.focus);
    const content = {
      async generateContent(_previous, options) {
        assert.equal(options.useSources, false);
        assert.equal(options.deferSourceGroundingValidation, false);
        return base;
      },
      validateContent() { return []; },
      validateSourceGrounding() {
        finalGroundingCalls += 1;
        return ['manual tidak boleh menjalankan final whole-content grounding'];
      }
    };

    const result = await generateFilteredContent({
      content,
      options: {
        topicSource: 'manual',
        useSources: true,
        requestedTopic: scenario.requestedTopic,
        contentFormat: 'Listicle',
        sourceContext: source.text
      },
      sources: [source],
      client: client()
    });

    assert.equal(result.verificationStatus, 'source_based');
    assert.deepEqual(result.focus, scenario.focus);
    assert.deepEqual(result.slides, [slide()]);
    assert.equal(finalGroundingCalls, 0);
  });
}
