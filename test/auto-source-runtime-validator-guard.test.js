const test = require('node:test');
const assert = require('node:assert/strict');

const guard = require('../src/services/autoSourceRuntimeGuard');

function claimContent({ text, evidence, sourceId = 'source-1' }) {
  return {
    slides: [{
      title: 'Judul fakta',
      body: text,
      points: ['Poin fakta berbeda tetap ringkas'],
      claims: [{ field: 'slide:0:body', text, sourceId, evidence }]
    }]
  };
}

test('percentage uses comma/dot and persen/percent as equivalent numeric forms', () => {
  assert.equal(guard.numbersSupported('Penetrasi mencapai 5.89%', 'Penetrasi tercatat 5,89 persen.'), true);
  assert.equal(guard.numbersSupported('Pengguna turun 52%', 'Active users fell 52 percent.'), true);
  assert.equal(guard.numbersSupported('Pengguna turun 52%', 'Ada 52 pengguna dalam survei.'), false);
});

test('numeric evidence recovery selects a related same-source window instead of unrelated numbers', () => {
  const source = {
    title: 'BAKTI memprioritaskan akses internet',
    text: 'Program lain mencakup 18 wilayah. BAKTI mencatat penetrasi internet sebesar 5,89 persen pada kelompok yang dibahas. Pemerataan akses tetap menjadi prioritas program.'
  };
  const claim = {
    text: 'BAKTI mencatat penetrasi internet sebesar 5.89%.',
    sourceId: 'source-1',
    evidence: 'Pemerataan akses tetap menjadi prioritas program.'
  };
  const evidence = guard.bestNumericEvidence(claim, source);
  assert.match(evidence, /5,89 persen/i);
  assert.match(evidence, /BAKTI/i);
});

test('legacy seven-word point error is non-blocking only inside 3-10 hard-safe range', () => {
  const safe = {
    slides: [{ points: ['Akses internet diprioritaskan untuk wilayah yang tertinggal'] }]
  };
  const safeError = 'Slide 1: point 1 maksimal 7 kata.';
  assert.equal(guard.safePointWidth(safeError, safe), true);
  assert.deepEqual(guard.filterRuntimeErrors([safeError], safe, []), []);

  const tooLong = {
    slides: [{ points: ['Akses internet tetap diprioritaskan untuk wilayah yang masih sangat tertinggal dan sulit dijangkau'] }]
  };
  assert.equal(guard.safePointWidth(safeError, tooLong), false);
  assert.deepEqual(guard.filterRuntimeErrors([safeError], tooLong, []), [safeError]);
});

test('strict zero-based point width error is also relaxed only to ten words', () => {
  const content = {
    slides: [{ points: ['Model baru melampaui perkiraan analis pada kuartal ini'] }]
  };
  const error = 'AUTO_SOURCE_LAYOUT: slide:0:point:0: point harus 3–7 kata.';
  assert.deepEqual(guard.filterRuntimeErrors([error], content, []), []);
});

test('same-slide evidence reuse alone is not a blocker', () => {
  const error = 'slide:0:duplicate: evidence yang sama dipakai lebih dari sekali dalam satu slide (body/bullet).';
  assert.equal(guard.isSameSlideEvidenceReuse(error), true);
  assert.deepEqual(guard.filterRuntimeErrors([error], { slides: [] }, []), []);
});

test('same-source percentage context clears numeric false positive', () => {
  const content = claimContent({
    text: 'Bluesky mencatat penurunan pengguna aktif sebesar 52%.',
    evidence: 'Platform menghadapi perubahan jumlah pengguna aktif.'
  });
  const sources = [{
    title: 'Bluesky menghadapi penurunan pengguna aktif',
    text: 'Bluesky mencatat pengguna aktif turun 52 persen dalam periode yang dilaporkan. Perubahan tersebut dibahas dalam laporan terbaru.'
  }];
  const error = 'AUTO_SOURCE_NUMERIC: slide:0:claim:0 angka/ordinal "52%" tidak didukung evidence/sumber yang sama.';
  assert.deepEqual(guard.filterRuntimeErrors([error], content, sources), []);
});

test('numeric blocker remains when same source does not support the claimed percentage', () => {
  const content = claimContent({
    text: 'Bluesky mencatat penurunan pengguna aktif sebesar 52%.',
    evidence: 'Platform menghadapi perubahan jumlah pengguna aktif.'
  });
  const sources = [{
    title: 'Bluesky menghadapi perubahan pengguna',
    text: 'Laporan menyebut 52 akun contoh dan membahas perubahan pengguna tanpa menyatakan persentase penurunan.'
  }];
  const error = 'AUTO_SOURCE_NUMERIC: slide:0:claim:0 angka/ordinal "52%" tidak didukung evidence/sumber yang sama.';
  assert.deepEqual(guard.filterRuntimeErrors([error], content, sources), [error]);
});

test('technical or English-looking title is rebuilt from an Indonesian grounded body', () => {
  const content = {
    slides: [{
      title: 'LPDDR6 Memory for Everyday Consumers',
      body: 'CXMT mempercepat pengembangan RAM LPDDR6 untuk pengguna biasa di pasar konsumen.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'CXMT mempercepat pengembangan RAM LPDDR6 untuk pengguna biasa di pasar konsumen.',
        sourceId: 'source-1',
        evidence: 'CXMT mempercepat pengembangan RAM LPDDR6 untuk pasar konsumen.'
      }]
    }]
  };
  const changed = guard.repairLanguageTitleErrors(content, ['slide:0:title: copy tampil harus Bahasa Indonesia.']);
  assert.equal(changed, true);
  assert.equal(guard.titleLanguageErrorIndex('slide:0:title: copy tampil harus Bahasa Indonesia.'), 0);
  assert.match(content.slides[0].title, /CXMT/i);
  assert.doesNotMatch(content.slides[0].title, /Everyday Consumers/i);
  const titleClaim = content.slides[0].claims.find(claim => claim.field === 'slide:0:title');
  assert.equal(titleClaim.sourceId, 'source-1');
  assert.equal(titleClaim.evidence, content.slides[0].claims.find(claim => claim.field === 'slide:0:body').evidence);
});
