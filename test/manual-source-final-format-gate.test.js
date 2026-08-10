const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  classifyEffectiveFormat,
  formatStructureErrors,
  looksLikeUserAction,
  MAX_FORMAT_CLASSIFY_ATTEMPTS
} = require('../src/services/manualSourceFinalComposer');

function slide(section, body = 'Isi substantif dari sumber yang cukup panjang untuk menguji struktur format carousel secara deterministik dan jelas.') {
  return { section, title: section, body, points: [], claims: [] };
}

test('final format gate menolak generic fact slides yang menyamar sebagai Tutorial, Tips, atau Before-after', () => {
  const generic = { slides: [slide('PEMBUKA'), slide('FAKTA UTAMA'), slide('PENJELASAN'), slide('KESIMPULAN')] };
  assert.ok(formatStructureErrors(generic, 'Tutorial langkah', 4).length > 0);
  assert.ok(formatStructureErrors(generic, 'Tips cepat', 4).length > 0);
  assert.ok(formatStructureErrors(generic, 'Before-after', 4).length > 0);
});

test('final format gate menerima struktur Tutorial dan Masalah-solusi dengan aksi pengguna nyata', () => {
  const tutorial = { slides: [
    slide('PEMBUKA'),
    slide('LANGKAH 1', 'Di aplikasi, buka menu perangkat tertaut lalu periksa semua sesi yang sedang aktif.'),
    slide('LANGKAH 2', 'Setelah itu, pilih perangkat yang tidak dikenal lalu keluarkan sesi tersebut dari akun.'),
    slide('PENUTUP')
  ] };
  assert.deepEqual(formatStructureErrors(tutorial, 'Tutorial langkah', 4), []);

  const problem = { slides: [
    slide('MASALAH'),
    slide('SOLUSI', 'Pengguna dapat memeriksa perangkat tertaut untuk melihat sesi yang masih aktif pada akun.'),
    slide('SOLUSI', 'Pengguna dapat mengaktifkan perlindungan tambahan jika tindakan tersebut memang dijelaskan oleh sumber.'),
    slide('PENUTUP')
  ] };
  assert.deepEqual(formatStructureErrors(problem, 'Masalah dan solusi', 4), []);
});

test('action detector menerima konteks aplikasi dan menolak tindakan pelaku', () => {
  assert.equal(looksLikeUserAction('Di aplikasi WhatsApp, buka menu perangkat tertaut.'), true);
  assert.equal(looksLikeUserAction('Pengguna dapat memeriksa perangkat tertaut.'), true);
  assert.equal(looksLikeUserAction('Pelaku dapat membuka akun dari perangkat lain.'), false);
});

test('classifier retry setelah malformed response lalu mempertahankan requested format jika keputusan valid fit=true', async () => {
  let calls = 0;
  const client = { chat: { completions: { async create() {
    calls += 1;
    if (calls === 1) return { choices: [{ message: { content: '{bad json' } }] };
    return { choices: [{ message: { content: JSON.stringify({ fit: true }) } }] };
  } } } };
  const result = await classifyEffectiveFormat(client, 'Tutorial langkah', [
    { sourceId: 'source-1', evidence: 'Pengguna dapat memeriksa perangkat tertaut dan mengeluarkan sesi yang tidak dikenal.' }
  ]);
  assert.equal(result, 'Tutorial langkah');
  assert.equal(calls, 2);
});

test('classifier gagal total menghasilkan 422 dan tidak diam-diam mengubah format', async () => {
  let calls = 0;
  const client = { chat: { completions: { async create() { calls += 1; throw new Error('provider timeout'); } } } };
  await assert.rejects(
    () => classifyEffectiveFormat(client, 'Masalah dan solusi', [
      { sourceId: 'source-1', evidence: 'Pengguna dapat memeriksa perangkat tertaut dan mengeluarkan sesi yang tidak dikenal.' }
    ]),
    error => error?.status === 422 && /format tidak boleh diubah tanpa keputusan valid/i.test(error.message)
  );
  assert.equal(calls, MAX_FORMAT_CLASSIFY_ATTEMPTS);
});
