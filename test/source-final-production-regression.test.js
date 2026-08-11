const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const safety = require('../src/services/sourceSafetyPatch');

test('source sanitizer membuang editorial disclosure dan author bio tanpa membuang fakta produk', () => {
  const raw = [
    'Meta introduced Muse Glimmer as a new open-weight model for agentic tasks.',
    'Muse Glimmer was distilled from Muse Spark and can run locally on suitable hardware.',
    'TechCrunch maintains editorial independence from its corporate ownership.',
    'The reporter work has appeared in Forbes and Bloomberg.',
    'This model supports workflows that combine several steps.'
  ].join('\n');

  const cleaned = safety.sanitizeBoilerplateText(raw);
  assert.match(cleaned, /Meta introduced Muse Glimmer/i);
  assert.match(cleaned, /distilled from Muse Spark/i);
  assert.doesNotMatch(cleaned, /editorial independence/i);
  assert.doesNotMatch(cleaned, /Forbes and Bloomberg/i);
});

test('manual topic sanitizer menjaga rantai fakta Muse Glimmer dan membuang konteks jauh', () => {
  const raw = [
    'Mark Zuckerberg discussed a broad vision for artificial intelligence and regulation.',
    'Meta introduced Muse Glimmer as a new open-weight model for agentic tasks.',
    'Muse Glimmer was distilled from Muse Spark during training.',
    'The model can run locally on personal computers with suitable hardware.',
    'It can handle multi-step tasks after receiving user permission.',
    'Crew of Zuckerberg yacht did not hear about a separate incident',
    'Another unrelated article discussed a different Silicon Valley dispute.'
  ].join('\n');

  const cleaned = safety.sanitizeSourceTextForManualTopic(raw, 'Meta Muse Glimmer terbaru');
  assert.match(cleaned, /Meta introduced Muse Glimmer/i);
  assert.match(cleaned, /Muse Glimmer was distilled from Muse Spark/i);
  assert.match(cleaned, /The model can run locally/i);
  assert.match(cleaned, /It can handle multi-step tasks/i);
  assert.doesNotMatch(cleaned, /broad vision for artificial intelligence|Crew of Zuckerberg yacht|Silicon Valley dispute/i);
});

test('valid Indonesian ending ini dan itu tidak dianggap fragmen, ending yang/dari tetap ditolak', () => {
  safety.install();
  const fallback = require('../src/services/manualSourceFallback');

  const valid = {
    slides: [
      { title: 'Contoh Satu', body: 'Pengguna perlu memahami batas dari teknologi ini.', points: [] },
      { title: 'Contoh Dua', body: 'Artikel menjelaskan perubahan penting pada sistem itu.', points: [] }
    ]
  };
  const validErrors = fallback.naturalCopyErrors(valid);
  assert.equal(validErrors.some(error => /fragmen kalimat|kata gantung/i.test(error)), false);

  const invalid = {
    slides: [
      { title: 'Contoh Tiga', body: 'Perubahan tersebut berasal dari', points: [] },
      { title: 'Contoh Empat', body: 'Ini adalah fitur yang', points: [] }
    ]
  };
  const invalidErrors = fallback.naturalCopyErrors(invalid);
  assert.ok(invalidErrors.some(error => /fragmen kalimat/i.test(error)));
});

test('semantic relation gate menolak distilled-from yang diubah menjadi versi terbuka', () => {
  const content = {
    slides: [{
      claims: [{
        field: 'slide:0:body',
        text: 'Glimmer merupakan versi terbuka dari Muse Spark.',
        sourceId: 'source-1',
        evidence: 'Muse Glimmer was distilled from Muse Spark during training.'
      }]
    }]
  };
  assert.ok(safety.semanticRelationErrors(content).some(error => /lineage/i.test(error)));
});

test('semantic relation gate membedakan open-weight dan open-source', () => {
  const content = {
    slides: [{
      claims: [{
        field: 'slide:0:body',
        text: 'Glimmer adalah model sumber terbuka untuk pengembang.',
        sourceId: 'source-1',
        evidence: 'Meta released Glimmer as an open-weight model for developers.'
      }]
    }]
  };
  assert.ok(safety.semanticRelationErrors(content).some(error => /open-weight/i.test(error)));
});

test('shared final source gate menolak drift semantic generik pada visible candidate', () => {
  safety.install();
  const fallback = require('../src/services/manualSourceFallback');
  const cases = [
    ['Model Alpha adalah penerus Model Beta.', 'Model Alpha was derived from Model Beta during training.', /lineage/i],
    ['Model ini open-source.', 'The model is available as open-weight.', /open-weight/i],
    ['Model tersebut sudah dirilis.', 'The company plans to release the model next month.', /rencana|proyeksi/i],
    ['Fitur ini menjamin latensi berkurang.', 'The feature can help reduce latency.', /modalitas/i]
  ];
  for (const [body, evidence, expected] of cases) {
    const content = {
      slides: [{ title: 'Fakta Model', body, points: [], claims: [{ field: 'slide:0:body', text: body, sourceId: 'source-1', evidence }] }]
    };
    const errors = fallback.validateSourceContent(content, [{ text: evidence }]);
    assert.ok(errors.some(error => expected.test(error)), `${body}: ${errors.join(' | ')}`);
  }
});

