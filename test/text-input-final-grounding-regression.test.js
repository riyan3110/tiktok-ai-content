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
