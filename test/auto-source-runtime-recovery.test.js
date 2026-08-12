const test = require('node:test');
const assert = require('node:assert/strict');

const evidenceRecovery = require('../src/services/autoSourceEvidenceRecovery');
const discovery = require('../src/services/autoSourceFastDiscovery');

test('numeric or ordinal claim can recover stronger evidence from same-source headline plus body', () => {
  const source = {
    title: 'Gemini menjadi produk Google ke-14 yang menembus satu miliar pengguna',
    text: 'Gemini mencapai satu miliar pengguna bulanan menurut pembaruan perusahaan. Layanan ini tersedia di sejumlah produk Google.'
  };
  const content = {
    slides: [{
      body: 'Gemini menjadi produk Google ke-14 yang mencapai satu miliar pengguna bulanan.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'Gemini menjadi produk Google ke-14 yang mencapai satu miliar pengguna bulanan.',
        sourceId: 'source-1',
        evidence: 'Gemini mencapai satu miliar pengguna bulanan menurut pembaruan perusahaan.'
      }]
    }]
  };
  const repaired = evidenceRecovery.repairClaimEvidenceWindows(content, [source]);
  assert.match(repaired.slides[0].claims[0].evidence, /ke-14/i);
  assert.match(repaired.slides[0].claims[0].evidence, /satu miliar/i);
  assert.match(source.text, /Gemini menjadi produk Google ke-14/i, 'headline becomes canonical same-source context');
});

test('entity or location claim prefers a fuller same-source sentence when current evidence is too narrow', () => {
  const source = {
    title: 'Hotel mengadopsi layanan AI baru',
    text: 'Padma Resort Legian menggunakan layanan AI untuk membantu menjawab pertanyaan tamu. Sistem tersebut diuji pada layanan informasi hotel.'
  };
  const content = {
    slides: [{
      body: 'Padma Resort Legian menggunakan AI untuk membantu menjawab pertanyaan tamu.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'Padma Resort Legian menggunakan AI untuk membantu menjawab pertanyaan tamu.',
        sourceId: 'source-1',
        evidence: 'Sistem tersebut diuji pada layanan informasi hotel.'
      }]
    }]
  };
  const repaired = evidenceRecovery.repairClaimEvidenceWindows(content, [source]);
  assert.match(repaired.slides[0].claims[0].evidence, /Padma Resort Legian/i);
  assert.match(repaired.slides[0].claims[0].evidence, /menjawab pertanyaan tamu/i);
});

test('already strong evidence is preserved', () => {
  const source = { title: 'Fitur AI baru', text: 'Fitur AI baru membantu pengguna merangkum dokumen panjang secara langsung.' };
  const evidence = 'Fitur AI baru membantu pengguna merangkum dokumen panjang secara langsung.';
  const content = {
    slides: [{ body: 'Fitur AI baru membantu pengguna merangkum dokumen panjang.', points: [], claims: [{
      field: 'slide:0:body', text: 'Fitur AI baru membantu pengguna merangkum dokumen panjang.', sourceId: 'source-1', evidence
    }] }]
  };
  const repaired = evidenceRecovery.repairClaimEvidenceWindows(content, [source]);
  assert.equal(repaired.slides[0].claims[0].evidence, evidence);
});

test('expanded discovery builds named-entity and English relationship queries for global news', () => {
  const queries = discovery.expandedQueries('Nvidia bermitra dengan raksasa Wall Street', 'Edukasi teknologi');
  assert.ok(queries.some(query => /Nvidia Wall Street latest/i.test(query)), queries.join(' | '));
  assert.ok(queries.some(query => /partners with/i.test(query)), queries.join(' | '));
});

test('bilingual relevance keeps global English sources relevant to Indonesian broad topics', () => {
  const variants = discovery.relevanceVariants('Potensi manfaat AI terhadap iklim');
  assert.ok(variants.some(value => /climate/i.test(value)), variants.join(' | '));
  assert.ok(discovery.relevanceAcross(variants, 'AI climate benefits are being studied by researchers') >= 0.5);
});

test('expanded discovery raises candidate, fetch, and publisher diversity limits', () => {
  assert.equal(discovery.MAX_CANDIDATES, 32);
  assert.equal(discovery.MAX_FETCH_CANDIDATES, 20);
  assert.equal(discovery.MAX_SELECTED, 4);
});

test('freshness boost prefers recent published candidates', () => {
  const now = Date.parse('2026-08-13T00:00:00Z');
  const recent = discovery.freshnessBoost('2026-08-12T10:00:00Z', now);
  const old = discovery.freshnessBoost('2024-01-01T00:00:00Z', now);
  assert.ok(recent > old);
});

test('source selection prefers different publishers before duplicate hosts', () => {
  const make = (host, score, path) => ({
    url: `https://${host}/${path}`,
    finalUrl: `https://${host}/${path}`,
    discovery: { score }
  });
  const fetched = [
    make('a.example.com', 10, 'one'),
    make('a.example.com', 9.8, 'two'),
    make('b.example.com', 9.5, 'one'),
    make('c.example.com', 9, 'one'),
    make('d.example.com', 8.5, 'one')
  ];
  const selected = discovery.selectDiverseSources(fetched, 4);
  const hosts = selected.map(item => new URL(item.finalUrl).hostname);
  assert.deepEqual(new Set(hosts), new Set(['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com']));
});
