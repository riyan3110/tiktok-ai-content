const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDeterministicSourceFallback,
  validateSourceContent,
  sourceCoverageErrors,
  duplicateErrors,
  sourceFacts
} = require('../src/services/manualSourceFallback');

function sources() {
  return [
    {
      title: 'Sumber Alpha',
      text: 'Alpha menjelaskan fakta pertama yang relevan dan cukup rinci untuk dipakai sebagai isi carousel. Alpha juga memberi konteks kedua yang berbeda agar penjelasan tidak berhenti pada satu fakta saja. Detail tambahan Alpha memperkuat konteks tanpa mengambil informasi dari luar sumber.'
    },
    {
      title: 'Sumber Beta',
      text: 'Beta memuat fakta berbeda yang masih berkaitan dengan topik dan dapat diverifikasi langsung dari artikel. Penjelasan lanjutan Beta memberi detail kedua yang tidak mengulang kalimat pertama. Bagian berikutnya Beta menambah konteks lain yang tetap berasal dari halaman sumber.'
    },
    {
      title: 'Sumber Gamma',
      text: 'Gamma memberikan fakta utama lain yang berguna untuk melengkapi carousel secara source-backed. Gamma juga menjelaskan konteks tambahan yang berbeda dari fakta sebelumnya. Informasi terakhir Gamma menutup sumber dengan detail yang tetap faktual dan tidak mengandung rekomendasi situs.'
    }
  ];
}

test('fallback memakai fakta dari setiap URL dan lolos final source gate', () => {
  const input = sources();
  const content = buildDeterministicSourceFallback({ sources: input, topic: 'Topik umum', requestedFormat: 'Listicle' });
  assert.ok(content.slides.length >= 4 && content.slides.length <= 5);
  assert.deepEqual(validateSourceContent(content, input), []);
  const used = new Set(content.slides.flatMap(slide => slide.claims.map(claim => claim.sourceId)));
  assert.deepEqual([...used].sort(), ['source-1', 'source-2', 'source-3']);
});

test('final source gate menolak URL yang tidak menyumbang fakta', () => {
  const input = sources();
  const content = buildDeterministicSourceFallback({ sources: input, topic: 'Topik umum', requestedFormat: 'Listicle' });
  content.slides.forEach(slide => { slide.claims = slide.claims.filter(claim => claim.sourceId !== 'source-3'); });
  assert.ok(sourceCoverageErrors(content, input).some(error => /source-3 belum menyumbang fakta/i.test(error)));
});

test('final source gate menolak fakta canonical yang dipakai ulang lintas slide', () => {
  const input = sources();
  const content = buildDeterministicSourceFallback({ sources: input, topic: 'Topik umum', requestedFormat: 'Listicle' });
  const repeated = { ...content.slides[0].claims[0], field: 'slide:1:body', text: content.slides[1].body };
  content.slides[1].claims[0] = repeated;
  assert.ok(duplicateErrors(content).some(error => /fakta canonical mengulang/i.test(error)));
});

test('extractor final membuang boilerplate dan tetap menyediakan fakta lintas sumber', () => {
  const input = sources();
  input[0].text += ' Baca juga artikel lain yang tidak boleh ikut ke konten.';
  const facts = sourceFacts(input);
  assert.equal(facts.some(fact => /baca juga/i.test(fact.evidence)), false);
  assert.deepEqual([...new Set(facts.map(fact => fact.sourceId))].sort(), ['source-1', 'source-2', 'source-3']);
});
