const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const finalizer = require('../src/services/autoSourceResilientFinalizer');
const validation = require('../src/services/autoSourceValidation');

function facts(count = 20) {
  return Array.from({ length: count }, (_, index) => ({
    sourceId: `source-${(index % 2) + 1}`,
    evidence: `Fakta ${index + 1} menjelaskan detail berbeda yang relevan dengan topik pengujian.`
  }));
}

function slide(body, points = ['Fakta berbeda pertama', 'Fakta berbeda kedua', 'Fakta berbeda ketiga']) {
  return { section: 'FAKTA UTAMA', title: 'Judul fakta yang natural', body, points, claims: [] };
}

test('body 9 atau 21 kata tidak lagi menggagalkan carousel bila masih dalam hard layout 8-24', () => {
  const nineWords = 'Produk baru membawa fitur utama untuk pengguna secara bertahap.';
  const twentyOneWords = 'Produk baru ini membawa sejumlah kemampuan utama untuk pengguna dan diperkenalkan secara bertahap melalui pembaruan yang dijelaskan oleh sumber resmi tersebut.';
  assert.equal(nineWords.split(/\s+/).length, 9);
  assert.equal(twentyOneWords.split(/\s+/).length, 21);
  assert.deepEqual(finalizer.relaxedDensityErrors({ slides: [slide(nineWords)] }, facts()), []);
  assert.deepEqual(finalizer.relaxedDensityErrors({ slides: [slide(twentyOneWords)] }, facts()), []);
});

test('body di luar 8-24 tetap ditolak agar layout tidak berantakan', () => {
  const tooShort = 'Fakta ini terlalu pendek.';
  const errors = finalizer.relaxedDensityErrors({ slides: [slide(tooShort)] }, facts());
  assert.ok(errors.some(error => /body harus 8-24 kata/i.test(error)));
});

test('source kaya tetap mewajibkan tiga bullet fakta per slide', () => {
  const content = { slides: [slide('Produk ini memiliki konteks faktual yang cukup jelas untuk pembaca.', ['Fakta pertama saja', 'Fakta kedua saja'])] };
  const errors = finalizer.relaxedDensityErrors(content, facts());
  assert.ok(errors.some(error => /wajib tepat 3 bullet fakta berbeda/i.test(error)));
});

test('model/version dianggap grounded bila entity plus versi ada pada source context yang sama', () => {
  const content = {
    slides: [{
      title: 'Pembaruan ChatGPT',
      body: 'ChatGPT 5.6 membawa pembaruan baru.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'ChatGPT 5.6 membawa pembaruan baru.',
        sourceId: 'source-1',
        evidence: 'OpenAI menjelaskan pembaruan baru dalam catatan rilis.'
      }]
    }]
  };
  const source = { title: 'OpenAI memperkenalkan ChatGPT-5.6', text: 'ChatGPT 5.6 is described in the release notes.' };
  assert.deepEqual(validation.numericGroundingErrors(content, [source]), []);
});

test('angka biasa tidak diloloskan hanya karena ada angka lain di source', () => {
  const content = {
    slides: [{
      title: 'Pembaruan ChatGPT',
      body: 'ChatGPT 5.6 membawa pembaruan baru.',
      points: [],
      claims: [{
        field: 'slide:0:body',
        text: 'ChatGPT 5.6 membawa pembaruan baru.',
        sourceId: 'source-1',
        evidence: 'OpenAI menjelaskan pembaruan baru dalam catatan rilis.'
      }]
    }]
  };
  const source = { title: 'OpenAI memperkenalkan ChatGPT 5.5', text: 'Release notes discuss version 5.5 only.' };
  assert.ok(validation.numericGroundingErrors(content, [source]).some(error => /5\.6/.test(error)));
});

