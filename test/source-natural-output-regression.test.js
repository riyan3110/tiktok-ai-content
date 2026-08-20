const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { extractText, cleanArticleLines } = require('../src/services/sourceFetcher');
const {
  buildDeterministicSourceFallback,
  validateSourceContent,
  naturalCopyErrors,
  sourceFacts,
  compactPoint
} = require('../src/services/manualSourceFallback');
const { finalizerPrompt } = require('../src/services/sourceUrlFinalizer');

const badEnd = /\b(?:yang|dan|atau|di|ke|dari|dengan|oleh|pada|untuk|sebagai|secara|adalah|merupakan|berada|memiliki|menjadi|termasuk|maupun|karena|agar|jika|bila|saat|ketika|dalam|ini|itu)$/i;

test('sourceFetcher membuang metadata publisher dan headline Baca Juga tetapi mempertahankan isi utama', () => {
  const cleaned = cleanArticleLines([
    'Model AI China Kuasai Dunia, Ini 5 Daftar AI Paling Populer',
    'CNN Indonesia Jumat, 07 Agu 2026 15:30 WIB url telah diperbarui',
    'Baca Juga',
    'Usai Robot, AS Siapkan Larangan Perangkat Data',
    'Jakarta, CNN Indonesia -- Berbagai model kecerdasan buatan asal China mulai menguasai dunia.',
    'OpenRouter merilis peringkat penggunaan model berdasarkan aktivitas pengguna di platformnya.'
  ].join('\n'), 'Model AI China Kuasai Dunia, Ini 5 Daftar AI Paling Populer');

  assert.doesNotMatch(cleaned, /CNN Indonesia Jumat|15:30 WIB|url telah/i);
  assert.doesNotMatch(cleaned, /Usai Robot, AS Siapkan Larangan Perangkat Data/i);
  assert.doesNotMatch(cleaned, /^Model AI China Kuasai Dunia/m);
  assert.match(cleaned, /Berbagai model kecerdasan buatan asal China mulai menguasai dunia/i);
  assert.match(cleaned, /OpenRouter merilis peringkat penggunaan model/i);
});

test('extractText membersihkan related block di dalam article HTML', () => {
  const html = `<!doctype html><html><head><meta property="og:title" content="Model AI China Kuasai Dunia"></head><body><article>
    <p>CNN Indonesia Jumat, 07 Agu 2026 15:30 WIB url telah diperbarui</p>
    <p>Baca Juga</p><h3>Usai Robot, AS Siapkan Larangan Perangkat Data</h3>
    <p>Jakarta, CNN Indonesia -- Berbagai model kecerdasan buatan asal China mulai menguasai dunia dan menarik perhatian pengguna global.</p>
    <p>OpenRouter merilis peringkat penggunaan model berdasarkan aktivitas pengguna di platformnya dan menempatkan beberapa model China di posisi atas.</p>
  </article></body></html>`;
  const result = extractText(html, 'text/html; charset=utf-8');
  assert.doesNotMatch(result.text, /15:30 WIB|Usai Robot|Baca Juga/i);
  assert.match(result.text, /Berbagai model kecerdasan buatan asal China/i);
});

test('fact bank tidak memasukkan metadata situs yang terlihat seperti kalimat', () => {
  const input = [{
    url: 'https://example.test/a',
    title: 'Model AI China',
    text: [
      'CNN Indonesia Jumat, 07 Agu 2026 15:30 WIB url telah diperbarui.',
      'OpenRouter merilis peringkat penggunaan model berdasarkan aktivitas pengguna di platformnya.',
      'Lima posisi teratas ditempati beberapa model AI buatan China menurut data yang dikutip artikel.'
    ].join('\n')
  }];
  const facts = sourceFacts(input);
  assert.ok(facts.length >= 2);
  assert.equal(facts.some(fact => /15:30 WIB|url telah/i.test(fact.evidence)), false);
});

test('compactPoint tidak memotong bullet pada kata gantung', () => {
  const point = compactPoint('Dua model buatan DeepSeek yang berada di peringkat berikutnya menurut data tersebut.');
  assert.ok(point.split(/\s+/).length >= 3 && point.split(/\s+/).length <= 7);
  assert.doesNotMatch(point, badEnd);
  assert.notEqual(point, 'Dua model buatan DeepSeek yang berada di');
});

test('validator menolak judul fallback generik dan bullet fragmen seperti screenshot', () => {
  const content = {
    slides: [{
      title: 'Fakta sumber 2',
      body: 'OpenRouter merilis peringkat model AI berdasarkan penggunaan yang tercatat pada platform tersebut.',
      points: ['Dua model buatan DeepSeek berada di', 'Posisi berikutnya secara berurutan adalah'],
      claims: []
    }]
  };
  const errors = naturalCopyErrors(content);
  assert.ok(errors.some(error => /judul generik fallback dilarang/i.test(error)));
  assert.ok(errors.some(error => /bullet terpotong|kata gantung/i.test(error)));
});

function richArticle() {
  return Array.from({ length: 22 }, (_, index) =>
    `Fakta ${index + 1} menjelaskan perkembangan model kecerdasan buatan dengan konteks berbeda yang tetap relevan dan dapat diverifikasi dari artikel utama.`
  ).join(' ');
}

test('deterministic fallback terakhir tetap menghasilkan judul spesifik, body penuh, dan bullet utuh', () => {
  const sources = [{ url: 'https://example.test/rich', title: 'Perkembangan Model AI', text: richArticle() }];
  const fallback = buildDeterministicSourceFallback({
    generated: { topic: 'Perkembangan model AI' },
    sources,
    topic: 'Perkembangan model AI',
    requestedFormat: 'Fakta singkat'
  });

  assert.equal(fallback.slides.length, 5);
  fallback.slides.forEach((slide, index) => {
    assert.doesNotMatch(slide.title, /^(?:Ringkasan|Fakta|Kesimpulan).*sumber|^Poin \d+ dari sumber/i);
    assert.ok(slide.body.split(/\s+/).length >= 10, `body slide ${index + 1} terlalu pendek`);
    assert.equal(slide.points.length, 3);
    slide.points.forEach(point => {
      assert.ok(point.split(/\s+/).length >= 3 && point.split(/\s+/).length <= 7);
      assert.doesNotMatch(point, badEnd);
    });
  });
  assert.equal(validateSourceContent(fallback, sources).length, 0);
});

test('prompt final AI eksplisit melarang generic title, metadata, related headline, dan fragment bullet', () => {
  const sources = [{
    url: 'https://example.test/a',
    title: 'Model AI China',
    text: richArticle()
  }];
  const facts = sourceFacts(sources);
  const prompt = finalizerPrompt({
    generated: { slides: Array.from({ length: 5 }, (_, index) => ({ section: index === 0 ? 'PEMBUKA' : index === 4 ? 'KESIMPULAN' : index === 1 ? 'FAKTA UTAMA' : index === 2 ? 'PENJELASAN' : 'KONTEKS', title: `Fakta sumber ${index + 1}` })) },
    sources,
    facts,
    format: 'Fakta singkat',
    topic: 'Model AI China',
    errors: ['slide:1:natural: judul generik fallback dilarang']
  });
  assert.match(prompt, /DILARANG memakai judul generik/i);
  assert.match(prompt, /publisher\/byline/i);
  assert.match(prompt, /headline artikel terkait/i);
  assert.match(prompt, /kata gantung/i);
  assert.match(prompt, /draf.*BOLEH DIBUANG TOTAL/i);
});