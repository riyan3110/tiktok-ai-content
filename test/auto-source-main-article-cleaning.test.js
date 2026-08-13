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
      'Menjadi lompatan besar dalam cara kita menemukan lokasi.',
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
  assert.doesNotMatch(preparedText, /lompatan besar/i);

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

test('Ask Maps memulai carousel dari peluncuran, bukan contoh tur atau kampanye sampingan', () => {
  const source = {
    title: 'Google hadirkan fitur Ask Maps bagi pengguna di Indonesia',
    url: 'https://antara.test/ask-maps-current',
    text: [
      'Jakarta (ANTARA) - Google menghadirkan fitur Ask Maps bagi pengguna layanan Google Maps di Indonesia untuk memudahkan mobilitas harian dan perjalanan.',
      'Fitur percakapan berbasis Gemini itu sekarang dapat diakses dalam Bahasa Indonesia dan Bahasa Inggris.',
      'Dukungan berbagai bahasa lokal akan diluncurkan secara bertahap dalam beberapa minggu ke depan.',
      'Ask Maps telah dirilis di 150 negara dan membantu pengguna mengeksplorasi tempat serta merancang perjalanan.',
      'Pengguna dapat merancang rute tur motor tiga jam atau menemukan kafe tenang untuk mengobrol.',
      'Ask Maps didukung Personal Intelligence melalui Gmail untuk memahami preferensi dari reservasi hotel atau tiket penerbangan.',
      'Program ini mengajak masyarakat menemukan hal baru di sekitar mereka melalui kuliner legendaris.',
      'Menyambut perayaan Hari Kemerdekaan RI, Google mengampanyekan Jelajah Nusantara dengan bantuan Ask Maps.'
    ].join(' ')
  };

  const prepared = routing.prepareSources(topic, [source], plan);
  const preparedText = prepared.map(item => item.text).join(' ');
  const packets = simple.buildSlidePackets(prepared, topic, 'Fakta singkat');

  assert.doesNotMatch(preparedText, /kampanye|mengampanyekan|Jelajah Nusantara|kuliner legendaris|Program ini mengajak/i);
  assert.match(packets[0].mainEvidence, /Google menghadirkan.*Ask Maps.*Indonesia/i);
  assert.doesNotMatch(packets.map(packet => packet.mainEvidence).join(' '), /kampanye|Jelajah Nusantara|kuliner legendaris|Program ini mengajak/i);
  assert.ok(simple.buildFactCandidates(prepared, topic).every(candidate => /[.!?]$/.test(candidate.evidence)), 'fallback Auto Source tidak boleh menghasilkan fragmen tengah kalimat');
  assert.equal(new Set(packets.map(packet => packet.mainEvidence)).size, 4);

  const caption = simple.buildCaption(packets.map(packet => ({ body: packet.mainEvidence })), '', topic);
  assert.match(caption, /Google menghadirkan.*Ask Maps.*Indonesia/i);
  assert.doesNotMatch(caption, /kampanye|Jelajah Nusantara/i);
});

test('detail pilihan Gmail wajib dipertahankan dan aktivasi pemasaran hanya dipakai jika diminta', () => {
  const evidence = 'Users can choose to connect Gmail, and the connection is off by default.';
  assert.equal(simple.mainEvidenceCovered(
    'Ask Maps memakai Gmail untuk memberi rekomendasi personal.',
    { topic, mainEvidence: evidence }
  ), false);
  assert.equal(simple.mainEvidenceCovered(
    'Pengguna dapat memilih menghubungkan Gmail; koneksi ini nonaktif secara default.',
    { topic, mainEvidence: evidence }
  ), true);

  const campaign = 'Google mengampanyekan Jelajah Nusantara untuk merayakan Hari Kemerdekaan dengan Ask Maps.';
  const disguisedCampaign = 'Program ini mengajak masyarakat menemukan hal baru di sekitar mereka melalui kuliner legendaris.';
  assert.equal(storyFocus.marketingActivationNoise(campaign, plan), true);
  assert.equal(storyFocus.marketingActivationNoise(disguisedCampaign, plan), true);
  assert.equal(storyFocus.marketingActivationNoise(campaign, planner.fallbackPlan('Kampanye Jelajah Nusantara dengan Ask Maps')), false);
  assert.equal(storyFocus.marketingActivationNoise(disguisedCampaign, planner.fallbackPlan('Program Jelajah Nusantara')), false);
});

