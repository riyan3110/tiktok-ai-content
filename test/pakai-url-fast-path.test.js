const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { createDatabase } = require('../src/db');
const generation = require('../src/services/generation');
const finalizer = require('../src/services/sourceUrlFinalizer');
const roleGuard = require('../src/services/manualSourceRoleGuard');
const fallback = require('../src/services/manualSourceFallback');

function source() {
  return {
    url: 'https://example.test/article',
    finalUrl: 'https://example.test/article',
    title: 'AI Ubah Cara Mahasiswa Belajar',
    fetchedAt: new Date().toISOString(),
    text: [
      'AI membantu mahasiswa mencari penjelasan tambahan ketika memahami materi kuliah yang sulit.',
      'Dosen tetap berperan penting untuk memberi konteks dan memeriksa kualitas jawaban mahasiswa.',
      'Mahasiswa dapat memakai AI untuk merangkum bahan belajar sebelum membahasnya kembali di kelas.',
      'Penggunaan AI perlu disertai pemeriksaan sumber agar informasi tetap dapat dipertanggungjawabkan.',
      'Kampus mendorong mahasiswa memahami cara kerja alat AI dan batas kemampuan model yang digunakan.',
      'Diskusi kelas tetap dibutuhkan karena proses belajar tidak hanya bergantung pada jawaban otomatis.',
      'Pengajar dapat menyesuaikan tugas agar mahasiswa menjelaskan alasan di balik jawaban yang dibuat.',
      'Literasi AI menjadi bagian penting ketika teknologi semakin sering digunakan dalam kegiatan akademik.'
    ].join(' ')
  };
}

test('Pakai URL production manual langsung memakai bounded URL finalizer dan tidak masuk role-repair panjang', async t => {
  const db = createDatabase(':memory:');
  t.after(() => db.close());

  const originalFinalizer = finalizer.rewriteAllSourcesWithAi;
  const originalRoleGuard = roleGuard.repairManualSourceRoles;
  let finalizerCalls = 0;
  let roleGuardCalls = 0;

  finalizer.rewriteAllSourcesWithAi = async ({ generated, sources, topic, format }) => {
    finalizerCalls += 1;
    return fallback.buildDeterministicSourceFallback({
      generated,
      sources,
      topic,
      requestedFormat: format
    });
  };
  roleGuard.repairManualSourceRoles = async () => {
    roleGuardCalls += 1;
    throw new Error('default role guard tidak boleh dipakai oleh explicit Pakai URL fast path');
  };
  t.after(() => {
    finalizer.rewriteAllSourcesWithAi = originalFinalizer;
    roleGuard.repairManualSourceRoles = originalRoleGuard;
  });

  const activeSource = source();
  const sourceFetcher = {
    validateSourceUrls(urls) { return urls; },
    async fetchSources() { return [activeSource]; },
    buildSourceContext() { return ''; }
  };
  const images = {
    async createSlides(_key, payload) {
      return payload.slides.map((_, index) => `/generated/url-${index + 1}.jpg`);
    }
  };

  const id = await generation.generateAndSave({
    db,
    mode: 'manual',
    requestedTopic: 'AI Ubah Cara Mahasiswa Belajar',
    category: 'Edukasi teknologi',
    format: 'Fakta singkat',
    useTrendReference: false,
    useSources: true,
    sourceUrls: [activeSource.url],
    sourceFetcher,
    images
  });

  assert.ok(id > 0);
  assert.equal(finalizerCalls, 1, 'Pakai URL hanya masuk satu bounded finalizer flow');
  assert.equal(roleGuardCalls, 0, 'loop role-repair lama dilewati untuk explicit Pakai URL');
});
