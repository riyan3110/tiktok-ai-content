const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/services/textInputComposer');
const source = 'OpenAI memperkenalkan mode baru bernama Ultrafast untuk GPT-5.6 Sol. Peningkatan kecepatan ini ditujukan untuk membuat model lebih responsif saat coding, riset, dan agen AI. GPT-5.6 Sol dirancang untuk keamanan siber dan sains.';
test('rejects vague title and relation drift', () => {
  assert.equal(c.genericSlideTitle('Kecepatan Utama'), true);
  const bad = { caption:'Mode ini ditujukan untuk coding dan riset', slides:[{title:'Mode Ultrafast Dirancang untuk Coding',body:'',points:[]}] };
  assert.match(c.validateModeSubjectShift(bad, source).join(' '), /subjek relasi berubah/i);
  const modifiers = c.validateGroundedModifiers({caption:'',slides:[{title:'Detail',body:'',points:['Cocok untuk tugas kompleks','Mendukung penggunaan komputer']}]}, source);
  assert.ok(modifiers.includes('cocok'));
  assert.ok(modifiers.includes('mendukung'));
  assert.ok(!modifiers.includes('dirancang'));
});

test('repair guidance targets exact blocked wording and generic title', () => {
  const guidance = c.buildRepairGuidance([
    'kata atau penegasan baru yang tidak ada di teks input: signifikan, kunci, mendukung',
    'slide 2: judul besar harus spesifik dan tidak boleh mengulang label section "fakta utama"'
  ]);

  assert.match(guidance, /hapus atau tulis ulang.*signifikan, kunci, mendukung/i);
  assert.match(guidance, /ganti judul slide 2/i);
  assert.match(guidance, /jangan gunakan label section/i);
});

test('status and closing broadening must also exist in text input', () => {
  const modifiers = c.validateGroundedModifiers({
    caption: 'OpenAI meluncurkan Mode Ultrafast dan menjanjikan respons lebih cepat.',
    slides: [{ title: 'Kecepatan Model', body: 'Persaingan AI kini berfokus pada kecepatan.', points: [] }]
  }, source);

  assert.ok(modifiers.includes('meluncurkan'));
  assert.ok(modifiers.includes('menjanjikan'));
  assert.ok(modifiers.includes('persaingan'));
});

test('semantic redundancy rejects comparative tautology without hardcoding a product', () => {
  const bad = c.validateSemanticRedundancy({
    caption: 'Fitur Turbo dapat mempercepat Model Atlas hingga 3 kali lebih cepat.',
    slides: []
  });
  assert.match(bad.join(' '), /redundansi makna.*mempercepat.*lebih cepat/i);

  const good = c.validateSemanticRedundancy({
    caption: 'Fitur Turbo dapat membuat Model Atlas hingga 3 kali lebih cepat.',
    slides: []
  });
  assert.deepEqual(good, []);
});

test('qualified effects stay owned by the activating feature or condition', () => {
  const genericSource = 'Perusahaan memperkenalkan Fitur Turbo untuk Model Atlas. Dengan Fitur Turbo, Model Atlas mengurangi waktu tunggu saat memproses laporan dan dapat memberikan hasil lebih cepat. Model Atlas dirancang untuk analisis dokumen.';
  const drifted = {
    caption: '',
    slides: [{
      title: 'Model Atlas untuk Analisis Dokumen',
      body: 'Model ini dirancang untuk analisis dokumen yang kompleks.',
      points: ['Memberikan hasil lebih cepat']
    }]
  };
  assert.match(c.validateQualifierOwnership(drifted, genericSource).join(' '), /konteks bersyarat hilang.*Fitur Turbo/i);

  const preserved = {
    caption: '',
    slides: [{
      title: 'Fitur Turbo untuk Model Atlas',
      body: 'Fitur Turbo mengurangi waktu tunggu saat memproses laporan.',
      points: ['Memberikan hasil lebih cepat']
    }]
  };
  assert.deepEqual(c.validateQualifierOwnership(preserved, genericSource), []);
});

test('repair guidance explains redundancy and lost qualifier generically', () => {
  const guidance = c.buildRepairGuidance([
    'slide 1 judul: redundansi makna "mempercepat ... lebih cepat"',
    'slide 3 bullet 2: konteks bersyarat hilang; fakta ini di TEXT_INPUT terkait "Fitur Turbo" dan tidak boleh dipindahkan menjadi sifat umum entitas lain'
  ]);
  assert.match(guidance, /jangan gabungkan verba.*pembanding/i);
  assert.match(guidance, /pertahankan syarat\/pengaktif\/fitur/i);
});

test('compose gives the retry exact guidance for the current validation errors', async () => {
  const text = 'Perusahaan AI menyiapkan perubahan untuk model yang didukung. Perubahan membantu proses identifikasi tanpa mengubah tampilan teks bagi pengguna. Penerapan dilakukan secara bertahap sesuai dukungan model. Informasi tersebut menjadi dasar seluruh carousel.';
  const valid = {
    topic: 'Perubahan untuk Model AI',
    caption: 'Perusahaan AI menyiapkan perubahan untuk model yang didukung. Perubahan ini membantu proses identifikasi tanpa mengubah tampilan teks, sementara penerapannya dilakukan secara bertahap sesuai dukungan model yang tersedia.',
    hashtags: ['#AI', '#Teknologi', '#ModelAI'],
    slides: [
      { section: 'HOOK', title: 'Perubahan Baru Mulai Disiapkan untuk Model AI', body: '', points: [] },
      { section: 'FAKTA UTAMA', title: 'Fokus pada Dukungan Model', body: 'Penerapan mengikuti dukungan model yang tersedia secara bertahap.', points: ['Tampilan teks tetap sama', 'Identifikasi menjadi lebih terbantu'] },
      { section: 'DETAIL', title: 'Dampak bagi Pengguna', body: 'Pengguna tetap membaca teks dengan tampilan yang sama.', points: ['Perubahan tidak mengubah tampilan', 'Penerapan dilakukan secara bertahap'] },
      { section: 'PENUTUP', title: 'Garis Besarnya', body: 'Perubahan berfokus pada identifikasi dan tampilan teks, dengan penerapan yang tetap mengikuti dukungan model secara bertahap.', points: [] }
    ]
  };
  const invalid = JSON.parse(JSON.stringify(valid));
  invalid.caption = invalid.caption.replace('membantu', 'mendukung');
  invalid.slides[1].title = 'Fakta Utama';

  const outputs = [invalid, valid];
  const requests = [];
  const client = {
    chat: {
      completions: {
        create: async request => {
          requests.push(request);
          return { choices: [{ message: { content: JSON.stringify(outputs.shift()) } }] };
        }
      }
    }
  };

  const result = await c.compose({ text, client });
  assert.equal(requests.length, 2);
  const repairPrompt = requests[1].messages.at(-1).content;
  assert.match(repairPrompt, /hapus atau tulis ulang.*mendukung/i);
  assert.match(repairPrompt, /ganti judul slide 2/i);
  assert.equal(result.slides[1].title, 'Fokus pada Dukungan Model');
});
