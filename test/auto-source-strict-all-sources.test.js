const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const strict = require('../src/services/autoSourceStrictFinalizer');
const manualSourceFallback = require('../src/services/manualSourceFallback');

function denseFacts(count = 20, sourceCount = 2) {
  return Array.from({ length: count }, (_, index) => ({
    sourceId: `source-${(index % sourceCount) + 1}`,
    evidence: `Fakta sumber nomor ${index + 1} menjelaskan detail berbeda yang relevan dengan topik pengujian.`
  }));
}

function denseSlide(index, pointCount = 3) {
  return {
    section: index === 0 ? 'PEMBUKA' : index === 3 ? 'KESIMPULAN' : 'FAKTA UTAMA',
    title: `Fakta penting bagian ${index + 1}`,
    body: 'Bagian ini menjelaskan fakta utama secara natural dengan konteks yang tetap cukup lengkap.',
    points: Array.from({ length: pointCount }, (_, pointIndex) => `Fakta berbeda poin ${pointIndex + 1}`),
    claims: []
  };
}

test('fact bank kaya mewajibkan tepat tiga bullet di setiap slide', () => {
  const content = { slides: Array.from({ length: 4 }, (_, index) => denseSlide(index, 2)) };
  const errors = strict.strictDensityErrors(content, denseFacts(20));
  const exactThree = errors.filter(error => /wajib tepat 3 bullet fakta berbeda/i.test(error));
  assert.equal(exactThree.length, 4);
});

test('body Auto Source strict harus padat 10-20 kata', () => {
  const content = { slides: Array.from({ length: 4 }, (_, index) => ({
    ...denseSlide(index, 3),
    body: 'Terlalu singkat untuk konteks.'
  })) };
  const errors = strict.strictDensityErrors(content, denseFacts(20));
  assert.ok(errors.some(error => /body harus 10-20 kata/i.test(error)));
});

test('prompt strict mewajibkan semua source terpilih dan pola body plus tiga bullet', () => {
  const facts = denseFacts(20, 2);
  const sources = [
    { title: 'Sumber Alpha', url: 'https://alpha.test/a', text: facts.filter(fact => fact.sourceId === 'source-1').map(fact => fact.evidence).join(' ') },
    { title: 'Sumber Beta', url: 'https://beta.test/b', text: facts.filter(fact => fact.sourceId === 'source-2').map(fact => fact.evidence).join(' ') }
  ];
  const generated = { slides: Array.from({ length: 4 }, (_, index) => denseSlide(index, 3)) };
  const prompt = strict.strictPrompt({ generated, sources, facts, format: 'Fakta singkat', topic: 'Topik pengujian', errors: [] });
  assert.match(prompt, /SOURCE ID WAJIB TERPAKAI/i);
  assert.match(prompt, /source-1/);
  assert.match(prompt, /source-2/);
  assert.match(prompt, /SEMUA sourceId.*harus menyumbang minimal satu fakta visible/is);
  assert.match(prompt, /SETIAP slide WAJIB memiliki tepat 3 bullet fakta berbeda/i);
  assert.match(prompt, /Body WAJIB 10-20 kata/i);
  assert.match(prompt, /Dilarang menambahkan tujuan, sebab-akibat, manfaat, strategi, implikasi/i);
});

test('source coverage contract mendeteksi sumber terpilih yang tidak menyumbang fakta', () => {
  const evidence1 = 'Sumber pertama menjelaskan kemampuan utama produk secara rinci dan faktual.';
  const evidence2 = 'Sumber kedua menjelaskan konteks tambahan yang berbeda dan tetap relevan.';
  const content = {
    slides: [{
      section: 'PEMBUKA',
      title: 'Kemampuan utama produk',
      body: evidence1,
      points: [],
      claims: [{ field: 'slide:0:body', text: evidence1, sourceId: 'source-1', evidence: evidence1 }]
    }]
  };
  const errors = manualSourceFallback.sourceCoverageErrors(content, [
    { title: 'Satu', text: evidence1 },
    { title: 'Dua', text: evidence2 }
  ]);
  assert.ok(errors.some(error => /coverage:source: source-2 belum menyumbang fakta/i.test(error)));

  const strictSource = fs.readFileSync(path.join(__dirname, '../src/services/autoSourceStrictFinalizer.js'), 'utf8');
  assert.match(strictSource, /\.\.\.sourceCoverageErrors\(candidate, sources\)/);
});

test('targeted repair hanya mengubah field yang ditargetkan', () => {
  const content = {
    slides: [{
      section: 'PEMBUKA',
      title: 'Fakta produk terbaru',
      body: 'Produk ini hadir untuk mempermudah semua pekerjaan pengguna secara otomatis setiap hari.',
      points: ['Tersedia untuk pengguna beta', 'Pengujian berlangsung bertahap', 'Fitur utama tetap tersedia'],
      claims: [
        { field: 'slide:0:body', text: 'Produk ini hadir untuk mempermudah semua pekerjaan pengguna secara otomatis setiap hari.', sourceId: 'source-1', evidence: 'The product is available to beta users.' },
        { field: 'slide:0:point:0', text: 'Tersedia untuk pengguna beta', sourceId: 'source-1', evidence: 'The product is available to beta users.' }
      ]
    }]
  };
  const repaired = strict.applyRepairs(content, [{
    field: 'slide:0:body',
    text: 'Produk ini tersedia untuk pengguna dalam program beta yang sedang berjalan saat ini.',
    sourceId: 'source-1',
    evidence: 'The product is available to beta users.'
  }], new Set(['slide:0:body']));
  assert.equal(repaired.slides[0].title, content.slides[0].title);
  assert.deepEqual(repaired.slides[0].points, content.slides[0].points);
  assert.match(repaired.slides[0].body, /tersedia untuk pengguna/i);
  assert.equal(repaired.slides[0].claims.find(claim => claim.field === 'slide:0:body').sourceId, 'source-1');
});

test('production Auto Source tidak lagi turun dari multi-source ke satu source dan Pakai URL lock tetap ada', () => {
  const patchSource = fs.readFileSync(path.join(__dirname, '../src/services/autoSourcePatch.js'), 'utf8');
  assert.match(patchSource, /if \(pakaiUrlRequested\(args\)\) return originalGenerateAndSave\(args\);/);
  assert.match(patchSource, /finalizer:\s*autoSourceStrictFinalizer/);
  assert.doesNotMatch(patchSource, /\[activeSources\.length,\s*1\]/);
  assert.doesNotMatch(patchSource, /multi-source gagal; satu retry terakhir memakai sumber terkuat/i);
  assert.match(patchSource, /sources:\s*activeSources/);
});