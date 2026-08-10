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

test('extractText mempertahankan article utama yang memakai class latest-news atau trending', () => {
  const html = `
    <html><head><title>Berita AI Hari Ini</title></head><body>
      <article class="latest-news trending">
        <h1>Berita AI Hari Ini</h1>
        <p>Artikel utama menjelaskan perkembangan AI terbaru dengan konteks yang relevan untuk pembaca.</p>
        <p>Paragraf kedua menambahkan fakta utama lain dan tetap merupakan bagian dari artikel halaman ini.</p>
        <p>Paragraf ketiga memastikan article utama cukup jelas dan tidak boleh dibuang hanya karena nama class.</p>
      </article>
      <div class="recommended-article"><p>Artikel rekomendasi yang berbeda topik.</p></div>
    </body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Artikel utama menjelaskan perkembangan AI terbaru/);
  assert.match(result.text, /Paragraf ketiga/);
  assert.doesNotMatch(result.text, /Artikel rekomendasi/);
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

test('extractText memilih JSON-LD yang cocok dengan H1 walau related article lebih panjang', () => {
  const mainBody = 'FAKTA UTAMA DAYA INGAT menjelaskan apel, alpukat, buah beri, pisang, dan jambu biji dengan rincian yang relevan terhadap memori. '.repeat(3);
  const relatedBody = 'FAKTA TERKAIT ASAM URAT membahas topik lain yang sengaja dibuat jauh lebih panjang daripada artikel utama dan tidak boleh dipilih. '.repeat(7);
  const html = `
    <html><head><title>5 Buah untuk Daya Ingat | Portal Sehat</title>
      <script type="application/ld+json">${JSON.stringify([
        { '@type': 'NewsArticle', headline: '5 Buah untuk Daya Ingat', articleBody: mainBody, mainEntityOfPage: true },
        { '@type': 'NewsArticle', headline: '7 Buah untuk Asam Urat', articleBody: relatedBody }
      ])}</script>
    </head><body><main><h1>5 Buah untuk Daya Ingat</h1></main></body></html>`;
  const result = extractText(html, 'text/html');
  assert.equal(result.title, '5 Buah untuk Daya Ingat');
  assert.match(result.text, /FAKTA UTAMA DAYA INGAT/);
  assert.doesNotMatch(result.text, /FAKTA TERKAIT ASAM URAT/);
});

test('extractText membersihkan tag HTML di JSON-LD articleBody dan mempertahankan batas paragraf', () => {
  const articleBody = '<p>Apel dijelaskan sebagai buah pertama untuk pembahasan daya ingat dengan fakta yang cukup rinci.</p><p>Alpukat dijelaskan sebagai buah kedua dengan penjelasan berbeda yang tetap relevan dengan memori.</p><p>Buah beri menjadi item ketiga dan memiliki uraian lain yang tidak boleh menyatu menjadi satu kalimat panjang.</p>';
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'Article', headline: 'Daftar Buah untuk Daya Ingat', articleBody })}</script></head><body></body></html>`;
  const result = extractText(html, 'text/html');
  assert.doesNotMatch(result.text, /<\/?p>/i);
  assert.match(result.text, /Apel dijelaskan sebagai buah pertama/);
  assert.match(result.text, /Alpukat dijelaskan sebagai buah kedua/);
  assert.ok(result.text.split('\n').filter(Boolean).length >= 3);
});

test('extractText membuang related card yang bersarang di dalam container artikel normal', () => {
  const html = `
    <html><body><article>
      <div class="article-body">
        <p>Apel menjadi bagian pertama dari artikel utama tentang pilihan buah dan fungsi memori.</p>
        <div class="content-row">
          <p>Alpukat menjadi bagian kedua artikel dan tetap merupakan konten utama yang harus dipertahankan.</p>
          <div class="recommended-article"><p>5 buah ini dapat menurunkan asam urat secara alami.</p></div>
          <p>Buah beri menjadi bagian ketiga artikel utama dan tetap harus muncul setelah kartu rekomendasi dibuang.</p>
        </div>
      </div>
    </article></body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Apel menjadi bagian pertama/);
  assert.match(result.text, /Alpukat menjadi bagian kedua/);
  assert.match(result.text, /Buah beri menjadi bagian ketiga/);
  assert.doesNotMatch(result.text, /asam urat/i);
});

test('extractText membuang noisy block dengan class HTML tanpa tanda kutip', () => {
  const html = `
    <html><body><article>
      <p>Konten utama tentang daya ingat tetap harus dipertahankan oleh extractor artikel.</p>
      <div class=related-article><p>8 buah dapat membantu membakar lemak perut dalam sebulan.</p></div>
      <p>Fakta utama berikutnya tentang memori juga tetap berada di badan artikel.</p>
    </article></body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Konten utama tentang daya ingat/);
  assert.match(result.text, /Fakta utama berikutnya tentang memori/);
  assert.doesNotMatch(result.text, /lemak perut/i);
});

test('extractText mempertahankan paragraf main article setelah nested article card', () => {
  const html = `
    <html><body>
      <article class="main-story">
        <p>Paragraf utama pertama menjelaskan konteks artikel tentang fungsi memori dan pilihan buah.</p>
        <article class="related-article"><p>Kartu nested membahas asam urat dan tidak boleh menjadi sumber utama.</p></article>
        <p>Paragraf utama setelah nested article tetap wajib dipertahankan karena masih bagian dari artikel utama.</p>
        <p>Paragraf penutup artikel utama juga harus tetap tersedia untuk membangun fact bank lengkap.</p>
      </article>
    </body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Paragraf utama pertama/);
  assert.match(result.text, /Paragraf utama setelah nested article/);
  assert.match(result.text, /Paragraf penutup artikel utama/);
  assert.doesNotMatch(result.text, /asam urat/i);
});

test('extractText mengabaikan tag article palsu di script dan komentar', () => {
  const html = `
    <html><body>
      <!-- <article class="related-article"><p>Artikel palsu di komentar.</p></article> -->
      <article class="main-story">
        <p>Paragraf utama sebelum script tetap menjadi bagian dari artikel yang benar.</p>
        <script>const fake = '<article class="related-article"><p>Artikel palsu dari JavaScript.</p></article>';</script>
        <p>Paragraf utama setelah script juga harus tetap dipertahankan oleh extractor.</p>
        <p>Paragraf ketiga membuat artikel utama cukup lengkap untuk dipilih sebagai sumber.</p>
      </article>
    </body></html>`;
  const result = extractText(html, 'text/html');
  assert.match(result.text, /Paragraf utama sebelum script/);
  assert.match(result.text, /Paragraf utama setelah script/);
  assert.match(result.text, /Paragraf ketiga/);
  assert.doesNotMatch(result.text, /Artikel palsu/i);
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
