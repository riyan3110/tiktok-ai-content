const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const research = require('../src/services/autoSourceResearchComposer');

const sources = [
  {
    title: 'Ask Maps expands globally',
    url: 'https://one.test/ask-maps',
    text: 'Google says Ask Maps is now available in more than 150 countries. Ask Maps uses Gemini to answer conversational questions about places. The feature can help users explore places in Google Maps.',
    discovery: { score: 90 }
  },
  {
    title: 'Ask Maps reaches more countries',
    url: 'https://two.test/ask-maps',
    text: 'The Ask Maps feature has rolled out across more than 150 countries. Google is expanding the feature to additional markets.',
    discovery: { score: 85 }
  },
  {
    title: 'Ask Maps gets ordering and personalization',
    url: 'https://three.test/ask-maps',
    text: 'Ask Maps can help users find food along a route and add an order to a cart through supported partners. With permission, Personal Intelligence can use Gmail information such as flight or reservation details to make recommendations more relevant. Ask Maps also supports conversational edits to place information.',
    discovery: { score: 95 }
  },
  {
    title: 'Ask Maps adds real-time transit',
    url: 'https://four.test/ask-maps',
    text: 'Ask Maps can now use real-time transit information for buses, trains, subways, and ferries. The transit information can include current delays.',
    discovery: { score: 92 }
  }
];

test('distinct fact selector does not spend two slides on the same 150-country context', () => {
  const selected = research.selectDistinctFacts(sources, 'Google hadirkan fitur Ask Maps', 4);
  assert.equal(selected.length, 4);
  const countryFacts = selected.filter(item => /150\s+countries/i.test(item.evidence));
  assert.equal(countryFacts.length, 1);
  for (let right = 1; right < selected.length; right += 1) {
    for (let left = 0; left < right; left += 1) {
      assert.ok(
        research.contextSimilarity(selected[left].evidence, selected[right].evidence, 'Google hadirkan fitur Ask Maps') < 0.9,
        `facts ${left} and ${right} should not be near-duplicates`
      );
    }
  }
});

test('slide packets are built from four distinct main facts before AI writing', () => {
  const packets = research.buildSlidePackets(sources, 'Google hadirkan fitur Ask Maps', 'Fakta singkat');
  assert.equal(packets.length, 4);
  packets.forEach((packet, index) => {
    assert.equal(packet.slideIndex, index);
    assert.equal(packet.evidence.length, 1);
    assert.equal(packet.mainEvidence, packet.evidence[0]);
    assert.match(packet.primarySourceId, /^source-\d+$/);
  });
});

test('English source sentence is rejected as visible body while Indonesian technical copy is allowed', () => {
  const english = {
    slides: [{
      title: 'Info Transit Real-time di Ask Maps',
      body: 'In addition to traffic Ask Maps can now tap into real-time transit information for buses and trains.',
      points: []
    }]
  };
  assert.ok(research.visibleLanguageErrors(english).some(error => /LANGUAGE/.test(error)));

  const indonesian = {
    slides: [{
      title: 'Transit Real-time di Ask Maps',
      body: 'Ask Maps kini menampilkan informasi transit real-time untuk bus dan kereta.',
      points: []
    }]
  };
  assert.deepEqual(research.visibleLanguageErrors(indonesian), []);
});

test('visible duplicate context catches repeated rollout fact across slides', () => {
  const candidate = {
    slides: [
      { title: 'Ask Maps tersedia lebih luas', body: 'Ask Maps kini tersedia di lebih dari 150 negara.', points: [] },
      { title: 'Jangkauan Ask Maps bertambah', body: 'Fitur ini sudah diluncurkan di lebih dari 150 negara.', points: [] },
      { title: 'Transit real-time', body: 'Ask Maps menampilkan informasi transit real-time.', points: [] },
      { title: 'Pemesanan makanan', body: 'Ask Maps membantu mencari makanan di sepanjang rute.', points: [] }
    ]
  };
  assert.ok(research.duplicateContextErrors(candidate, 'Google hadirkan fitur Ask Maps').some(error => /slide:1/.test(error)));
});
