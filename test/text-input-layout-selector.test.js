const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const softFit = require('../src/services/textInputSoftFitPatch');
const verbatim = require('../src/services/textInputVerbatimPatch');
const autoSourcePatch = require('../src/services/autoSourcePatch');
const textInputComposer = require('../src/services/textInputComposer');
const sourceUrlFinalizer = require('../src/services/sourceUrlFinalizer');

const slides = [
  { section: 'HOOK', title: 'Kegagalan Bukan Akhir dari Semua Pilihan', body: '', points: [] },
  { section: 'FAKTA UTAMA', title: 'Masih Ada Ruang untuk Bergerak', body: 'Satu hasil buruk tidak menghapus semua tindakan yang masih bisa dilakukan.', points: ['Pilihan lain tetap terbuka', 'Perhatian bisa diarahkan ulang'] },
  { section: 'DETAIL', title: 'Bedakan Hasil dan Arah Berikutnya', body: 'Yang sudah terjadi tidak harus menentukan seluruh keputusan setelahnya.', points: ['Evaluasi bagian yang gagal', 'Rapikan langkah berikutnya'] },
  { section: 'PENUTUP', title: 'Jangan Serahkan Arah Hidup pada Satu Hasil', body: 'Kekalahan boleh terasa berat, tetapi keputusan berikutnya tetap bisa disusun kembali.', points: [] }
];

function content(layout) {
  return {
    verificationStatus: 'text_input_only',
    contentFormat: 'Tutorial langkah',
    contentLayout: layout,
    slides
  };
}

test('Generate dari Teks: Default tetap memakai layout lama tanpa label routing terlihat', () => {
  const layouts = softFit.buildTextInputLayouts(content('default'));
  assert.equal(layouts.length, 4);
  assert.ok(layouts.every(layout => layout.title === verbatim.INVISIBLE_SECTION));
  assert.match(layouts[1].content.points[0].text, /^• /);
});

test('Generate dari Teks: Tutorial menampilkan langkah dan numbering', () => {
  const layouts = softFit.buildTextInputLayouts(content('tutorial'));
  assert.deepEqual(layouts.map(layout => layout.title), ['PEMBUKA', 'LANGKAH 1', 'LANGKAH 2', 'HASIL/PENUTUP']);
  assert.match(layouts[1].content.points[0].text, /^1\. /);
  assert.match(layouts[1].content.points[1].text, /^2\. /);
});

test('Generate dari Teks: Cerita memakai alur cerita tanpa numbering tutorial', () => {
  const layouts = softFit.buildTextInputLayouts(content('story'));
  assert.deepEqual(layouts.map(layout => layout.title), ['PEMBUKA CERITA', 'SITUASI', 'PERKEMBANGAN', 'PENYELESAIAN']);
  assert.match(layouts[1].content.points[0].text, /^• /);
});

test('Generate dari Teks: Berita memakai headline, fakta, konteks, perkembangan', () => {
  const layouts = softFit.buildTextInputLayouts(content('news'));
  assert.deepEqual(layouts.map(layout => layout.title), ['HEADLINE', 'FAKTA UTAMA', 'KONTEKS/DETAIL', 'PERKEMBANGAN']);
  assert.match(layouts[2].content.points[0].text, /^• /);
});

