const test = require('node:test');
const assert = require('node:assert/strict');
const discovery = require('../src/services/autoSourceExpandedDiscovery');
const routing = require('../src/services/autoSourceRoutingComposer');
const simple = require('../src/services/autoSourceSimpleComposer');

function article(url, title) {
  return {
    url,
    finalUrl: url,
    title,
    text: [
      `${title} adalah sistem baru yang dikembangkan untuk membantu pekerjaan software engineering.`,
      `${title} dapat menulis kode dan memperbaiki bagian program yang bermasalah.`,
      `${title} mendukung debugging serta pengujian pada alur pengembangan perangkat lunak.`,
      `${title} menggunakan beberapa proses AI untuk membagi pekerjaan menjadi tugas yang lebih kecil.`,
      `${title} memvalidasi hasil pekerjaan sebelum perubahan diteruskan ke tahap berikutnya.`,
      `${title} tersedia sebagai bagian dari pengujian produk untuk pengembang.`
    ].join(' '),
    fetchedAt: '2026-08-12T00:00:00.000Z'
  };
}

test('freshness ranking prefers newer dated candidates without rejecting undated sources', () => {
  const now = Date.parse('2026-08-12T00:00:00.000Z');
  assert.ok(discovery.freshnessScore('2026-08-11T00:00:00.000Z', now) > discovery.freshnessScore('2025-08-11T00:00:00.000Z', now));
  assert.equal(discovery.freshnessScore(null, now), 0);
});

test('publisher key collapses mobile/www variants of the same publisher', () => {
  assert.equal(discovery.publisherKey('https://www.example.com/a'), 'example.com');
  assert.equal(discovery.publisherKey('https://m.example.com/b'), 'example.com');
  assert.equal(discovery.publisherKey('https://tekno.example.co.id/a'), 'example.co.id');
});

test('Indonesian broad topics gain generic English anchors for global sources', () => {
  assert.equal(discovery.englishAnchorQuery('Potensi manfaat AI terhadap iklim'), 'AI climate');
  assert.equal(
    discovery.multilingualRelevance(
      'Potensi manfaat AI terhadap iklim',
      'Artificial intelligence is being used in climate forecasting and climate research.'
    ),
    1
  );
  assert.equal(discovery.fetchedContentRelevant('Potensi manfaat AI terhadap iklim', {
    title: 'AI for climate forecasting',
    text: 'Artificial intelligence and machine learning are used to improve climate forecasting and climate research.'
  }), true);
});

test('interpreted search queries keep the correct English article for a compressed Indonesian topic', async () => {
  discovery.clearCache();
  const topic = 'Kenali waktu ChatGPT riset pemikiran';
  const englishQuery = 'ChatGPT when to use deep research versus thinking mode';
  const plan = {
    canonicalTopic: 'Kapan memakai ChatGPT untuk riset mendalam atau mode berpikir',
    subjects: ['ChatGPT'],
    eventTerms: ['deep research versus thinking mode', 'riset mendalam atau mode berpikir'],
    actionTerms: [],
    contextTerms: ['deep research', 'thinking mode'],
    searchQueries: [topic, englishQuery],
    marketIntent: false,
    relation: 'comparison',
    planner: 'ai'
  };
  const source = {
    url: 'https://openai.example/deep-research-thinking',
    finalUrl: 'https://openai.example/deep-research-thinking',
    title: 'When to use ChatGPT deep research versus Thinking mode',
    text: [
      'Deep research is designed for multi-step questions that require synthesis across multiple sources.',
      'Thinking mode reasons through a complex prompt without creating a sourced research report.',
      'Standard chat is faster when a user only needs a quick lookup.',
      'Deep research gives users control over which public sources are included.',
      'A deep research task can take longer while ChatGPT reads and compares sources.',
      'The finished research report includes citations so users can inspect the supporting material.'
    ].join(' ')
  };
  const queries = [];
  const searchImpl = async query => {
    queries.push(query);
    return [{
      title: source.title,
      url: source.url,
      description: 'Guidance on choosing ChatGPT deep research or Thinking mode.',
      provider: 'test',
      publishedAt: '2026-08-12T00:00:00.000Z'
    }];
  };
  const sourceFetcher = {
    validateUrl: async raw => new URL(raw),
    fetchSources: async () => [source]
  };

  assert.equal(discovery.fetchedContentRelevant(topic, source), false, 'raw word overlap alone cannot bridge this topic');
  assert.equal(discovery.fetchedContentRelevant(topic, source, plan), true, 'the interpreted English intent must bridge it');
  assert.equal(discovery.fetchedContentRelevant(topic, {
    title: 'ChatGPT plans and subscription prices',
    text: 'ChatGPT offers several subscription plans at different prices.'
  }, { ...plan, subjects: [], eventTerms: [], actionTerms: [], contextTerms: [] }), false,
  'an empty interpretation must fall back to topic matching instead of admitting any article');

  const result = await discovery.discover({
    topic,
    topicPlan: plan,
    searchImpl,
    sourceFetcher,
    now: () => Date.parse('2026-08-13T00:00:00.000Z')
  });

  assert.ok(queries.includes(englishQuery));
  assert.ok(queries.some(query => /^ChatGPT deep research$/i.test(query)));
  assert.ok(queries.some(query => /^ChatGPT thinking mode$/i.test(query)));
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].finalUrl, source.finalUrl);
});