test('format waktu 23.57 diselaraskan ke 23:57 bila sumber memakai waktu yang sama', () => {
  const content = {
    slides: [{
      section: 'KESIMPULAN',
      title: 'Puncak gerhana malam ini',
      body: 'Puncak gerhana diperkirakan terjadi pukul 23.57 WIB dan dapat diamati dari beberapa wilayah.',
      points: ['Puncak terjadi malam hari', 'Waktu mengikuti sumber resmi', 'Pengamatan bergantung wilayah'],
      claims: [{
        field: 'slide:0:body',
        text: 'Puncak gerhana diperkirakan terjadi pukul 23.57 WIB dan dapat diamati dari beberapa wilayah.',
        sourceId: 'source-1',
        evidence: 'Puncak gerhana dapat diamati pada malam hari.'
      }]
    }]
  };
  const sources = [{
    title: 'Jadwal gerhana matahari total',
    text: 'Puncak gerhana terjadi pukul 23:57 WIB menurut jadwal astronomi yang dipublikasikan. Pengamatan bergantung pada wilayah.'
  }];
  const repaired = finalizer.repairEquivalentTimeFormatting(content, sources);
  assert.match(repaired.slides[0].body, /23:57 WIB/);
  assert.match(repaired.slides[0].claims[0].text, /23:57 WIB/);
  assert.match(repaired.slides[0].claims[0].evidence, /23:57 WIB/);
});

test('angka desimal tanpa konteks waktu tidak diubah menjadi format jam', () => {
  const content = {
    slides: [{
      section: 'FAKTA UTAMA',
      title: 'Nilai pengujian model',
      body: 'Nilai pengujian model tercatat 23.57 pada metrik evaluasi internal yang dijelaskan sumber.',
      points: ['Nilai berasal dari pengujian', 'Metrik dijelaskan sumber resmi', 'Angka tidak diubah'],
      claims: [{
        field: 'slide:0:body',
        text: 'Nilai pengujian model tercatat 23.57 pada metrik evaluasi internal yang dijelaskan sumber.',
        sourceId: 'source-1',
        evidence: 'Nilai pengujian model tercatat 23.57 pada metrik evaluasi internal.'
      }]
    }]
  };
  const sources = [{ title: 'Evaluasi model', text: 'Nilai pengujian model tercatat 23.57 pada metrik evaluasi internal.' }];
  const repaired = finalizer.repairEquivalentTimeFormatting(content, sources);
  assert.match(repaired.slides[0].body, /23\.57/);
  assert.doesNotMatch(repaired.slides[0].body, /23:57/);
});

test('error judul natural berulang dipetakan ke field title untuk repair', () => {
  const content = {
    slides: [
      { title: 'Ask Maps hadir di Google Maps', body: 'Google memperkenalkan Ask Maps sebagai fitur baru untuk membantu eksplorasi informasi tempat.', points: [], claims: [] },
      { title: 'Ask Maps hadir di Google Maps', body: 'Fitur ini memakai konteks Maps untuk menjawab pertanyaan pengguna tentang lokasi.', points: [], claims: [] }
    ]
  };
  const fields = finalizer.resilientRecoveryFields(['slide:1:natural: judul mengulang slide 1.'], content);
  assert.equal(fields.has('slide:1:title'), true);
});

test('duplicate canonical diarahkan ke claim field yang mengulang, bukan menggagalkan semua slide', () => {
  const evidence = 'Sumber menjelaskan satu fakta yang sama untuk pengujian duplicate.';
  const content = {
    slides: [
      {
        title: 'Fakta pertama', body: 'Fakta pertama berasal dari sumber yang sama dan sudah dipakai.', points: [],
        claims: [{ field: 'slide:0:body', text: 'Fakta pertama berasal dari sumber yang sama dan sudah dipakai.', sourceId: 'source-1', evidence }]
      },
      {
        title: 'Fakta berikutnya', body: 'Fakta berikutnya masih memakai evidence canonical yang sama pada slide ini.', points: [],
        claims: [{ field: 'slide:1:body', text: 'Fakta berikutnya masih memakai evidence canonical yang sama pada slide ini.', sourceId: 'source-1', evidence }]
      }
    ]
  };
  const fields = finalizer.resilientRecoveryFields(['slide:1:duplicate: fakta canonical mengulang slide sebelumnya.'], content);
  assert.equal(fields.has('slide:1:body'), true);
});