test('text composer bridge meneruskan layout yang dipilih', async () => {
  let received;
  const composer = {
    compose: async args => {
      received = args;
      return { ok: true };
    }
  };
  const result = await autoSourcePatch.composeTextInputWithFreshRetry({
    text: 'copy',
    contentLayout: 'news',
    composer
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(received.contentLayout, 'news');
});

test('Default tetap copy-locked tanpa menulis ulang copy', async () => {
  const pasted = `SLIDE 1 - HOOK
Kegagalan Bukan Akhir dari Semua Pilihan
SLIDE 2 - FAKTA UTAMA
Masih Ada Ruang untuk Bergerak
Satu hasil buruk tidak menghapus semua tindakan yang masih bisa dilakukan.
• Pilihan lain tetap terbuka
• Perhatian bisa diarahkan ulang
SLIDE 3 - DETAIL
Bedakan Hasil dan Arah Berikutnya
Yang sudah terjadi tidak harus menentukan seluruh keputusan setelahnya.
• Evaluasi bagian yang gagal
• Rapikan langkah berikutnya
SLIDE 4 - PENUTUP
Jangan Serahkan Arah Hidup pada Satu Hasil
Kekalahan boleh terasa berat, tetapi keputusan berikutnya tetap bisa disusun kembali.`;

  const result = await verbatim.composeVerbatim({ text: pasted, contentLayout: 'default' });
  assert.equal(result.contentLayout, 'default');
  assert.equal(result.slides[0].title, 'Kegagalan Bukan Akhir dari Semua Pilihan');
});

test('UI menandai satu layout aktif dengan badge centang yang jelas', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'asset-compact.css'), 'utf8');
  assert.match(css, /#legacy-studio #layout-picker \.layout-option\.active::after/);
  assert.match(css, /content:"✓"/);
});