test('fallback Auto Source tidak boleh membentuk judul dari potongan awal body', () => {
  const prepared = routing.prepareSources(topic, contaminatedSources, plan);
  const packets = simple.buildSlidePackets(prepared, topic, 'Fakta singkat');
  const grounded = simple.groundedEvidenceCandidate(packets);

  assert.equal(simple.titleBodyDuplicate(
    'Pengguna Google Maps bisa memanfaatkan fitur Ask Maps',
    'Pengguna Google Maps bisa memanfaatkan fitur Ask Maps untuk membuat rencana perjalanan dan memilih rute tur.'
  ), true, 'judul yang disalin sebagai awalan body tetap duplikat meski body lebih panjang');

  assert.equal(new Set(grounded.slides.map(slide => slide.title.toLocaleLowerCase('id-ID'))).size, 4);
  grounded.slides.forEach(slide => {
    assert.equal(simple.titleBodyDuplicate(slide.title, slide.body), false, `${slide.title} tidak boleh menyalin body`);
    assert.equal(simple.bodyAddsDistinctDetail(slide.title, slide.body), true, `${slide.body} harus menambah detail`);
    assert.equal(slide.body.toLocaleLowerCase('id-ID').startsWith(slide.title.toLocaleLowerCase('id-ID')), false);
  });
});

test('writer dan editor yang mengulang body sebagai judul diperbaiki deterministik untuk semua slide', async () => {
  const prepared = routing.prepareSources(topic, contaminatedSources, plan);
  const packets = simple.buildSlidePackets(prepared, topic, 'Fakta singkat');
  const repeated = packets.map((packet, index) => ({
    title: packet.mainEvidence,
    body: packet.mainEvidence,
    points: [],
    claims: [{
      field: `slide:${index}:body`,
      text: packet.mainEvidence,
      sourceId: packet.primarySourceId,
      evidence: packet.mainEvidence
    }]
  }));
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: { slides: repeated } } }] }) } }
  };

  const result = await simple.compose({
    options: { requestedTopic: topic, contentFormat: 'Fakta singkat' },
    sources: prepared,
    discovery: { topic, sources: prepared },
    client
  });

  assert.equal(new Set(result.slides.map(slide => slide.title.toLocaleLowerCase('id-ID'))).size, 4);
  result.slides.forEach(slide => {
    assert.equal(simple.titleBodyDuplicate(slide.title, slide.body), false);
    assert.equal(simple.bodyAddsDistinctDetail(slide.title, slide.body), true);
  });
  assert.equal(new Set(result.slides.map(slide => slide.body)).size, 4);
  assert.equal(result.caption, simple.buildCaption(result.slides, '', topic));
});

test('pengumuman lintas sumber tidak didobel dan contoh penggunaan hanya menjadi cadangan', () => {
  const sources = [
    {
      title: 'Google hadirkan Ask Maps di Indonesia',
      url: 'https://news.test/ask-maps',
      text: [
        'Google menghadirkan Ask Maps bagi pengguna Google Maps di Indonesia.',
        'Ask Maps memakai Personal Intelligence untuk mempertimbangkan reservasi hotel dan penerbangan.',
        'Ask Maps menyediakan informasi transit secara real-time.',
        'Pengguna dapat merancang rute tur motor tiga jam sebagai contoh penggunaan.'
      ].join(' ')
    },
    {
      title: 'Google menghadirkan Ask Maps berbasis Gemini di Indonesia',
      url: 'https://official.test/ask-maps',
      text: [
        'Google menghadirkan Ask Maps berbasis Gemini di Indonesia.',
        'Pengguna dapat memilih menghubungkan Gmail dan koneksi tersebut nonaktif secara default.'
      ].join(' ')
    }
  ];
  const prepared = routing.prepareSources(topic, sources, plan);
  const packets = simple.buildSlidePackets(prepared, topic, 'Fakta singkat');
  const evidence = packets.map(packet => packet.mainEvidence).join(' ');

  assert.equal(simple.sameFactContext(
    'Google menghadirkan Ask Maps bagi pengguna Google Maps di Indonesia.',
    'Google meluncurkan Ask Maps berbasis Gemini di Indonesia.',
    topic
  ), true);
  assert.doesNotMatch(evidence, /rute tur motor|contoh penggunaan/i);
  assert.match(evidence, /Personal Intelligence/i);
  assert.match(evidence, /nonaktif secara default/i);
  assert.equal(simple.illustrativeExample('Pengguna dapat merancang rute tur motor tiga jam sebagai contoh penggunaan.', topic), true);
  assert.equal(simple.illustrativeExample('Pengguna dapat merancang rute tur motor tiga jam.', 'Contoh penggunaan Ask Maps'), false);
});

