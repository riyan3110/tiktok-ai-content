const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const safety = require('../src/services/sourceSafetyPatch');
safety.install();
const fallback = require('../src/services/manualSourceFallback');
const { finalizeSourceCandidate } = require('../src/services/generation');
const fixtures = require('./fixtures/generic-source-cases.json');

const metadataPattern = /https?:\/\/|baca juga|cookie|privacy|newsletter|recommended/i;

function candidate(topic, format, rows) {
  const slides = rows.map((row, slideIndex) => {
    const bodyClaim = {
      field: `slide:${slideIndex}:body`, text: row.body, sourceId: 'source-1', evidence: row.bodyEvidence
    };
    const points = row.point ? [row.point] : [];
    const claims = [bodyClaim];
    if (row.point) claims.push({
      field: `slide:${slideIndex}:point:0`, text: row.point, sourceId: 'source-1', evidence: row.pointEvidence
    });
    return {
      section: format === 'Listicle' ? `ITEM ${slideIndex + 1}` : slideIndex === 0 ? 'PEMBUKA' : slideIndex === rows.length - 1 ? 'KESIMPULAN' : 'FAKTA UTAMA',
      title: row.title,
      body: row.body,
      points,
      claims
    };
  });
  return {
    topic,
    hook: slides[0].title,
    body: slides[1]?.body || slides[0].body,
    caption: slides[1]?.body || slides[0].body,
    cta: slides.at(-1).title,
    hashtags: [],
    verificationStatus: 'source_based',
    slides
  };
}

function assertNoCorruption(content, sources) {
  assert.deepEqual(fallback.validateSourceContent(content, sources), []);
  const evidence = content.slides.flatMap(slide => slide.claims).map(claim => claim.evidence);
  assert.equal(new Set(evidence).size, evidence.length, 'evidence canonical tidak boleh diulang');
  for (const slide of content.slides) {
    assert.doesNotMatch([slide.title, slide.body, ...slide.points].join(' '), metadataPattern);
    assert.equal(slide.body.trim().length > 0, true);
    for (const claim of slide.claims) {
      assert.equal(sources[0].text.includes(claim.evidence), true, `evidence harus exact: ${claim.evidence}`);
      assert.equal(claim.text, claim.field.endsWith(':body') ? slide.body : slide.points[0]);
    }
  }
}

const englishFacts = [
  'Northstar Browser was derived from the Cedar rendering engine during development.',
  'The browser can reduce memory use when many tabs remain open.',
  'The team plans to release the mobile edition next quarter.',
  'Tests associated the cache setting with shorter startup time.',
  'The browser includes local profile controls for shared computers.',
  'Developers published migration notes for extension authors.',
  'The desktop edition supports four workspace groups.',
  'Administrators may disable background synchronization.'
];

const indonesianFacts = fixtures.indonesianTechnology.text.split(/(?<=[.!?])\s+/);
const richFacts = fixtures.richSource.text.split(/(?<=[.!?])\s+/);
const thinFacts = fixtures.thinSource.text.split(/(?<=[.!?])\s+/);
const listicleFacts = fixtures.explicitListicle.text.split(/(?<=[.!?])\s+/);

