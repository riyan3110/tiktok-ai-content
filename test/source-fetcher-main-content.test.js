const test = require('node:test');
const assert = require('node:assert/strict');

const { extractText } = require('../src/services/sourceFetcher');

test('extractText memprioritaskan article dan membuang area halaman di luar artikel', () => {
  const html = `
    <html><head><title>Judul Artikel</title></head><body>
      <header>Header situs</header>
      <div>Promo sebelum artikel</div>
      <article>
        <h1>Judul isi</h1>
        <p>Fakta utama artikel ada di sini dan cukup panjang untuk menjadi isi artikel utama yang valid.</p>
        <aside>Newsletter dan rekomendasi.</aside>
        <p>Fakta kedua artikel tetap dipakai karena masih berada di badan artikel utama.</p>
      </article>
      <footer>Footer situs</footer>
    </body></html>`;
  const result = extractText(html, 'text/html; charset=utf-8');
  assert.equal(result.title, 'Judul Artikel');
  assert.match(result.text, /Fakta utama artikel/);
  assert.match(result.text, /Fakta kedua artikel/);
  assert.doesNotMatch(result.text, /Promo sebelum artikel|Header situs|Footer situs|Newsletter/);
});

test('extractText memilih article utama terbesar dan tidak menggabungkan kartu related article', () => {
  const html = `
    <html><head><title>5 Buah untuk Daya Ingat</title></head><body>
      <article class="main-story">
        <h1>5 Buah untuk Daya Ingat</h1>
        <p>Apel mengandung senyawa yang dibahas artikel dalam kaitannya dengan kesehatan otak dan memori.</p>
        <p>Alpukat, buah beri, pisang, dan jambu biji juga dijelaskan satu per satu di artikel utama ini.</p>
        <p>Setiap buah memiliki penjelasan berbeda sehingga badan artikel utama jauh lebih panjang dari kartu rekomendasi.</p>
      </article>
      <article class="related-card"><h2>5 buah menurunkan asam urat</h2><p>Baca artikel terkait tentang asam urat.</p></article>
      <article class="related-card"><h2>8 buah membakar lemak perut</h2><p>Baca artikel lain tentang lemak perut.</p></article>
    </body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Apel mengandung senyawa/);
  assert.match(result.text, /Alpukat, buah beri, pisang/);
  assert.doesNotMatch(result.text, /asam urat|lemak perut/i);
});

test('extractText memprioritaskan JSON-LD articleBody dibanding kartu rekomendasi halaman', () => {
  const html = `
    <html><head><title>Judul Browser</title>
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org', '@type': 'NewsArticle',
        headline: '5 Daftar Buah yang Dapat Meningkatkan Daya Ingat',
        articleBody: 'Apel dibahas sebagai buah pertama dalam artikel daya ingat. Alpukat dijelaskan sebagai buah kedua dengan rincian berbeda. Buah beri dibahas sebagai buah ketiga. Pisang dibahas sebagai buah keempat. Jambu biji dibahas sebagai buah kelima. Semua kalimat ini merupakan badan artikel utama yang sengaja cukup panjang untuk diekstrak.'
      })}</script>
    </head><body>
      <main>
        <div class="recommended-article">5 buah ini dapat menurunkan asam urat secara alami.</div>
        <div class="related_article">8 buah dapat membantu membakar lemak perut dalam sebulan.</div>
      </main>
    </body></html>`;
  const result = extractText(html, 'text/html');
  assert.equal(result.title, '5 Daftar Buah yang Dapat Meningkatkan Daya Ingat');
  assert.match(result.text, /Apel dibahas sebagai buah pertama/);
  assert.match(result.text, /Jambu biji dibahas sebagai buah kelima/);
  assert.doesNotMatch(result.text, /asam urat|lemak perut/i);
});

test('extractText memakai main jika article tidak tersedia', () => {
  const html = `
    <html><body>
      <div>Konten situs lain</div>
      <main><p>Isi utama halaman berada di sini dan harus dipakai.</p></main>
    </body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Isi utama halaman/);
  assert.doesNotMatch(result.text, /Konten situs lain/);
});

test('extractText tetap mendukung text/plain tanpa mengubah isi menjadi struktur HTML', () => {
  const result = extractText('Kalimat sumber plain text yang valid untuk verifikasi.', 'text/plain');
  assert.equal(result.text, 'Kalimat sumber plain text yang valid untuk verifikasi.');
});
