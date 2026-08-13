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