const matrix = [
  {
    name: 'Fakta singkat + English general technology', source: fixtures.englishGeneralTechnology,
    content: candidate('Uji Lapangan Harbor Battery', 'Fakta singkat', [
      { title: 'Uji Berjalan Setahun', body: 'Harbor Battery menjalani uji lapangan selama dua belas bulan pada bus pesisir.', bodyEvidence: 'Harbor Battery completed a twelve-month field trial in coastal buses.' },
      { title: 'Kapasitas Saat Dingin', body: 'Insinyur mencatat kapasitas lebih rendah selama beberapa pekan paling dingin.', bodyEvidence: 'Engineers recorded lower capacity during the coldest weeks.' },
      { title: 'Pengisian dan Suhu', body: 'Studi mengaitkan pengisian lebih lambat dengan rendahnya suhu lingkungan.', bodyEvidence: 'The study associated slower charging with low ambient temperature.' },
      { title: 'Rencana Perluasan Uji', body: 'Operator mungkin memperluas pengujian menuju dua rute tambahan.', bodyEvidence: 'The operator may expand the trial to two additional routes.' }
    ])
  },
  {
    name: 'Fakta singkat + Indonesian thin source', source: fixtures.thinSource,
    content: candidate('Pembaruan Pijar Keyboard', 'Fakta singkat', thinFacts.map((fact, index) => ({
      title: ['Ukuran Tombol Baru', 'Dua Profil Tata Letak', 'Jadwal Pembaruan', 'Pengaturan Lama Tersimpan'][index],
      body: fact,
      bodyEvidence: fact
    })))
  },
  {
    name: 'Listicle + English technology', source: fixtures.englishTechnology,
    content: candidate('Empat Fakta Northstar Browser', 'Listicle', [
      { title: 'Berbasis Mesin Cedar', body: 'Northstar Browser diturunkan dari mesin rendering Cedar selama proses pengembangan.', bodyEvidence: englishFacts[0], point: 'Dapat mengurangi penggunaan memori', pointEvidence: englishFacts[1] },
      { title: 'Edisi Seluler Direncanakan', body: 'Tim berencana merilis edisi seluler pada kuartal berikutnya.', bodyEvidence: englishFacts[2], point: 'Cache terkait startup singkat', pointEvidence: englishFacts[3] },
      { title: 'Kontrol Profil Lokal', body: 'Browser menyediakan kontrol profil lokal untuk komputer yang digunakan bersama.', bodyEvidence: englishFacts[4], point: 'Catatan migrasi sudah diterbitkan', pointEvidence: englishFacts[5] },
      { title: 'Empat Grup Workspace', body: 'Edisi desktop mendukung empat kelompok workspace bagi para penggunanya.', bodyEvidence: englishFacts[6], point: 'Sinkronisasi dapat dinonaktifkan', pointEvidence: englishFacts[7] }
    ])
  },
  {
    name: 'Listicle + Indonesian explicit five items', source: fixtures.explicitListicle,
    content: candidate('Lima Tips Penyimpanan', 'Listicle', listicleFacts.map((fact, index) => ({
      title: ['Tinjau Ruang Tersedia', 'Hapus Berkas Sementara', 'Periksa Folder Unduhan', 'Tinjau Aplikasi Lama', 'Uji Kembali Cadangan'][index],
      body: fact,
      bodyEvidence: fact
    })))
  },
  {
    name: 'Rich source tanpa filler atau duplicate', source: fixtures.richSource,
    content: candidate('Laporan Jaringan Meridian', 'Fakta singkat', Array.from({ length: 5 }, (_, index) => ({
      title: ['Dua Belas Kantor', 'Tiga Pola Gangguan', 'Log Empat Belas Hari', 'Koneksi Beragam', 'Batas Temuan Laporan'][index],
      body: richFacts[index * 2].split(/\s+/).length >= 8
        ? richFacts[index * 2]
        : `${richFacts[index * 2].replace(/[.!?]$/, '')} selama periode pengujian berlangsung.`,
      bodyEvidence: richFacts[index * 2],
      point: richFacts[index * 2 + 1].split(/\s+/).slice(0, 7).join(' ').replace(/[.!?]$/, ''),
      pointEvidence: richFacts[index * 2 + 1]
    })))
  }
];

for (const entry of matrix) {
  test(entry.name, async () => {
    let repairs = 0;
    assertNoCorruption(entry.content, [entry.source]);
    const result = await finalizeSourceCandidate({
      generated: entry.content,
      sources: [entry.source],
      repair: async () => { repairs += 1; throw new Error('candidate valid tidak boleh direwrite'); }
    });
    assert.equal(result, entry.content);
    assert.equal(repairs, 0);
  });
}

test('source tipis tidak memaksa filler untuk mengejar bullet', () => {
  const entry = matrix.find(item => /thin source/.test(item.name));
  assertNoCorruption(entry.content, [entry.source]);
  assert.equal(entry.content.slides.every(slide => slide.points.length === 0), true);
});