test('judul duplicate dapat diperbaiki deterministik dari body grounded dan mendapat claim evidence', () => {
  const evidence1 = 'Google memperkenalkan Ask Maps sebagai fitur baru di layanan Maps.';
  const evidence2 = 'Ask Maps menggunakan konteks lokasi untuk membantu menjawab pertanyaan pengguna.';
  const content = {
    slides: [
      {
        title: 'Ask Maps hadir di Google Maps',
        body: 'Google memperkenalkan Ask Maps sebagai fitur baru di layanan Maps untuk pengguna.',
        points: [],
        claims: [{ field: 'slide:0:body', text: 'Google memperkenalkan Ask Maps sebagai fitur baru di layanan Maps untuk pengguna.', sourceId: 'source-1', evidence: evidence1 }]
      },
      {
        title: 'Ask Maps hadir di Google Maps',
        body: 'Ask Maps menggunakan konteks lokasi untuk membantu menjawab pertanyaan pengguna tentang tempat.',
        points: [],
        claims: [{ field: 'slide:1:body', text: 'Ask Maps menggunakan konteks lokasi untuk membantu menjawab pertanyaan pengguna tentang tempat.', sourceId: 'source-2', evidence: evidence2 }]
      }
    ]
  };
  const repaired = finalizer.repairTitleOnlyErrors(content, ['slide:1:natural: judul mengulang slide 1.']);
  assert.equal(repaired.changed, true);
  assert.notEqual(repaired.candidate.slides[1].title, repaired.candidate.slides[0].title);
  const claim = repaired.candidate.slides[1].claims.find(item => item.field === 'slide:1:title');
  assert.ok(claim);
  assert.equal(claim.sourceId, 'source-2');
  assert.equal(claim.evidence, evidence2);
});

test('prompt mewajibkan evidence title, title unik, semua source, dan target density', () => {
  const generated = { slides: [slide('Produk ini memiliki konteks faktual yang cukup jelas untuk pembaca.')], topic: 'Produk AI' };
  const sources = [
    { title: 'Sumber satu', text: 'Produk AI memiliki beberapa kemampuan baru dan tersedia bertahap.' },
    { title: 'Sumber dua', text: 'Sumber kedua memberikan konteks tambahan yang berbeda dan relevan.' }
  ];
  const prompt = finalizer.prompt({ generated, sources, facts: facts(), format: 'Fakta singkat', topic: 'Produk AI', errors: [] });
  assert.match(prompt, /claim title dengan field slide:X:title/i);
  assert.match(prompt, /Setiap title wajib berbeda antar-slide/i);
  assert.match(prompt, /Target body tetap 10-20 kata/i);
  assert.match(prompt, /Hard layout hanya 8-24 kata/i);
  assert.match(prompt, /Semua source terpilih tetap wajib menyumbang fakta visible/i);
});

test('resilient finalizer memberi dua kesempatan repair terarah tanpa loop tak terbatas', () => {
  assert.equal(finalizer.MAX_TARGETED_REPAIRS, 2);
  assert.equal(finalizer.MAX_COMPOSE_ATTEMPTS, 2);
});

test('production tetap mengunci Pakai URL sebelum memuat Auto Source dan memakai plan-first finalizer', () => {
  const patchSource = fs.readFileSync(path.join(__dirname, '../src/services/autoSourcePatch.js'), 'utf8');
  assert.match(patchSource, /if \(pakaiUrlRequested\(args\)\) return originalGenerateAndSave\(args\);/);
  assert.match(patchSource, /autoSourcePlanFinalizer/);
  assert.match(patchSource, /finalizer:\s*autoSourcePlanFinalizer/);
  assert.doesNotMatch(patchSource, /finalizer:\s*autoSourceStrictFinalizer/);
  assert.doesNotMatch(patchSource, /\[activeSources\.length,\s*1\]/);
});
