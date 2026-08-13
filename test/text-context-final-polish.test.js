const test = require('node:test');
const assert = require('node:assert/strict');
const composer = require('../src/services/textInputComposer');
const images = require('../src/services/images');

const source = 'OpenAI memperkenalkan mode baru bernama Ultrafast untuk GPT-5.6 Sol. Mode ini membuat GPT-5.6 Sol bekerja hingga 14 kali lebih cepat. GPT-5.6 Sol sendiri merupakan model unggulan untuk coding, riset, keamanan siber, sains, dan desain.';

test('text context guard rejects publisher bullets and entity swaps', () => {
  const content = {
    topic: 'Ultrafast', caption: 'Ringkasan.', slides: [
      { section: 'HOOK', title: 'Ultrafast Mode Mempercepat GPT-5.6 Sol 14 Kali', body: '', points: [] },
      { section: 'FAKTA UTAMA', title: 'Kecepatan Ultrafast', body: 'Mode ini membuat model bekerja lebih cepat.', points: ['Diklaim oleh TechCrunch', 'Untuk coding dan riset'] },
      { section: 'DETAIL', title: 'Aplikasi dan Manfaat Ultrafast', body: 'Untuk pekerjaan kompleks.', points: ['Model dirancang untuk keamanan siber'] },
      { section: 'PENUTUP', title: 'Persaingan AI', body: 'Kecepatan model Ultrafast semakin penting.', points: [] }
    ]
  };
  const repaired = composer.repairSafeWording(content, source);
  assert.match(repaired.slides[0].title, /^Mode Ultrafast/);
  const issues = composer.contextIssues(repaired, source).join(' | ');
  assert.match(issues, /publisher/);
  assert.match(issues, /bukan model|membingkai fakta model/i);
  assert.match(issues, /14 kali lebih cepat/i);
});

test('renderer preparation changes only text_input_only content', () => {
  const textInput = {
    verificationStatus: 'text_input_only', contentFormat: 'Tutorial langkah', slides: [
      { section: 'HOOK', title: 'Mode Ultrafast Bikin GPT-5.6 Sol Lebih Cepat', body: '', points: [] },
      { section: 'FAKTA UTAMA', title: 'Kecepatan Ultrafast', body: 'Mode ini mempercepat model.', points: ['14 kali lebih cepat', 'Untuk coding dan riset'] }
    ]
  };
  const prepared = images.prepareTextInputContent(textInput);
  assert.equal(prepared.contentFormat, 'Generate dari Teks');
  assert.ok(prepared.slides[0].body.length >= 70);
  assert.ok(prepared.slides[0].body.includes('\u200B'));
  assert.ok(prepared.slides[1].points[0].startsWith('\u200B14'));

  const urlMode = { verificationStatus: 'source_based', contentFormat: 'Tutorial langkah', slides: textInput.slides };
  assert.equal(images.prepareTextInputContent(urlMode), urlMode);
});
