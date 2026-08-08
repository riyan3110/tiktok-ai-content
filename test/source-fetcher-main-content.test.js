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
