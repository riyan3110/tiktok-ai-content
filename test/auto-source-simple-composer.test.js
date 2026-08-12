const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const simple = require('../src/services/autoSourceSimpleComposer');

const sources = [
  {
    title: 'Gemini mendapat kemampuan baru dari Google',
    url: 'https://one.test/gemini',
    text: [
      'Google memperbarui Gemini dengan kemampuan memahami dokumen yang diunggah pengguna.',
      'Gemini dapat merangkum isi dokumen panjang dan menjawab pertanyaan berdasarkan file tersebut.',
      'Fitur baru tersedia melalui aplikasi Gemini untuk pengguna yang memenuhi syarat.',
      'Google juga meningkatkan dukungan konteks percakapan pada aplikasi tersebut.',
      'Pembaruan ini diumumkan sebagai bagian dari pengembangan layanan Gemini.'
    ].join(' ')
  },
  {
    title: 'Gemini terhubung dengan layanan Google',
    url: 'https://two.test/gemini',
    text: [
      'Gemini dapat bekerja dengan beberapa layanan Google ketika pengguna memberikan izin.',
      'Integrasi membantu Gemini mengambil konteks dari layanan yang terhubung.',
      'Pengguna tetap dapat mengatur layanan mana yang boleh digunakan Gemini.',
      'Google menjelaskan integrasi tersebut sebagai bagian dari pengalaman asisten AI.',
      'Ketersediaan fitur dapat berbeda menurut akun dan wilayah.'
    ].join(' ')
  },
  {
    title: 'Gemini mendukung input multimodal',
    url: 'https://three.test/gemini',
    text: [
      'Gemini mendukung masukan teks dan gambar dalam satu percakapan.',
      'Pengguna dapat mengunggah gambar untuk dianalisis oleh Gemini.',
      'Model kemudian merespons berdasarkan konteks yang diberikan pengguna.',
      'Kemampuan multimodal menjadi salah satu fungsi utama aplikasi tersebut.',
      'Google terus memperluas dukungan jenis input pada Gemini.'
    ].join(' ')
  }
];

test('simple packets represent every selected source and never mix a source inside one slide', () => {
  const packets = simple.buildSlidePackets(sources, 'Aplikasi Gemini', 'Fakta singkat');
  assert.equal(packets.length, 4);
  const represented = new Set(packets.map(packet => packet.primarySourceId));
  assert.deepEqual(represented, new Set(['source-1', 'source-2', 'source-3']));
  packets.forEach(packet => {
    assert.ok(packet.evidence.length >= 1);
    const source = sources[Number(packet.primarySourceId.split('-')[1]) - 1];
    packet.evidence.forEach(evidence => assert.equal(simple.evidenceLiteralInSource(evidence, source), true));
  });
});

test('zero bullets are valid when body has a grounded factual claim', () => {
  const packets = simple.buildSlidePackets(sources, 'Aplikasi Gemini', 'Fakta singkat');
  const slides = packets.map((packet, index) => {
    const body = packet.evidence[0];
    return {
      section: packet.section,
      title: `Fakta Gemini ${index + 1}`,
      body,
      points: [],
      claims: [{
        field: `slide:${index}:body`,
        text: body,
        sourceId: packet.primarySourceId,
        evidence: packet.evidence[0]
      }]
    };
  });
  assert.deepEqual(simple.factualErrors({ slides }, packets, sources), []);
});

test('wrong source and unsupported numeric claim remain blockers', () => {
  const packets = simple.buildSlidePackets(sources, 'Aplikasi Gemini', 'Fakta singkat');
  const slides = packets.map((packet, index) => {
    const body = index === 0 ? 'Gemini digunakan oleh 99% pengguna.' : packet.evidence[0];
    return {
      title: `Fakta Gemini ${index + 1}`,
      body,
      points: [],
      claims: [{
        field: `slide:${index}:body`,
        text: body,
        sourceId: index === 1 ? 'source-1' : packet.primarySourceId,
        evidence: packet.evidence[0]
      }]
    };
  });
  const errors = simple.factualErrors({ slides }, packets, sources);
  assert.ok(errors.some(error => /slide:0:body: angka\/persentase tidak didukung/i.test(error)));
  assert.ok(errors.some(error => /slide:1:body: sourceId tidak sesuai/i.test(error)));
});

test('comma and dot percentage notation are treated as the same factual number', () => {
  assert.equal(simple.numbersSupported('Penetrasi mencapai 5.89%', 'Penetrasi mencapai 5,89 persen.'), true);
  assert.equal(simple.numbersSupported('Penetrasi mencapai 5.89%', 'Penetrasi mencapai 6,89 persen.'), false);
});

test('invalid bullet can be removed without destroying the body or whole carousel', () => {
  const packets = simple.buildSlidePackets(sources, 'Aplikasi Gemini', 'Fakta singkat');
  const slides = packets.map((packet, index) => {
    const body = packet.evidence[0];
    const point = index === 0 ? 'Angka palsu 88% pengguna' : '';
    return {
      section: packet.section,
      title: `Fakta Gemini ${index + 1}`,
      body,
      points: point ? [point] : [],
      claims: [
        { field: `slide:${index}:body`, text: body, sourceId: packet.primarySourceId, evidence: packet.evidence[0] },
        ...(point ? [{ field: `slide:${index}:point:0`, text: point, sourceId: packet.primarySourceId, evidence: packet.evidence[0] }] : [])
      ]
    };
  });
  const errors = simple.factualErrors({ slides }, packets, sources);
  assert.ok(errors.some(error => /^slide:0:point:0:/.test(error)));
  const cleaned = simple.dropInvalidPoints({ slides }, errors, packets);
  assert.equal(cleaned.slides[0].points.length, 0);
  assert.equal(cleaned.slides[0].body, slides[0].body);
});
