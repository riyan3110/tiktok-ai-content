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
        <p>Fakta utama artikel ada di sini.</p>
        <aside>Newsletter dan rekomendasi.</aside>
        <p>Fakta kedua artikel tetap dipakai.</p>
      </article>
      <footer>Footer situs</footer>
    </body></html>`;
  const result = extractText(html, 'text/html; charset=utf-8');
  assert.equal(result.title, 'Judul Artikel');
  assert.match(result.text, /Fakta utama artikel/);
  assert.match(result.text, /Fakta kedua artikel/);
  assert.doesNotMatch(result.text, /Promo sebelum artikel|Header situs|Footer situs|Newsletter/);
});

test('extractText memilih article utama dan tidak menggabungkan kartu artikel terkait', () => {
  const html = `
    <html><head><meta property="og:title" content="5 Buah untuk Daya Ingat"></head><body>
      <article class="article-detail">
        <h1>5 Buah untuk Daya Ingat</h1>
        <p>Apel dibahas sebagai buah pertama dalam artikel utama tentang daya ingat dan kesehatan otak.</p>
        <p>Alpukat dibahas sebagai buah kedua dengan nutrisi yang relevan terhadap kesehatan otak.</p>
        <p>Buah beri dibahas sebagai buah ketiga dalam daftar utama yang sedang dibaca.</p>
        <p>Pisang dibahas sebagai buah keempat dalam daftar utama tentang kesehatan otak.</p>
        <p>Jambu biji dibahas sebagai buah kelima dalam daftar utama artikel tersebut.</p>
        <div class="related-articles">
          <a>5 buah ini dapat membantu menurunkan asam urat secara alami</a>
          <a>8 buah dapat membantu membakar lemak perut dalam sebulan</a>
        </div>
      </article>
      <article class="related-card"><p>Artikel lain tentang lemak perut yang tidak boleh menjadi sumber carousel.</p></article>
    </body></html>`;
  const result = extractText(html, 'text/html');
  assert.equal(result.title, '5 Buah untuk Daya Ingat');
  assert.match(result.text, /Apel dibahas/);
  assert.match(result.text, /Jambu biji dibahas/);
  assert.doesNotMatch(result.text, /asam urat|lemak perut|Artikel lain/i);
});

test('extractText membuang related/sidebar di dalam main ketika article tidak tersedia', () => {
  const html = `
    <html><body><main>
      <section class="content-body"><p>Isi utama halaman berada di sini dan harus dipakai sebagai sumber.</p>${'<p>Fakta utama tambahan tetap relevan.</p>'.repeat(6)}</section>
      <section class="recommendation-widget"><p>8 buah pembakar lemak perut.</p></section>
      <div id="baca-juga"><p>5 buah penurun asam urat.</p></div>
    </main></body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Isi utama halaman/);
  assert.doesNotMatch(result.text, /lemak perut|asam urat/i);
});

test('extractText membuang related block yang nested di dalam wrapper article biasa', () => {
  const html = `
    <html><body><article>
      <div class="content">
        <p>Fakta utama tentang daya ingat tetap dipakai sebagai isi artikel.</p>
        <div class="related">
          <p>5 buah dapat membantu menurunkan asam urat secara alami.</p>
          <div><p>8 buah pembakar lemak perut juga rekomendasi lain.</p></div>
        </div>
        <p>Fakta utama kedua tentang kesehatan otak tetap dipakai dalam artikel.</p>
      </div>
    </article></body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Fakta utama tentang daya ingat/);
  assert.match(result.text, /Fakta utama kedua tentang kesehatan otak/);
  assert.doesNotMatch(result.text, /asam urat|lemak perut/i);
});

test('extractText tidak membuang wrapper artikel hanya karena atribut data mengandung kata widget', () => {
  const html = `
    <html><body><article>
      <div class="content" data-widget-version="1" data-related-mode="off" data-class="related" data-id="sidebar">
        <p>Fakta utama artikel tetap harus dipertahankan meskipun wrapper memiliki atribut data teknis.</p>
        <p>Fakta kedua artikel juga tetap tersedia untuk membangun carousel yang benar.</p>
      </div>
    </article></body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Fakta utama artikel tetap harus dipertahankan/);
  assert.match(result.text, /Fakta kedua artikel juga tetap tersedia/);
});

test('self-closing low-value tag tidak menelan isi artikel setelahnya', () => {
  const html = `<html><body><article><div class="related"/><p>Isi utama setelah marker terkait tetap harus terbaca dan tidak ikut tersapu.</p>${'<p>Fakta tambahan artikel utama tetap tersedia.</p>'.repeat(5)}</article></body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Isi utama setelah marker terkait tetap harus terbaca/);
  assert.match(result.text, /Fakta tambahan artikel utama tetap tersedia/);
});

test('extractText memprioritaskan JSON-LD articleBody dibanding markup halaman yang berisik', () => {
  const articleBody = 'Apel dan buah beri dibahas dalam artikel utama tentang daya ingat. '.repeat(8);
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Article', articleBody })}</script></head><body><main>${'Noise artikel rekomendasi. '.repeat(50)}</main></body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Apel dan buah beri/);
  assert.doesNotMatch(result.text, /Noise artikel rekomendasi/);
});

test('extractText tetap mendukung text/plain tanpa mengubah isi menjadi struktur HTML', () => {
  const result = extractText('Kalimat sumber plain text yang valid untuk verifikasi.', 'text/plain');
  assert.equal(result.text, 'Kalimat sumber plain text yang valid untuk verifikasi.');
});
