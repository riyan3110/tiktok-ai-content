const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const planner = require('../src/services/autoSourceDynamicTopicPlan');
const discovery = require('../src/services/autoSourceExpandedDiscovery');
const routing = require('../src/services/autoSourceRoutingComposer');
const simple = require('../src/services/autoSourceSimpleComposer');
const storyFocus = require('../src/services/autoSourceStoryFocus');

const topic = 'Google hadirkan fitur Ask Maps';
const plan = planner.fallbackPlan(topic);
const pollution = /Cara Membuat Gambar|11\/8\/2026|23:45|ANTARA News|ANTARA Tekno|waktu baca|ANTARA\/HO|Ilustrasi fitur/i;

const contaminatedSources = [
  {
    title: 'Google hadirkan fitur Ask Maps bagi pengguna di Indonesia',
    url: 'https://antara.test/ask-maps',
    text: [
      'Jakarta (ANTARA) - Google menghadirkan fitur Ask Maps bagi pengguna layanan Google Maps di Indonesia.',
      'Ask Maps menawarkan dukungan berbasis kecerdasan buatan untuk memudahkan mobilitas harian dan perjalanan.',
      'Pengguna dapat mengajukan pertanyaan tentang tempat melalui percakapan di Google Maps.',
      'Ilustrasi fitur Ask Maps di Google Maps.',
      'ANTARA/HO-Google.',
      'ANTARA News ANTARA Tekno waktu baca.'
    ].join(' ')
  },
  {
    title: 'Google Hadirkan Fitur Ask Maps Berbasis Gemini di Indonesia',
    url: 'https://media.test/ask-maps',
    text: [
      'Ask Maps memakai Gemini untuk memahami pertanyaan kompleks tentang tempat.',
      'Jawaban Ask Maps disusun dari informasi lokasi yang tersedia di Google Maps.',
      'Cara Membuat Gambar dengan Gemini AI untuk Pemula 11/8/2026 23:45 Google melalui ekosistem Gemini AI telah menghadirkan kemampuan visual baru.'
    ].join(' ')
  },
  {
    title: 'Google Maps Hadirkan Ask Maps dan Immersive Navigation Berbasis Gemini',
    url: 'https://hype.test/ask-maps',
    text: [
      'Ask Maps memungkinkan percakapan lanjutan tanpa memulai pencarian tempat dari awal.',
      'Google Maps menampilkan informasi tempat yang mendukung jawaban Ask Maps.',
      'Antara/Google) GOOGLE secara resmi menghadirkan fitur Ask Maps bagi pengguna layanan Google Maps di Indonesia.'
    ].join(' ')
  }
];

test('Auto Source membersihkan dateline, kredit media, metadata situs, dan kartu artikel terkait', () => {
  assert.equal(
    storyFocus.cleanArticleFact('Jakarta (ANTARA) - Google menghadirkan Ask Maps di Indonesia.'),
    'Google menghadirkan Ask Maps di Indonesia.'
  );
  assert.equal(
    storyFocus.cleanArticleFact('Antara/Google) GOOGLE secara resmi menghadirkan Ask Maps.'),
    'GOOGLE secara resmi menghadirkan Ask Maps.'
  );
  assert.equal(storyFocus.sourceArtifactNoise('Ilustrasi fitur Ask Maps di Google Maps.', plan), true);
  assert.equal(storyFocus.sourceArtifactNoise('ANTARA/HO-Google.', plan), true);
  assert.equal(storyFocus.sourceArtifactNoise('ANTARA News ANTARA Tekno waktu baca.', plan), true);
  assert.equal(storyFocus.sourceArtifactNoise('Cara Membuat Gambar dengan Gemini AI 11/8/2026 23:45 Google menghadirkan visual baru.', plan), true);

  assert.equal(discovery.evidenceFactCount([{
    title: 'Google menghadirkan Ask Maps',
    text: [
      'Google menghadirkan Ask Maps bagi pengguna di Indonesia.',
      'Ilustrasi fitur Ask Maps di Google Maps.',
      'ANTARA/HO-Google.',
      'Cara Membuat Gambar dengan Gemini AI 11/8/2026 23:45 Google menghadirkan visual baru.'
    ].join(' ')
  }]), 1, 'artefak halaman tidak boleh membuat satu cuplikan terlihat kaya fakta');
});

test('Ask Maps mengambil empat fakta bersih dan berbeda dari artikel utama', () => {
  const prepared = routing.prepareSources(topic, contaminatedSources, plan);
  const preparedText = prepared.map(source => source.text).join(' ');
  assert.doesNotMatch(preparedText, pollution);
  assert.doesNotMatch(preparedText, /kemampuan visual baru/i);

  const packets = simple.buildSlidePackets(prepared, topic, 'Fakta singkat');
  assert.equal(packets.length, 4);
  assert.equal(new Set(packets.map(packet => packet.mainEvidence)).size, 4);
  assert.ok(packets.every(packet => !pollution.test(packet.mainEvidence)));
  for (let right = 1; right < packets.length; right += 1) {
    for (let left = 0; left < right; left += 1) {
      assert.equal(simple.sameFactContext(packets[left].mainEvidence, packets[right].mainEvidence, topic), false);
    }
  }
});

test('draft Ask Maps yang hype dan tercemar dibangun ulang dari evidence bersih', async () => {
  const prepared = routing.prepareSources(topic, contaminatedSources, plan);
  const packets = simple.buildSlidePackets(prepared, topic, 'Fakta singkat');
  const messy = packets.map((packet, index) => {
    const body = index === 0
      ? 'Menjadi lompatan besar dalam cara kita menemukan lokasi.'
      : index === 1
        ? 'ANTARA News ANTARA Tekno waktu baca.'
        : 'Google resmi menghadirkan Ask Maps di Indonesia.';
    return {
      title: index === 0 ? 'Lompatan Besar dalam Menemukan Lokasi' : 'Google Hadirkan Ask Maps',
      body,
      points: [],
      claims: [{ field: `slide:${index}:body`, text: body, sourceId: packet.primarySourceId, evidence: packet.mainEvidence }]
    };
  });
  const client = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: { slides: messy } } }] })
      }
    }
  };

  const result = await simple.compose({
    options: { requestedTopic: topic, contentFormat: 'Fakta singkat' },
    sources: prepared,
    discovery: { topic, sources: prepared },
    client
  });

  assert.deepEqual(result.slides.map(slide => slide.body), packets.map(packet => packet.mainEvidence));
  assert.equal(new Set(result.slides.map(slide => slide.body)).size, 4);
  assert.doesNotMatch(result.slides.map(slide => `${slide.title} ${slide.body}`).join(' '), pollution);
  assert.doesNotMatch(result.slides.map(slide => `${slide.title} ${slide.body}`).join(' '), /lompatan besar/i);
  assert.doesNotMatch(result.caption, pollution);
});
