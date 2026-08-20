const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseStructuredText,
  logicalLines,
  generateHashtags
} = require('../src/services/textInputVerbatimPatch');
const {
  formatCarouselPaste
} = require('../public/text-input-paste-normalizer');

const ANTHROPIC_SAMPLE = `SLIDE 1 - HOOK
Anthropic Resmi Tanam Watermark Tak Kasatmata di Teks Buatan Claude
SLIDE 2 - FAKTA UTAMA
Kepatuhan Regulasi EU AI Act dan Sistem Penanda Baru
Anthropic mulai menyematkan penanda digital yang dapat dibaca mesin pada konten buatan Claude guna memenuhi standar transparansi Pasal 50(2) regulasi EU AI Act.
• Berlaku otomatis pada model Claude yang meluncur mulai 2 Agustus 2026, sementara integrasi pada model sebelumnya masih berjalan bertahap. • Diterapkan di level model secara global, mencakup web Claude, Claude Code, hingga Claude Platform API. • Output berkas gambar seperti format PNG, JPG, dan SVG dilengkapi metadata asal-usul terenkripsi dengan standar C2PA.
SLIDE 3 - DETAIL
Mekanisme Jejak Digital dan Batasan Pembacaan Detektor
Sinyal penanda ditenun langsung ke dalam susunan teks tanpa mengubah kualitas, makna, maupun keterbacaan respons yang dihasilkan.
• Watermark tetap melekat saat teks disalin-tempel dan dapat bertahan meski melalui proses penyuntingan ringan. • Adanya watermark menandakan teks pernah diproses oleh Claude, bukan bukti mutlak bahwa Claude adalah penulis awal ide tersebut. • Konten manusia yang sekadar diringkas, diterjemahkan, atau diperiksa tata bahasanya oleh Claude akan tetap membawa jejak penanda ini.
SLIDE 4 - PENUTUP
Standar Baru Transparansi Ekosistem Kecerdasan Buatan
Langkah Anthropic ini memperkuat akuntabilitas distribusi konten di ruang digital, sekaligus memberi kepastian teknis bagi pengembang yang mengintegrasikan model AI ke dalam produk mereka.
CAPTION
Anthropic resmi menerapkan sistem penandaan digital berupa watermark tak kasatmata pada teks buatan Claude untuk memenuhi kepatuhan transparansi EU AI Act. Penanda ini disematkan langsung di level model sehingga tetap melekat saat teks disalin tanpa mengubah kualitas maupun gaya bahasa.
TAGAR
#Anthropic #ClaudeAI #WatermarkAI #EUAIAct #GenerativeAI`;

test('parses structured carousel even when blank separator lines disappear', () => {
  const parsed = parseStructuredText(ANTHROPIC_SAMPLE);

  assert.equal(parsed.slides[0].title, 'Anthropic Resmi Tanam Watermark Tak Kasatmata di Teks Buatan Claude');
  assert.equal(parsed.slides[1].title, 'Kepatuhan Regulasi EU AI Act dan Sistem Penanda Baru');
  assert.match(parsed.slides[1].body, /^Anthropic mulai menyematkan penanda digital/);
  assert.equal(parsed.slides[1].points.length, 3);
  assert.equal(parsed.slides[2].points.length, 3);
  assert.equal(parsed.slides[3].title, 'Standar Baru Transparansi Ekosistem Kecerdasan Buatan');
  assert.match(parsed.caption, /^Anthropic resmi menerapkan sistem penandaan digital/);
  assert.deepEqual(parsed.hashtags, ['#Anthropic', '#ClaudeAI', '#WatermarkAI', '#EUAIAct', '#GenerativeAI']);
});

test('splits several bullet items that arrive on one physical clipboard line', () => {
  const lines = logicalLines('• Satu fakta. • Fakta kedua. • Fakta ketiga.');
  assert.deepEqual(lines, ['• Satu fakta.', '• Fakta kedua.', '• Fakta ketiga.']);
});

test('keeps fixed carousel shape when a section has title plus bullets but no body paragraph', () => {
  const parsed = parseStructuredText(`SLIDE 1 - HOOK
Hook baru
SLIDE 2 - FAKTA UTAMA
Judul fakta
• Isi pertama
• Isi kedua
• Isi ketiga
SLIDE 3 - DETAIL
Judul detail
• Detail pertama
• Detail kedua
• Detail ketiga
SLIDE 4 - PENUTUP
Judul penutup
Isi penutup
CAPTION
Caption singkat`);

  assert.equal(parsed.slides[1].body, 'Isi pertama');
  assert.deepEqual(parsed.slides[1].points, ['Isi kedua', 'Isi ketiga']);
  assert.equal(parsed.slides[2].body, 'Detail pertama');
  assert.deepEqual(parsed.slides[2].points, ['Detail kedua', 'Detail ketiga']);
  assert.ok(parsed.hashtags.length > 0);
  assert.ok(parsed.hashtags.every(tag => tag.startsWith('#')));
});

test('paste formatter restores readable separators without changing wording', () => {
  const formatted = formatCarouselPaste(ANTHROPIC_SAMPLE);
  assert.match(formatted, /SLIDE 2 - FAKTA UTAMA\n\nKepatuhan Regulasi EU AI Act dan Sistem Penanda Baru\n\nAnthropic mulai menyematkan/);
  assert.match(formatted, /• Berlaku otomatis[^\n]+\n• Diterapkan di level model[^\n]+\n• Output berkas gambar/);
  assert.match(formatted, /CAPTION\n\nAnthropic resmi menerapkan/);
  assert.match(formatted, /TAGAR\n\n#Anthropic #ClaudeAI #WatermarkAI #EUAIAct #GenerativeAI$/);
});

test('generated hashtags use only words already present in the pasted content', () => {
  const slides = [
    { title: 'Claude Watermark', body: '', points: [] },
    { title: 'Anthropic Claude', body: 'Transparansi AI', points: [] }
  ];
  const tags = generateHashtags(slides, 'Claude dan Anthropic');
  assert.ok(tags.includes('#Claude'));
  assert.ok(tags.includes('#Anthropic'));
});
