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
