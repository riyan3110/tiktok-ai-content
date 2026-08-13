const test = require('node:test');
const assert = require('node:assert/strict');
const composer = require('../src/services/textInputComposer');
const images = require('../src/services/images');

const source = 'OpenAI memperkenalkan mode baru bernama Ultrafast untuk GPT-5.6 Sol. Mode ini membuat GPT-5.6 Sol bekerja hingga 14 kali lebih cepat dibanding penggunaan biasa. GPT-5.6 Sol sendiri merupakan model unggulan untuk coding, riset, keamanan siber, sains, dan desain.';

test('context guard catches publisher bullet, mode/model swap, and cut comparison', () => {
  assert.equal(composer.attributionOnlyPoint('Diklaim oleh TechCrunch'), true);
  const bad = {
    topic: 'Ultrafast', caption: '', slides: [
      { title: 'Ultrafast Mode Mempercepat GPT-5.6 Sol 14 Kali', body: '', points: [] },
      { title: 'Aplikasi dan Manfaat Ultrafast', body: 'Untuk pekerjaan kompleks.', points: ['Model dirancang untuk keamanan siber'] },
      { title: 'Persaingan AI', body: 'Kecepatan model Ultrafast semakin penting.', points: [] }
    ]
  };
  const issues = [
    ...composer.validateEntityContext(bad, source),
    ...composer.validateComparisonCompleteness(bad, source)
  ].join(' | ');
  assert.match(issues, /Mode Ultrafast|bukan model|mencampur fakta model/i);
  assert.match(issues, /14 kali lebih cepat/i);
});

test('text-input renderer raises hook and preserves bullet semantics', () => {
  const slides = [
    { section: 'HOOK', title: 'Mode Ultrafast Bikin GPT-5.6 Sol Lebih Cepat', body: '', points: [] },
    { section: 'FAKTA UTAMA', title: 'Kecepatan Mode Ultrafast', body: 'Mode ini mempercepat GPT-5.6 Sol pada tugas kompleks.', points: ['14 kali lebih cepat', 'Untuk coding dan riset'] },
    { section: 'DETAIL', title: 'Respons untuk Tugas Kompleks', body: 'Kecepatan membantu pekerjaan kompleks terasa lebih responsif.', points: ['Agen AI butuh respons cepat', 'Riset termasuk contoh penggunaan'] },
    { section: 'PENUTUP', title: 'Kecepatan Makin Penting', body: 'Kecepatan menjalankan model semakin penting bagi aplikasi dan agen AI yang membutuhkan respons hampir real-time.', points: [] }
  ];
  const textLayouts = images.buildSlideLayouts({ slides, contentFormat: 'Tutorial langkah', verificationStatus: 'text_input_only' });
  assert.equal(textLayouts[0].textInputHook, true);
  assert.equal(textLayouts[1].content.points[0].text, '• 14 kali lebih cepat');
  assert.equal(textLayouts[1].content.points[1].text, '• Untuk coding dan riset');
  const hookSvg = images.renderLayout(textLayouts[0], 1, 4, { enabled: false }, {});
  assert.match(hookSvg, /y="680"/);

  const urlLayouts = images.buildSlideLayouts({ slides, contentFormat: 'Tutorial langkah', verificationStatus: 'source_based' });
  assert.equal(urlLayouts[0].textInputHook, false);
  assert.match(urlLayouts[1].content.points[0].text, /^1\./);
});