test('hasil produksi berulang seperti screenshot dibangun ulang menjadi empat isi padat dan berbeda', async () => {
  const sources = [
    {
      title: 'Google hadirkan fitur Ask Maps bagi pengguna di Indonesia',
      url: 'https://antara.test/ask-maps-production',
      text: [
        'Google secara resmi menghadirkan fitur Ask Maps bagi pengguna layanan Google Maps di Indonesia.',
        'Ask Maps tersedia dalam Bahasa Indonesia dan Bahasa Inggris untuk pengguna Google Maps.',
        'Ask Maps memakai Personal Intelligence untuk memahami reservasi penerbangan dan hotel dari Gmail.',
        'Ask Maps menyediakan informasi transportasi umum secara waktu nyata bagi pengguna.'
      ].join(' ')
    },
    {
      title: 'Google Hadirkan Fitur Ask Maps Berbasis Gemini di Indonesia',
      url: 'https://media.test/ask-maps-production',
      text: [
        'Google memperkenalkan fitur Ask Maps untuk pengguna layanan Google Maps di Indonesia.',
        'Ask Maps memakai Gemini untuk memahami pertanyaan kompleks tentang tempat dan tujuan perjalanan.',
        'Jawaban Ask Maps disusun dari informasi lokasi yang tersedia di Google Maps.'
      ].join(' ')
    },
    {
      title: 'Google Maps Hadirkan Ask Maps dan Immersive Navigation Berbasis Gemini',
      url: 'https://hype.test/ask-maps-production',
      text: [
        'Menjadi lompatan besar dalam cara kita menemukan lokasi.',
        'Ask Maps memungkinkan percakapan lanjutan tanpa memulai pencarian tempat dari awal.'
      ].join(' ')
    }
  ];
  const prepared = routing.prepareSources(topic, sources, plan);
  const packets = simple.buildSlidePackets(prepared, topic, 'Fakta singkat');
  const screenshotDraft = [
    ['Cakupan Peluncuran', 'GOOGLE secara resmi menghadirkan fitur Ask Maps bagi pengguna layanan Google Maps di Indonesia.'],
    ['Dukungan Bahasa', 'Google memperkenalkan fitur Ask Maps untuk pengguna layanan Google Maps di Indonesia.'],
    ['Sorotan Google Ask Maps', 'Menjadi lompatan besar dalam cara kita menemukan lokasi.'],
    ['Ketersediaan Fitur', 'Selain menghadirkan informasi waktu nyata, fitur Ask Maps didukung Personal Intelligence yang dihubungkan dengan akun Gmail.']
  ].map(([title, body], index) => ({
    title,
    body,
    points: [],
    claims: [{
      field: `slide:${index}:body`,
      text: body,
      sourceId: packets[index].primarySourceId,
      evidence: packets[index].mainEvidence
    }]
  }));
  const client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: { slides: screenshotDraft } } }] }) } }
  };

  assert.equal(simple.sameFactContext(screenshotDraft[0].body, screenshotDraft[1].body, topic), true);
  const draftErrors = simple.factualErrors({ slides: screenshotDraft }, packets, prepared);
  assert.ok(draftErrors.some(error => /slide:1:body tidak menjelaskan/i.test(error)));
  assert.ok(draftErrors.some(error => /slide:1: konteks\/fakta mengulang/i.test(error)));
  assert.ok(draftErrors.some(error => /slide:2:body memakai klaim promosi/i.test(error)));

  const result = await simple.compose({
    options: { requestedTopic: topic, contentFormat: 'Fakta singkat' },
    sources: prepared,
    discovery: { topic, sources: prepared },
    client
  });

  assert.equal(new Set(result.slides.map(slide => slide.title.toLocaleLowerCase('id-ID'))).size, 4);
  assert.equal(new Set(result.slides.map(slide => slide.body.toLocaleLowerCase('id-ID'))).size, 4);
  assert.doesNotMatch(result.slides.map(slide => `${slide.title} ${slide.body}`).join(' '), /lompatan besar|\bSorotan Google Ask Maps\b/i);
  result.slides.forEach((slide, index) => {
    assert.equal(simple.titleBodyDuplicate(slide.title, slide.body), false);
    assert.equal(simple.bodyIsDenseEnough(slide.body, packets[index]), true);
    assert.equal(simple.mainEvidenceCovered(slide.body, packets[index]), true);
    if (/bahasa/i.test(slide.title)) assert.match(slide.body, /bahasa/i);
  });
  for (let right = 1; right < result.slides.length; right += 1) {
    for (let left = 0; left < right; left += 1) {
      assert.equal(simple.sameFactContext(result.slides[left].body, result.slides[right].body, topic), false);
    }
  }
});