test('shared visible-copy gate menolak complement yang belum selesai secara makna', () => {
  safety.install();
  const fallback = require('../src/services/manualSourceFallback');
  const invalid = {
    hook: 'Model bekerja 24/7 untuk memperbaiki',
    caption: 'Dirancang untuk mengatasi',
    cta: 'Sistem bertujuan untuk mempercepat',
    slides: [{ title: 'Fakta Sistem', body: 'Model bekerja 24/7 untuk memperbaiki', points: ['Fitur dibuat agar membantu', 'Dipakai untuk mengurangi'], claims: [] }]
  };
  const errors = fallback.naturalCopyErrors(invalid);
  for (const field of ['hook', 'caption', 'cta', 'slide:0:body', 'slide:0:point:0', 'slide:0:point:1']) {
    assert.ok(errors.some(error => error.startsWith(field) && /belum selesai|fragmen/i.test(error)), `${field}: ${errors.join(' | ')}`);
  }

  const valid = {
    hook: 'Pengguna perlu memahami batas teknologi ini.',
    caption: 'Model bekerja 24/7 untuk memperbaiki kesalahan konfigurasi.',
    cta: 'Pelajari sistem keamanan tersebut.',
    slides: [{ title: 'Fakta Sistem', body: 'Dirancang untuk mengatasi masalah keamanan.', points: ['Mengurangi latensi inference'] }]
  };
  assert.equal(fallback.naturalCopyErrors(valid).some(error => /belum selesai|fragmen/i.test(error)), false);
});

test('incomplete complement memakai struktur verba generik, bukan daftar topik', () => {
  safety.install();
  const fallback = require('../src/services/manualSourceFallback');
  const invalidBodies = [
    'Sistem dibuat untuk melindungi',
    'Fitur dirancang agar mencegah',
    'Proses berjalan untuk memastikan',
    'Perangkat dipakai agar mendukung',
    'Layanan digunakan untuk memproses.”'
  ];
  for (const body of invalidBodies) {
    const errors = fallback.naturalCopyErrors({ slides: [{ title: 'Uji Struktur', body, points: [] }] });
    assert.ok(errors.some(error => /belum selesai secara makna/i.test(error)), `${body}: ${errors.join(' | ')}`);
  }

  const completeBodies = [
    'Sistem dibuat untuk melindungi data pengguna.',
    'Fitur dirancang agar mencegah akses tanpa izin.',
    'Pengguna memakai ruang ini untuk bekerja.',
    'Peserta datang untuk belajar.'
  ];
  for (const body of completeBodies) {
    const errors = fallback.naturalCopyErrors({ slides: [{ title: 'Uji Struktur', body, points: [] }] });
    assert.equal(errors.some(error => /belum selesai secara makna/i.test(error)), false, `${body}: ${errors.join(' | ')}`);
  }
});

test('based-on tidak menolak open version yang memang dinyatakan evidence', () => {
  const text = 'Alpha adalah versi terbuka dari Beta.';
  const content = { slides: [{ claims: [{ field: 'slide:0:body', text, sourceId: 'source-1', evidence: 'Alpha is an open-source version based on Beta.' }] }] };
  assert.equal(safety.semanticRelationErrors(content).some(error => /lineage/i.test(error)), false);
});

test('semantic relation gate membedakan asosiasi dan sebab-akibat', () => {
  const drift = { slides: [{ claims: [{ field: 'slide:0:body', text: 'Alpha menyebabkan perubahan Beta.', evidence: 'Alpha was associated with changes in Beta.' }] }] };
  assert.ok(safety.semanticRelationErrors(drift).some(error => /non-kausal/i.test(error)));
  const faithful = { slides: [{ claims: [{ field: 'slide:0:body', text: 'Alpha menyebabkan perubahan Beta.', evidence: 'Alpha caused changes in Beta.' }] }] };
  assert.equal(safety.semanticRelationErrors(faithful).some(error => /non-kausal/i.test(error)), false);
});

test('final pre-save gate menolak recovery candidate yang masih mengalami semantic drift', () => {
  safety.install();
  const { assertFinalSourceContent } = require('../src/services/generation');
  const evidence = 'Muse Glimmer was distilled from Muse Spark during training.';
  const body = 'Glimmer merupakan versi terbuka Muse Spark.';
  const candidate = {
    slides: [{ title: 'Muse Glimmer', body, points: [], claims: [{ field: 'slide:0:body', text: body, sourceId: 'source-1', evidence }] }]
  };
  assert.throws(() => assertFinalSourceContent(candidate, [{ text: evidence }]), error => error.status === 422 && error.validationErrors.some(item => /lineage/i.test(item)));
});

test('visible natural gate menangkap wording rusak dan metadata yang terlihat', () => {
  const content = {
    slides: [{
      title: 'Muse Glimmer',
      body: 'Berat model di lisensi Apache 2.0',
      points: ['Independen editorial terjaga', 'Karya muncul di Forbes dan Bloomberg']
    }]
  };
  const errors = safety.visibleNaturalErrors(content);
  assert.ok(errors.length >= 3);
});

test('Fakta singkat memakai finalizer langsung, format lain tetap role guard', () => {
  assert.equal(safety.shouldUseFactFinalizer('Fakta singkat'), true);
  assert.equal(safety.shouldUseFactFinalizer('Listicle'), false);
  assert.equal(safety.shouldUseFactFinalizer('Masalah dan solusi'), false);
});