test('relevant search snippets rescue a topic when every full article reader fails', async () => {
  discovery.clearCache();
  const topic = 'Kenali waktu ChatGPT riset pemikiran';
  const plan = {
    canonicalTopic: 'Kapan memakai ChatGPT untuk riset mendalam atau mode berpikir',
    subjects: ['ChatGPT'],
    eventTerms: ['deep research versus thinking mode', 'riset mendalam atau mode berpikir'],
    actionTerms: [],
    contextTerms: ['deep research', 'thinking mode'],
    searchQueries: [topic, 'ChatGPT when to use deep research versus thinking mode'],
    marketIntent: false,
    relation: 'general',
    planner: 'ai'
  };
  const candidates = [
    {
      title: 'ChatGPT Plus, Pro, and Go subscription prices explained',
      url: 'https://wrong.example/chatgpt-prices',
      description: 'ChatGPT subscription tiers have different prices, while Deep Research and Thinking mode appear in the feature list.',
      provider: 'test',
      publishedAt: '2026-08-13T00:00:00.000Z'
    },
    {
      title: 'When ChatGPT Deep Research is the right choice',
      url: 'https://research.example/when-to-use-deep-research',
      description: 'ChatGPT Deep Research searches multiple sources and produces a cited report for complex questions.',
      provider: 'test',
      publishedAt: '2026-08-13T00:00:00.000Z'
    },
    {
      title: 'What ChatGPT Thinking mode does for complex prompts',
      url: 'https://thinking.example/chatgpt-thinking-mode',
      description: 'ChatGPT Thinking mode reasons through a difficult prompt without creating a multi-source research report.',
      provider: 'test',
      publishedAt: '2026-08-12T00:00:00.000Z'
    },
    {
      title: 'ChatGPT Deep Research reports include source citations',
      url: 'https://citations.example/deep-research-sources',
      description: 'ChatGPT Deep Research lets readers inspect citations attached to findings in the completed report.',
      provider: 'test',
      publishedAt: '2026-08-11T00:00:00.000Z'
    },
    {
      title: 'ChatGPT Thinking mode focuses on reasoning before answering',
      url: 'https://reasoning.example/thinking-before-answering',
      description: 'ChatGPT Thinking mode spends more effort reasoning before it returns an answer to the user.',
      provider: 'test',
      publishedAt: '2026-08-10T00:00:00.000Z'
    }
  ];
  const sourceFetcher = {
    validateUrl: async raw => new URL(raw),
    fetchSources: async () => { throw new Error('Isi artikel utama terlalu pendek untuk digunakan'); }
  };
  const fetchImpl = async () => new Response(JSON.stringify({ data: { content: 'too short' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  const result = await discovery.discover({
    topic,
    topicPlan: plan,
    searchImpl: async () => candidates,
    sourceFetcher,
    fetchImpl,
    now: () => Date.parse('2026-08-13T00:00:00.000Z')
  });

  assert.equal(result.evidenceMode, 'search-snippet-fallback');
  assert.ok(result.sources.length >= 2);
  assert.ok(result.sources.every(source => source.discovery.evidenceMode === 'search-snippet'));
  assert.ok(!result.sources.some(source => source.finalUrl === candidates[0].url), 'pricing story must stay rejected');
  assert.ok(discovery.evidenceFactCount(result.sources) >= 4);

  const prepared = routing.prepareSources(topic, result.sources, plan);
  assert.equal(simple.buildSlidePackets(prepared, topic, 'Fakta singkat').length, 4);
});

test('subjectless event rescue finds current news when a typoed name and different verb wording block literal search', async () => {
  discovery.clearCache();
  const topic = 'Cloude menerapkan watermark';
  const plan = {
    rawTopic: topic,
    canonicalTopic: topic,
    subjects: ['Cloude'],
    eventTerms: ['menerapkan watermark'],
    actionTerms: ['menerapkan'],
    contextTerms: ['watermark'],
    searchQueries: [topic],
    marketIntent: false,
    relation: 'event',
    planner: 'fallback'
  };
  const rescueQuery = 'menerapkan watermark latest';
  const candidates = ['alpha','beta','gamma','delta'].map((publisher, index) => ({
    title: `Anthropic announces watermark policy update ${index + 1}`,
    url: `https://${publisher}.example/ai-watermark`,
    description: `Claude will watermark generated content under the newly announced policy detail number ${index + 1}.`,
    provider: 'test',
    publishedAt: '2026-08-13T00:00:00.000Z'
  }));
  const queries = [];
  const sourceFetcher = {
    validateUrl: async raw => new URL(raw),
    fetchSources: async () => { throw new Error('publisher blocks article extraction'); }
  };
  const fetchImpl = async () => new Response(JSON.stringify({ data: { content: 'too short' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  const result = await discovery.discover({
    topic,
    topicPlan: plan,
    searchImpl: async query => {
      queries.push(query);
      return query === rescueQuery ? candidates : [];
    },
    sourceFetcher,
    fetchImpl,
    now: () => Date.parse('2026-08-13T00:00:00.000Z')
  });

  assert.ok(discovery.subjectlessEventQueries(plan).includes(rescueQuery));
  assert.ok(queries.includes(rescueQuery));
  assert.equal(result.evidenceMode, 'search-snippet-fallback');
  assert.equal(result.sources.length, 4);
  assert.ok(result.sources.every(source => /Claude will watermark/.test(source.text)));
  const prepared = routing.prepareSources(topic, result.sources, plan);
  assert.equal(simple.buildSlidePackets(prepared, topic, 'Fakta singkat').length, 4);
});

test('focused latest-news query rescues the exact typoed production topic from real-shaped news snippets', async () => {
  discovery.clearCache();
  const topic = 'Cloude menerapkan watermark';
  const plan = {
    rawTopic: topic,
    canonicalTopic: topic,
    subjects: ['Cloude'],
    eventTerms: ['menerapkan', 'watermark'],
    actionTerms: ['menerapkan'],
    contextTerms: ['watermark'],
    searchQueries: [topic, `${topic} terbaru`, `${topic} latest`],
    marketIntent: false,
    relation: 'event',
    planner: 'fallback'
  };
  const rescueQuery = 'Cloude watermark latest news';
  const candidates = [
    {
      title: 'Anthropic Will Watermark Claude-Generated Text and Files Worldwide',
      url: 'https://alpha.example/claude-watermark',
      description: 'Anthropic plans to watermark Claude-generated text and supported files worldwide under new transparency rules.',
      provider: 'bing-news-en',
      publishedAt: '2026-08-13T00:00:00.000Z'
    },
    {
      title: 'Claude will watermark generated text across its products',
      url: 'https://beta.example/claude-watermark',
      description: 'Claude will watermark generated text with an invisible signal. The mark can travel when users copy the text.',
      provider: 'bing-news-en',
      publishedAt: '2026-08-12T00:00:00.000Z'
    },
    {
      title: 'New Claude models will watermark AI-generated output',
      url: 'https://gamma.example/claude-watermark',
      description: 'Supported Claude models will watermark AI-generated output at the model level. The policy applies to supported products worldwide.',
      provider: 'bing-news-en',
      publishedAt: '2026-08-11T00:00:00.000Z'
    }
  ];
  const queries = [];
  const sourceFetcher = {
    validateUrl: async raw => new URL(raw),
    fetchSources: async () => { throw new Error('publisher blocks article extraction'); }
  };
  const fetchImpl = async () => new Response(JSON.stringify({ data: { content: 'too short' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  const result = await discovery.discover({
    topic,
    topicPlan: plan,
    searchImpl: async query => {
      queries.push(query);
      return query === rescueQuery ? candidates : [];
    },
    sourceFetcher,
    fetchImpl,
    now: () => Date.parse('2026-08-13T00:00:00.000Z')
  });

  assert.ok(discovery.focusedLatestNewsQueries(plan).includes(rescueQuery));
  assert.ok(queries.includes(rescueQuery));
  assert.equal(result.evidenceMode, 'search-snippet-fallback');
  assert.ok(discovery.evidenceFactCount(result.sources) >= 4);
  assert.ok(result.sources.every(source => /Claude/i.test(`${source.title} ${source.text}`)));
  const prepared = routing.prepareSources(topic, result.sources, plan);
  assert.equal(simple.buildSlidePackets(prepared, topic, 'Fakta singkat').length, 4);
});

test('repeated corrected entity spelling in search results triggers an evidence-based retry', async () => {
  discovery.clearCache();
  const topic = 'Cloude menerapkan watermark';
  const plan = {
    rawTopic: topic,
    canonicalTopic: topic,
    subjects: ['Cloude'],
    eventTerms: ['menerapkan', 'watermark'],
    actionTerms: ['menerapkan'],
    contextTerms: ['watermark'],
    searchQueries: [topic],
    marketIntent: false,
    relation: 'event',
    planner: 'fallback'
  };
  const hintRows = [
    {
      title: 'Claude watermark policy draws attention',
      url: 'https://hint-one.example/claude-watermark',
      description: 'Readers are discussing the new Claude watermark policy and its possible effects.',
      provider: 'bing-news-en'
    },
    {
      title: 'What the Claude watermark policy could mean',
      url: 'https://hint-two.example/claude-watermark',
      description: 'A second publisher examines questions surrounding the Claude watermark policy.',
      provider: 'bing-news-en'
    }
  ];
  const evidenceRows = [
    {
      title: 'Claude will watermark generated text worldwide',
      url: 'https://alpha.example/claude-watermark',
      description: 'Claude will watermark generated text with an invisible signal. The signal follows copied text across supported products.',
      provider: 'bing-news-en',
      publishedAt: '2026-08-13T00:00:00.000Z'
    },
    {
      title: 'Anthropic plans to watermark Claude output',
      url: 'https://beta.example/claude-watermark',
      description: 'Anthropic plans to watermark Claude output at the model level. Supported files also receive signed provenance metadata.',
      provider: 'bing-news-en',
      publishedAt: '2026-08-12T00:00:00.000Z'
    }
  ];
  const calls = [];
  const sourceFetcher = {
    validateUrl: async raw => new URL(raw),
    fetchSources: async () => { throw new Error('publisher blocks article extraction'); }
  };
  const fetchImpl = async () => new Response(JSON.stringify({ data: { content: 'too short' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  const result = await discovery.discover({
    topic,
    topicPlan: plan,
    searchImpl: async query => {
      calls.push(query);
      if (query === topic) return hintRows;
      if (query === 'Claude watermark latest news') return evidenceRows;
      return [];
    },
    sourceFetcher,
    fetchImpl,
    now: () => Date.parse('2026-08-13T00:00:00.000Z')
  });

  assert.equal(discovery.observedSubjectCorrections(plan, hintRows).get('Cloude'), 'Claude');
  assert.ok(discovery.observedCorrectionQueries(topic, plan, hintRows).includes('Claude watermark latest news'));
  assert.ok(calls.includes('Claude watermark latest news'));
  assert.ok(discovery.evidenceFactCount(result.sources) >= 4);
  const prepared = routing.prepareSources(topic, result.sources, plan);
  assert.equal(simple.buildSlidePackets(prepared, topic, 'Fakta singkat').length, 4);
});

test('expanded discovery rejects misleading fetched pages and selects different publishers', async () => {
  discovery.clearCache();
  const candidates = [
    { title: 'Muse Code official launch', url: 'https://www.alpha.example/muse-code-1', description: 'Muse Code software engineering AI', provider: 'test', publishedAt: '2026-08-12T00:00:00.000Z' },
    { title: 'Muse Code second report', url: 'https://m.alpha.example/muse-code-2', description: 'Muse Code coding agent', provider: 'test', publishedAt: '2026-08-11T00:00:00.000Z' },
    { title: 'Muse Code developer details', url: 'https://beta.example/muse-code', description: 'Muse Code software engineering', provider: 'test', publishedAt: '2026-08-10T00:00:00.000Z' },
    { title: 'Muse Code research overview', url: 'https://gamma.example/muse-code', description: 'Muse Code coding system', provider: 'test', publishedAt: '2026-08-09T00:00:00.000Z' },
    { title: 'Muse Code breaking news', url: 'https://irrelevant.example/muse-code', description: 'Muse Code AI coding', provider: 'test', publishedAt: '2026-08-12T00:00:00.000Z' }
  ];
  const searchImpl = async () => candidates;
  const sourceFetcher = {
    validateUrl: async raw => new URL(raw),
    fetchSources: async urls => {
      const url = urls[0];
      if (url.includes('irrelevant.example')) {
        return [{
          url,
          finalUrl: url,
          title: 'Resep masakan rumahan',
          text: 'Artikel ini membahas bahan makanan, resep, dapur, memasak, rasa, dan penyajian hidangan keluarga. Tidak ada pembahasan produk software.',
          fetchedAt: '2026-08-12T00:00:00.000Z'
        }];
      }
      return [article(url, 'Muse Code')];
    }
  };

  const result = await discovery.discover({
    topic: 'Muse Code',
    category: 'Edukasi teknologi',
    searchImpl,
    sourceFetcher,
    now: () => Date.parse('2026-08-12T00:00:00.000Z')
  });

  const publishers = result.sources.map(source => source.discovery.publisher);
  assert.equal(new Set(publishers).size, publishers.length, 'selected sources must come from different publishers');
  assert.ok(result.sources.length >= 2 && result.sources.length <= 4);
  assert.ok(!result.sources.some(source => /irrelevant\.example/.test(source.finalUrl)));
  assert.ok(result.queries.some(query => /latest|terbaru|official|research/i.test(query)));
});

test('rich single article is supplemented with independent scoped sources for current news', async () => {
  discovery.clearCache();
  const topic = 'Google hadirkan fitur Ask Maps';
  const plan = {
    rawTopic: topic,
    canonicalTopic: 'Google meluncurkan Ask Maps di Indonesia',
    subjects: ['Ask Maps'],
    eventTerms: ['launch in Indonesia', 'meluncurkan di Indonesia'],
    actionTerms: ['menghadirkan', 'meluncurkan', 'launch', 'rolling out', 'expanding'],
    contextTerms: ['Indonesia'],
    searchQueries: [topic],
    marketIntent: false,
    relation: 'event',
    planner: 'ai'
  };
  const candidates = [
    {
      title: 'Google hadirkan fitur Ask Maps bagi pengguna di Indonesia',
      url: 'https://www.antaranews.com/berita/ask-maps',
      description: 'Google menghadirkan Ask Maps untuk pengguna di Indonesia dengan dukungan Gemini bagi mobilitas dan perjalanan.',
      provider: 'test',
      publishedAt: '2026-08-12T08:08:00.000Z'
    },
    {
      title: 'Ask Maps gets more helpful with food ordering and more',
      url: 'https://blog.google/products/maps/ask-maps',
      description: 'Ask Maps is rolling out in Indonesia and more than 150 countries. Users can choose to connect Gmail, and the connection is off by default.',
      provider: 'test',
      publishedAt: '2026-08-06T00:00:00.000Z'
    },
    {
      title: 'Google expands Ask Maps to Indonesia',
      url: 'https://tech.example/ask-maps-indonesia',
      description: 'Google is expanding Ask Maps to users in Indonesia. The Gemini-powered feature answers complex questions about places and travel.',
      provider: 'test',
      publishedAt: '2026-08-12T00:00:00.000Z'
    },
    {
      title: 'Google launches Ask Maps in Indonesia',
      url: 'https://local.example/ask-maps',
      description: 'Google launches Ask Maps in Indonesia in English and Bahasa Indonesia. The feature helps users explore places and plan routes.',
      provider: 'test',
      publishedAt: '2026-08-12T00:00:00.000Z'
    }
  ];
  const fullArticle = {
    url: candidates[0].url,
    finalUrl: candidates[0].url,
    title: candidates[0].title,
    text: [
      'Google menghadirkan fitur Ask Maps bagi pengguna layanan Google Maps di Indonesia untuk memudahkan mobilitas harian dan perjalanan.',
      'Fitur percakapan berbasis Gemini sekarang dapat diakses dalam Bahasa Indonesia dan Bahasa Inggris.',
      'Ask Maps membantu pengguna mengeksplorasi tempat dan merancang perjalanan.',
      'Pengguna dapat merancang rute tur motor tiga jam atau menemukan kafe tenang.',
      'Menyambut Hari Kemerdekaan RI, Google mengampanyekan Jelajah Nusantara dengan Ask Maps.'
    ].join(' '),
    fetchedAt: '2026-08-12T00:00:00.000Z'
  };
  const sourceFetcher = {
    validateUrl: async raw => new URL(raw),
    fetchSources: async urls => {
      if (urls[0] === fullArticle.url) return [fullArticle];
      throw new Error('publisher blocks article extraction');
    }
  };
  const fetchImpl = async () => new Response(JSON.stringify({ data: { content: 'too short' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

  const result = await discovery.discover({
    topic,
    topicPlan: plan,
    searchImpl: async () => candidates,
    sourceFetcher,
    fetchImpl,
    now: () => Date.parse('2026-08-13T00:00:00.000Z')
  });

  assert.equal(result.evidenceMode, 'full-article-with-snippets');
  assert.equal(result.sources.length, 3);
  assert.equal(new Set(result.publishers).size, 3);
  assert.ok(result.sources.some(source => source.discovery.publisher === 'blog.google'), 'sumber primer yang relevan diprioritaskan sebagai pembanding');

  const prepared = routing.prepareSources(topic, result.sources, plan);
  const packets = simple.buildSlidePackets(prepared, topic, 'Fakta singkat');
  assert.match(packets[0].mainEvidence, /Google menghadirkan.*Ask Maps.*Indonesia/i);
  assert.match(packets.map(packet => packet.mainEvidence).join(' '), /choose to connect Gmail.*off by default/i);
  assert.doesNotMatch(packets.map(packet => packet.mainEvidence).join(' '), /kampanye|Jelajah Nusantara/i);
  assert.equal(new Set(packets.map(packet => packet.mainEvidence)).size, 4);
});