test('Tutorial Cerita dan Berita memakai renderer visual yang berbeda', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    require('./src/services/slideSpacingPatch').install();
    const images = require('./src/services/images');
    const slide = { section: 'SITUASI', title: 'Judul cerita yang cukup jelas', body: 'Isi singkat untuk menguji komposisi visual.', points: ['Poin pertama yang jelas', 'Poin kedua yang jelas'] };
    const background = { color: '#f5efe4', textColor: '#000000' };
    for (const style of ['tutorial','story','news']) {
      const layout = images.buildStructuredLayout(slide, 1, 4, 'Fakta singkat', { textInputOnly: true, layoutStyle: style });
      process.stdout.write(images.renderLayout(layout, 2, 4, { enabled: false }, background) + '\\n---' + style + '---\\n');
    }
  `;
  const output = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const tutorialSvg = output.split('---tutorial---')[0];
  const storySvg = output.split('---tutorial---')[1].split('---story---')[0];
  const newsSvg = output.split('---story---')[1].split('---news---')[0];

  assert.match(tutorialSvg, /data-layout="tutorial"/);
  assert.match(tutorialSvg, />TUTORIAL<\/text>/);
  assert.match(tutorialSvg, /width="920"/);
  assert.match(tutorialSvg, />1<\/text>/);
  assert.doesNotMatch(tutorialSvg, /•/);

  assert.match(storySvg, /data-layout="story"/);
  assert.match(storySvg, />CERITA<\/text>/);
  assert.match(storySvg, /width="920"/);
  assert.doesNotMatch(storySvg, /•/);
  assert.doesNotMatch(storySvg, /<circle/);

  assert.match(newsSvg, /data-layout="news"/);
  assert.match(newsSvg, />BERITA<\/text>/);
  assert.match(newsSvg, /FAKTA 1/);
  assert.match(newsSvg, /width="920"/);
  assert.doesNotMatch(newsSvg, /•/);
});

test('empat tombol tata letak memenuhi lebar panel dan tetap nyaman disentuh', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'asset-compact.css'), 'utf8');
  assert.match(css, /#legacy-studio #content-generator > #layout-picker[\s\S]*grid-column:1\/-1!important/);
  assert.match(css, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
  assert.match(css, /min-height:82px!important/);
  assert.match(css, /width:27px!important/);
});

test('AI prompt berubah sesuai tombol tata letak dan Default tetap identik dengan prompt lama', () => {
  const source = 'Teks sumber panjang yang menjelaskan sebuah kejadian, urutan proses, konteks utama, fakta pendukung, dan penutup tanpa menambahkan informasi dari luar bahan pengguna.';
  const legacy = textInputComposer.legacyDefaultPrompt(source, 4);
  assert.equal(textInputComposer.promptFor(source, 4, 'default'), legacy);

  const tutorial = textInputComposer.promptFor(source, 4, 'tutorial');
  assert.match(tutorial, /TATA LETAK DIPILIH USER: TUTORIAL/);
  assert.match(tutorial, /PEMBUKA → LANGKAH 1 → LANGKAH 2 → HASIL\/PENUTUP/);
  assert.match(tutorial, /KARTU TINDAKAN/);
  assert.doesNotMatch(tutorial, /Slide 2 = FAKTA UTAMA/);

  const story = textInputComposer.promptFor(source, 4, 'story');
  assert.match(story, /TATA LETAK DIPILIH USER: STORY/);
  assert.match(story, /PEMBUKA CERITA → SITUASI → PERKEMBANGAN → PENYELESAIAN/);
  assert.match(story, /PARAGRAF NARATIF/);
  assert.match(story, /BUKAN bullet\/list/);
  assert.doesNotMatch(story, /Slide 2 = FAKTA UTAMA/);

  const news = textInputComposer.promptFor(source, 4, 'news');
  assert.match(news, /TATA LETAK DIPILIH USER: NEWS/);
  assert.match(news, /HEADLINE → FAKTA UTAMA → KONTEKS\/DETAIL → PERKEMBANGAN/);
  assert.match(news, /KARTU FAKTA/);
  assert.match(news, /piramida terbalik/i);
});

test('patch runtime: non-default memakai AI composer', () => {
  const { execFileSync } = require('node:child_process');
  const script = [
    "const composer = require('./src/services/textInputComposer');",
    "const calls = [];",
    "composer.compose = async args => { calls.push(args); return { delegated: true, layout: args.contentLayout }; };",
    "delete require.cache[require.resolve('./src/services/textInputVerbatimPatch')];",
    "const patch = require('./src/services/textInputVerbatimPatch');",
    "patch.install();",
    "(async () => {",
    "  const story = await composer.compose({ text: 'teks bebas yang cukup panjang', contentLayout: 'story' });",
    "  process.stdout.write(JSON.stringify({ story, calls }));",
    "})().catch(error => { console.error(error); process.exit(1); });"
  ].join('\n');
  const output = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const parsed = JSON.parse(output);
  assert.equal(parsed.story.delegated, true);
  assert.equal(parsed.story.layout, 'story');
  assert.equal(parsed.calls[0].contentLayout, 'story');
});

test('Pakai URL menerima layout sebagai instruksi AI, bukan dekorasi', () => {
  const facts = [
    { sourceId: 'source-1', evidence: 'Informasi utama berasal dari sumber yang sama dan menjelaskan peristiwa secara faktual.' },
    { sourceId: 'source-1', evidence: 'Konteks tambahan tersedia untuk menjelaskan perkembangan peristiwa tanpa spekulasi.' }
  ];
  const sources = [{ url: 'https://example.com/a', finalUrl: 'https://example.com/a', title: 'Sumber A', text: facts.map(item => item.evidence).join(' ') }];
  const generated = {
    topic: 'Topik Uji',
    slides: [
      { section: 'PEMBUKA CERITA', title: 'Pembuka', body: 'Isi awal yang cukup panjang untuk konteks cerita.', points: [] },
      { section: 'SITUASI', title: 'Situasi', body: 'Isi situasi yang cukup panjang untuk konteks cerita.', points: [] },
      { section: 'PERKEMBANGAN', title: 'Perkembangan', body: 'Isi perkembangan yang cukup panjang untuk konteks cerita.', points: [] },
      { section: 'PENYELESAIAN', title: 'Penutup', body: 'Isi penutup yang cukup panjang untuk konteks cerita.', points: [] }
    ]
  };

  const storyPrompt = sourceUrlFinalizer.finalizerPrompt({
    generated, sources, facts, format: 'Fakta singkat', topic: 'Topik Uji', errors: [], contentLayout: 'story'
  });
  assert.match(storyPrompt, /TATA LETAK DIPILIH USER: "story"/);
  assert.match(storyPrompt, /points harus \[\] atau maksimal 1 paragraf lanjutan/);
  assert.match(storyPrompt, /jangan membuat daftar\/bullet/i);
  assert.doesNotMatch(storyPrompt, /Setiap slide WAJIB berisi body \+ 3 bullet fakta berbeda/);

  const defaultPrompt = sourceUrlFinalizer.finalizerPrompt({
    generated: { ...generated, slides: generated.slides.map((slide, index) => ({ ...slide, section: ['PEMBUKA','FAKTA UTAMA','KONTEKS','KESIMPULAN'][index] })) },
    sources, facts, format: 'Fakta singkat', topic: 'Topik Uji', errors: [], contentLayout: 'default'
  });
  assert.match(defaultPrompt, /bullet fakta berbeda/);
});


test('custom layout Generate dari Teks hanya memanggil model satu kali', async () => {
  let calls = 0;
  const source = 'Kegagalan dapat mengambil hasil yang diharapkan, tetapi masih ada ruang untuk bertindak. Perhatian dapat diarahkan pada hal yang masih bisa dilakukan setelah hasil mengecewakan. Membedakan yang sudah terjadi dari tindakan berikutnya membantu menyusun arah.';
  const payload = {
    topic: 'Ruang Bertindak Setelah Kegagalan',
    caption: 'Kegagalan dapat mengambil hasil yang diharapkan, tetapi masih ada ruang untuk bertindak setelahnya. Perhatian dapat diarahkan pada hal yang masih bisa dilakukan tanpa menyangkal hasil yang sudah terjadi.',
    hashtags: ['#Kegagalan', '#Tindakan', '#Pilihan'],
    slides: [
      { section: 'PEMBUKA CERITA', title: 'Hasil Gagal Bukan Akhir Semua Pilihan', body: '', points: [] },
      { section: 'SITUASI', title: 'Hasil Tidak Sesuai Harapan', body: 'Kegagalan dapat mengambil hasil yang diharapkan, tetapi masih ada ruang untuk bertindak.', points: [] },
      { section: 'PERKEMBANGAN', title: 'Perhatian Kembali pada Tindakan', body: 'Perhatian dapat diarahkan pada hal yang masih bisa dilakukan setelah hasil mengecewakan.', points: [] },
      { section: 'PENYELESAIAN', title: 'Arah Masih Dapat Disusun', body: 'Membedakan yang sudah terjadi dari tindakan berikutnya membantu menyusun arah.', points: [] }
    ]
  };
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return { choices: [{ message: { content: JSON.stringify(payload) } }] };
        }
      }
    }
  };
  const result = await textInputComposer.compose({ text: source, client, contentLayout: 'story' });
  assert.equal(calls, 1);
  assert.equal(result.contentLayout, 'story');
  assert.equal(result.slides.length, 4);
});


test('Berita memberi margin kanan cukup besar untuk kalimat fakta panjang', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    require('./src/services/slideSpacingPatch').install();
    const images = require('./src/services/images');
    const slide = {
      section: 'FAKTA UTAMA',
      title: 'Kerangka Baru Melaporkan Misalignment Model',
      body: 'OpenAI memperkenalkan kerangka baru untuk melacak, menyelidiki, dan mengungkap kasus misalignment, sekaligus merilis enam laporan perilaku model.',
      points: [
        'Enam kasus mencakup perilaku yang muncul selama pelatihan maupun evaluasi model internal.',
        'OpenAI menegaskan laporan awal ini bukan ukuran seberapa sering misalignment terjadi secara keseluruhan.'
      ]
    };
    const layout = images.buildStructuredLayout(slide, 1, 4, 'Fakta singkat', { textInputOnly: true, layoutStyle: 'news' });
    process.stdout.write(images.renderLayout(layout, 2, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' }));
  `;
  const svg = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.match(svg, /data-layout="news"/);
  assert.match(svg, /width="920"/);
  const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1]);
  assert.ok(lines.some(line => line.includes('misalignment')));
  assert.ok(lines.every(line => line.length < 85));
});


test('Berita memecah fakta panjang menjadi baris pendek agar tidak keluar kartu', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    require('./src/services/slideSpacingPatch').install();
    const images = require('./src/services/images');
    const slide = {
      section: 'FAKTA UTAMA',
      title: 'Kerangka Baru untuk Melaporkan Misalignment Model',
      body: 'OpenAI memperkenalkan kerangka untuk melacak, menyelidiki, dan mengungkap kasus misalignment, sekaligus merilis enam laporan perilaku model.',
      points: [
        'Enam kasus mencakup perilaku yang muncul selama pelatihan maupun evaluasi model internal.',
        'Laporan awal ini bukan ukuran seberapa sering misalignment terjadi secara keseluruhan.'
      ]
    };
    const layout = images.buildStructuredLayout(slide, 1, 4, 'Fakta singkat', { textInputOnly: true, layoutStyle: 'news' });
    process.stdout.write(images.renderLayout(layout, 2, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' }));
  `;
  const svg = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const fact1 = svg.split('FAKTA 1')[1].split('FAKTA 2')[0];
  const lines = [...fact1.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1].trim()).filter(Boolean);
  assert.ok(lines.length >= 3, `fakta panjang harus di-wrap minimal 3 baris, sekarang ${lines.length}`);
  assert.ok(lines.every(line => line.length <= 55), `baris fakta terlalu panjang: ${lines.join(' | ')}`);
});


test('Headline Berita slide 1 dan 4 dibungkus sebelum mencapai tepi kanan', () => {
  const { execFileSync } = require('node:child_process');
  const titles = [
    'OpenAI Ungkap Enam Kasus Perilaku AI yang Mengkhawatirkan',
    'OpenAI Akan Mempercepat Pelaporan Kasus Serupa'
  ];
  for (const [index, title] of titles.entries()) {
    const script = `
      require('./src/services/slideSpacingPatch').install();
      const images = require('./src/services/images');
      const slide = {
        section: ${JSON.stringify(index === 0 ? 'HEADLINE' : 'PERKEMBANGAN')},
        title: ${JSON.stringify(title)},
        body: ${JSON.stringify(index === 0 ? '' : 'Kerangka baru menetapkan proses investigasi dan jalur pengungkapan.')},
        points: []
      };
      const layout = images.buildStructuredLayout(slide, ${index === 0 ? 0 : 3}, 4, 'Fakta singkat', { textInputOnly: true, layoutStyle: 'news' });
      process.stdout.write(images.renderLayout(layout, ${index === 0 ? 1 : 4}, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' }));
    `;
    const svg = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    const titleArea = svg.split('stroke-width="7"/>')[1].split('<rect')[0];
    const lines = [...titleArea.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1].trim()).filter(Boolean);
    assert.ok(lines.length >= 2 && lines.length <= 4, `judul harus 2–4 baris, sekarang ${lines.length}: ${lines.join(' | ')}`);
    assert.ok(lines.every(line => line.length <= 27), `baris judul terlalu panjang: ${lines.join(' | ')}`);
  }
});


test('Tutorial dan Cerita memakai kartu lebar dan wrapping aman seperti Berita', () => {
  const { execFileSync } = require('node:child_process');
  const cases = [
    {
      style: 'tutorial',
      section: 'LANGKAH 2',
      title: 'Daftarkan Passkey di Perangkat',
      body: 'Lanjutkan konfigurasi passkey dan ikuti permintaan Android untuk memverifikasi identitas melalui penguncian layar perangkat.',
      points: [
        'Tekan Add passkey pada halaman konfigurasi passwordless authentication',
        'Konfirmasi menggunakan sidik jari, wajah, PIN, atau kunci layar'
      ]
    },
    {
      style: 'story',
      section: 'PERKEMBANGAN',
      title: 'Perhatian Kembali pada Hal yang Masih Bisa Dilakukan',
      body: 'Setelah hasil yang mengecewakan, perhatian dapat kembali diarahkan pada pilihan dan tindakan yang masih benar-benar tersedia.',
      points: [
        'Arah berikutnya disusun dari hal yang masih bisa dilakukan tanpa menyangkal hasil yang sudah terjadi.'
      ]
    }
  ];

  for (const item of cases) {
    const script = `
      require('./src/services/slideSpacingPatch').install();
      const images = require('./src/services/images');
      const slide = ${JSON.stringify(item)};
      const layout = images.buildStructuredLayout(slide, 2, 4, 'Fakta singkat', { textInputOnly: true, layoutStyle: ${JSON.stringify(item.style)} });
      process.stdout.write(images.renderLayout(layout, 3, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' }));
    `;
    const svg = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    assert.match(svg, /width="920"/);
    const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1].trim()).filter(Boolean);
    assert.ok(lines.every(line => line.length <= 58), `${item.style} masih punya baris terlalu panjang: ${lines.join(' | ')}`);
  }
});


test('Tutorial slide hasil membungkus title dan body dengan margin aman', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    require('./src/services/slideSpacingPatch').install();
    const images = require('./src/services/images');
    const slide = {
      section: 'HASIL / PENUTUP',
      title: 'Passkey Siap Digunakan untuk Login',
      body: 'Setelah pendaftaran berhasil, passkey dapat digunakan untuk masuk ke GitHub tanpa mengetik password dan menyelesaikan 2FA secara terpisah.',
      points: []
    };
    const layout = images.buildStructuredLayout(slide, 3, 4, 'Tutorial', { textInputOnly: true, layoutStyle: 'tutorial' });
    process.stdout.write(images.renderLayout(layout, 4, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' }));
  `;
  const svg = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.match(svg, /data-layout="tutorial"/);
  const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1].trim()).filter(Boolean);
  assert.ok(lines.every(line => line.length <= 42), `Tutorial result masih punya baris terlalu panjang: ${lines.join(' | ')}`);
});


test('Cerita slide penyelesaian menjaga title dan paragraf jauh dari batas kartu', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    require('./src/services/slideSpacingPatch').install();
    const images = require('./src/services/images');
    const slide = {
      section: 'PENYELESAIAN',
      title: 'Anthropic Membangun Laboratorium Biologi Fisik',
      body: 'Sehari kemudian, Reuters melaporkan Anthropic telah menyiapkan wet lab di San Francisco Bay Area untuk menghubungkan AI dengan eksperimen biologis.',
      points: []
    };
    const layout = images.buildStructuredLayout(slide, 3, 4, 'Cerita', { textInputOnly: true, layoutStyle: 'story' });
    process.stdout.write(images.renderLayout(layout, 4, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' }));
  `;
  const svg = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.match(svg, /data-layout="story"/);
  assert.match(svg, /width="920"/);
  const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(match => match[1].trim()).filter(Boolean);
  assert.ok(lines.every(line => line.length <= 42), `Cerita ending masih punya baris terlalu panjang: ${lines.join(' | ')}`);
});


test('kolom Text Content manual menjadi textarea compact dengan placeholder sederhana', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const backgroundState = fs.readFileSync(path.join(__dirname, '..', 'public', 'background-state.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'asset-compact.css'), 'utf8');
  assert.match(app, /ensureManualCarouselInput/);
  assert.match(app, /Tempel text content di sini/);
  assert.match(app, /document\.createElement\('textarea'\)/);
  assert.match(backgroundState, /placeholder="Tempel text content di sini"/);
  assert.doesNotMatch(backgroundState, /Tempel copy dengan bagian HOOK/);
  assert.doesNotMatch(backgroundState, /Label bagian hanya dipakai untuk penempatan/);
  assert.match(css, /#legacy-studio #manual-topic\{/);
  assert.match(css, /height:220px/);
  assert.match(css, /height:210px/);
});
