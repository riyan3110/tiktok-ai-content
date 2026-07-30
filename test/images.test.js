const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../src/config');
const images = require('../src/services/images');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const request = require('supertest');

const content = { hook: 'Hook', body: '1. Langkah', topic: 'Topik', cta: 'Coba' };

test('slide dirender sebagai JPEG RGB/sRGB 1080 x 1920 dengan ekstensi jpg', async (t) => {
  const id = `test-${process.pid}-${Date.now()}`;
  const files = await images.createSlides(id, content);
  t.after(async () => Promise.all(files.map((file) => fs.rm(path.join(config.root, 'public', file), { force: true }))));

  assert.equal(files.length, 3);
  assert.ok(files.every((file) => file.endsWith('.jpg')));
  for (const file of files) {
    const metadata = await sharp(path.join(config.root, 'public', file)).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1920);
    assert.equal(metadata.space, 'srgb');
    assert.equal(metadata.channels, 3);
    assert.equal(metadata.hasAlpha, false);
  }
  await images.validateSlides(files);

  const db = createDatabase(':memory:');
  const app = createApp({ db });
  await request(app).get(files[0]).expect(200).expect('Content-Type', /^image\/jpeg/);
  db.close();
});

test('validasi menolak PNG lama dengan pesan bahasa Indonesia', async () => {
  await assert.rejects(images.validateSlides(['/generated/slide-lama.png']), /bukan file JPG yang valid/);
});

test('watermark teks dirender ke area atas JPG final tanpa logo slide', async (t) => {
  const id = `watermark-${process.pid}-${Date.now()}`;
  const enabled = await images.createSlides(`${id}-on`, { ...content, watermark: { enabled: true, position: 'top-left', intensity: 'medium' } });
  const disabled = await images.createSlides(`${id}-off`, { ...content, watermark: { enabled: false } });
  t.after(async () => Promise.all([...enabled, ...disabled].map((file) => fs.rm(path.join(config.root, 'public', file), { force: true }))));

  const enabledRegion = await sharp(path.join(config.root, 'public', enabled[0])).extract({ left: 70, top: 235, width: 230, height: 55 }).raw().toBuffer();
  const disabledRegion = await sharp(path.join(config.root, 'public', disabled[0])).extract({ left: 70, top: 235, width: 230, height: 55 }).raw().toBuffer();
  assert.notDeepEqual(enabledRegion, disabledRegion);
  const svg = images.renderLayout(images.buildSlideLayouts(content)[0], 1, 3, { enabled: true });
  assert.match(svg, /data-role="watermark"[^>]*x="80"[^>]*y="270"[^>]*font-size="28"[^>]*font-weight="600"[^>]*letter-spacing="1.5"[^>]*>AI ADS LAB<\/text>/);
  assert.doesNotMatch(svg, /<image|ai-ads-lab-logo\.png/);
});

test('watermark bukan isi dan tidak memengaruhi auto-fit atau validasi slide', () => {
  const plain = images.buildSlideLayouts(content);
  const branded = images.buildSlideLayouts({ ...content, watermark: { enabled: true, text: 'AI ADS LAB' } });
  assert.deepEqual(branded, plain);
  assert.equal(images.wordCount('Hook'), 1);
  assert.equal(images.validateVisualLayout(branded[0]), true);
});

test('watermark, label, nomor, dan isi memakai satu layout aman untuk preview dan JPG', () => {
  const layout = images.buildSlideLayouts(content)[0];
  const svg = images.renderLayout(layout, 1, 3, { enabled: true, position: 'top-center', intensity: 'high' });
  const watermarkY = Number(svg.match(/data-role="watermark"[^>]*y="(\d+)"/)?.[1]);
  const labelMatch = svg.match(/<text x="90" y="(\d+)"[^>]*font-size="34"/);
  const labelY = Number(labelMatch?.[1]);
  const numberY = Number(svg.match(/<text x="830" y="(\d+)"[^>]*font-size="28"/)?.[1]);
  assert.ok(watermarkY >= 260 && watermarkY <= 290);
  assert.ok(labelY >= 410 && labelY <= 440);
  assert.ok(labelY - watermarkY >= 100);
  assert.equal(numberY, labelY);
  assert.ok(images.contentY(layout.fit) >= 580);
  assert.match(svg, /data-role="watermark"[^>]*x="80"[^>]*fill-opacity="0\.4"/);
});

test('watermark nonaktif tidak dirender dan opsi posisi atau intensitas lama tidak mengubah layout tetap', () => {
  assert.equal(images.watermarkElement({ enabled: false }), '');
  const fixed = images.watermarkElement({ enabled: true, position: 'top-center', intensity: 'high' });
  assert.match(fixed, /x="80" y="270"[^>]*fill-opacity="0\.4"/);
  assert.doesNotMatch(fixed, /text-anchor="middle"/);
});

test('wrapping menggunakan lebar piksel dan mempertahankan teks pendek', () => {
  assert.deepEqual(images.wrapText('Teks pendek', 770, 46), ['Teks pendek']);
  assert.ok(images.measureTextWidth('MMMM', 46) > images.measureTextWidth('iiii', 46));
  assert.ok(images.wrapText('Strategi konten sedang yang perlu dibungkus dengan rapi', 360, 46).length > 1);
});

test('validasi tinggi teks memakai batas piksel dan toleransi delapan piksel', () => {
  assert.equal(images.isTextHeightValid(594, 1000), true);
  assert.equal(images.isTextHeightValid(1000, 1000), true);
  assert.equal(images.isTextHeightValid(1006, 1000, 8), true);
  assert.equal(images.isTextHeightValid(1009, 1000, 8), false);
});

test('metrik layout selalu memakai canvas asli, bukan ukuran preview browser', () => {
  const fit = { height: 594, fontSize: 46, lineHeight: 1.3 };
  const nativeMetrics = images.layoutHeightMetrics(fit, 2);
  // A CSS preview may be 270x480, but it reuses this native layout result.
  const previewMetrics = images.layoutHeightMetrics(fit, 2);
  assert.deepEqual(previewMetrics, nativeMetrics);
  assert.deepEqual(nativeMetrics, {
    slideIndex: 2,
    textHeight: 594,
    availableHeight: 1000,
    contentTop: 580,
    bottomSafeArea: 340,
    fontSize: 46,
    lineHeight: 1.3,
    isOverflowing: false
  });
  assert.equal(images.WIDTH, 1080);
  assert.equal(images.HEIGHT, 1920);
});

test('overflow sembilan piksel menghasilkan pesan gagal yang akurat', () => {
  const overflowing = { type: 'hook', title: 'HOOK', fit: { kind: 'long', height: 1009, fontSize: 38, lineHeight: 1.3, lines: ['Teks'] } };
  const valid = { type: 'cta', title: 'CTA', fit: { kind: 'long', height: 1000, fontSize: 38, lineHeight: 1.3, lines: ['Teks'] } };
  assert.throws(
    () => images.validateCarouselLayouts([valid, overflowing, valid]),
    /Slide 2 tidak muat: tinggi teks 1009 px, area tersedia 1000 px\./
  );
});

test('teks terstruktur yang sudah muat tidak diringkas ulang', () => {
  const slides = [
    { section: 'PEMBUKA', title: 'Mulai Fokus', body: 'fokus fokus membantu ritme kerja tetap stabil.', points: [] },
    { section: 'ISI', title: 'Jaga Ritme', body: 'Kerjakan satu tugas penting sebelum berpindah.', points: [] },
    { section: 'CTA', title: 'Coba Hari Ini', body: '', points: [] }
  ];
  const fitted = images.fitStructuredSlides(slides, 'Tips cepat');
  assert.equal(fitted[0].body, slides[0].body);
  assert.equal(fitted.length, slides.length);
});

test('judul sedang auto-fit maksimal tiga baris di dalam safe area', () => {
  const fit = images.autoFitText(
    'Cara membuat iklan TikTok yang menarik perhatian audiens dalam beberapa detik',
    { maxWidth: 770, maxHeight: 520, maxLines: 3, startSize: 72, minSize: 52, lineHeight: 1.15 }
  );
  assert.ok(fit);
  assert.ok(fit.fontSize >= 52 && fit.fontSize <= 72);
  assert.ok(fit.lines.length <= 3);
  assert.ok(fit.lines.every((line) => images.measureTextWidth(line, fit.fontSize, true) <= 770));
});

test('teks tutorial sangat panjang dibagi agar setiap slide maksimal tujuh baris', () => {
  const steps = Array.from({ length: 12 }, (_, index) => `${index + 1}. Lakukan langkah penting nomor ${index + 1} secara konsisten untuk memperoleh hasil terbaik`).join('\n');
  const layouts = images.buildSlideLayouts({
    hook: Array(30).fill('Judul sangat panjang').join(' '),
    body: steps,
    topic: 'Strategi pemasaran digital untuk usaha kecil',
    cta: Array(40).fill('Simpan dan praktikkan panduan ini').join(' ')
  });
  const stepSlides = layouts.filter(({ type }) => type === 'steps');
  const ctaSlides = layouts.filter(({ type }) => type === 'cta');
  assert.equal(layouts.filter(({ type }) => type === 'hook').length, 1);
  assert.ok(stepSlides.length >= 3);
  assert.ok(stepSlides.every(({ fit }) => fit.steps.length <= 5 && fit.fontSize >= 38 && fit.lineCount <= 7));
  assert.equal(ctaSlides.length, 1);
  assert.ok(layouts.length >= 5);
  assert.ok(ctaSlides.every(({ fit }) => fit.lines.length <= 7 && fit.height <= 850));
});

test('format fakta singkat membuat satu fakta utama per slide isi', () => {
  const layouts = images.buildSlideLayouts({
    hook: 'Tiga fakta menarik',
    body: '- Fakta pertama\n- Fakta kedua\n- Fakta ketiga',
    topic: 'Fakta alam',
    cta: 'Simpan',
    contentFormat: 'Fakta singkat'
  });
  const facts = layouts.filter(({ type }) => type === 'steps');
  assert.equal(layouts.length, 4);
  assert.equal(facts.length, 2);
  assert.deepEqual(facts.map(({ title }) => title), ['PENJELASAN UTAMA', 'FAKTA PENDUKUNG']);
  assert.equal(layouts.at(-1).title, 'KESIMPULAN');
});

test('tutorial empat langkah menghasilkan urutan 1,2,3,4 dalam dua slide isi', () => {
  const layouts = images.buildSlideLayouts({
    hook: 'Buat gambar AI lebih menarik',
    body: '1. Tentukan ide utama yang ingin ditampilkan\n2. Tulis prompt dengan detail visual utama\n3. Buat beberapa variasi gambar\n4. Pilih dan simpan hasil terbaik',
    topic: 'Gambar AI menarik', cta: 'Follow untuk tips AI lainnya!',
    contentCategory: 'Tutorial AI', contentFormat: 'Tutorial langkah'
  });
  assert.equal(layouts.length, 4);
  assert.deepEqual(layouts.filter(({ type }) => type === 'steps').flatMap(({ fit }) => fit.steps.map((step) => Number(step.match(/^\d+/)[0]))), [1, 2, 3, 4]);
  assert.ok(layouts.filter(({ type }) => type === 'steps').every(({ fit }) => fit.steps.length === 2));
  assert.equal(layouts.at(-1).title, 'HASIL / TIPS / CTA');
});

test('tutorial tujuh langkah tetap padat, aman, dan nomor berurutan', () => {
  const body = Array.from({ length: 7 }, (_, index) => `${index + 1}. Lakukan tindakan praktis ke-${index + 1} lalu periksa hasilnya`).join('\n');
  const layouts = images.buildSlideLayouts({
    hook: 'Selesaikan edit produk lebih cepat', body, topic: 'Foto produk siap unggah',
    focus: { hasil: 'Foto produk rapi dan siap dipublikasikan', solusi: 'Periksa tepi objek sebelum mengunduh hasil akhir' },
    cta: 'Simpan tutorial ini', contentCategory: 'Tutorial AI', contentFormat: 'Tutorial langkah'
  });
  assert.ok(layouts.length >= 4);
  const main = layouts.filter(({ type }) => type !== 'hook');
  assert.ok(main.every(({ fit }) => images.wordCount(fit.steps?.join(' ') || fit.lines.join(' ')) >= 15));
  const numbering = layouts.filter(({ type }) => type === 'steps').flatMap(({ fit }) => fit.steps.filter((step) => /^\d+/.test(step)).map((step) => Number(step.match(/^\d+/)[0])));
  assert.deepEqual(numbering, [1, 2, 3, 4, 5, 6, 7]);
});

test('footer kecil dihapus dari semua slide', () => {
  assert.equal(images.resolveFooter({ contentCategory: 'Tips bisnis' }), '');
  assert.doesNotMatch(images.renderLayout(images.buildSlideLayouts(content)[0], 1, 3), /Simpan tips ini|Geser untuk lanjut/);
});

test('safe area TikTok membatasi header, ikon kanan, dan caption bawah', () => {
  assert.deepEqual(images.SAFE_AREA, { left: 90, right: 250, top: 340, bottom: 340 });
  const layout = images.buildSlideLayouts(content)[0];
  assert.equal(images.validateVisualLayout(layout), true);
  assert.match(images.renderLayout(layout, 1, 3), /y="425"/);
  assert.ok(layout.fit.lines.every((line) => images.measureTextWidth(line, layout.fit.fontSize, true) <= 740));
});

test('teks pendek memakai 58–68 px, maksimal empat baris, dan turun ke tengah atas', () => {
  const fit = images.adaptiveTextFit('Tiga langkah praktis untuk hasil rapi');
  assert.equal(fit.kind, 'short');
  assert.ok(fit.fontSize >= 58 && fit.fontSize <= 68);
  assert.ok(fit.lines.length <= 4);
  assert.ok(images.contentY(fit) >= 720 && images.contentY(fit) <= 900);
});

test('teks sedang memakai 46–56 px dan maksimal enam baris', () => {
  const fit = images.adaptiveTextFit(Array(15).fill('strategi').join(' '));
  assert.equal(fit.kind, 'medium');
  assert.ok(fit.fontSize >= 46 && fit.fontSize <= 56);
  assert.ok(fit.lines.length <= 6);
});

test('teks panjang memakai 38–46 px, line-height adaptif, dan maksimal tujuh baris', () => {
  const fit = images.adaptiveTextFit(Array(25).fill('langkah').join(' '));
  assert.equal(fit.kind, 'long');
  assert.ok(fit.fontSize >= 38 && fit.fontSize <= 46);
  assert.ok(fit.lineHeight >= 1.25 && fit.lineHeight <= 1.35);
  assert.ok(fit.lines.length <= 7);
});

test('teks sangat panjang tidak dipaksakan ke satu slide', () => {
  assert.equal(images.adaptiveTextFit(Array(100).fill('penjelasan').join(' ')), null);
  const pages = images.paginateSteps([Array(100).fill('penjelasan').join(' ')]);
  assert.ok(pages.length > 1);
  assert.ok(pages.every(({ lineCount }) => lineCount <= 7));
});

test('slide menggabungkan maksimal dua poin pendek dan membatasi isi utama 40 kata', () => {
  const body = Array.from({ length: 8 }, (_, index) => `${index + 1}. Tips ${index + 1}`).join('\n');
  const layouts = images.buildSlideLayouts({ hook: 'Tips ringkas', body, topic: 'Tips', contentCategory: 'Tips bisnis', contentFormat: 'Tips cepat' });
  assert.equal(layouts.length, 6);
  const bodyLayouts = layouts.filter(({ type }) => type === 'steps');
  assert.ok(bodyLayouts.every(({ fit }) => fit.steps.length > 1));
  assert.ok(bodyLayouts.every(({ fit }) => images.wordCount(fit.steps.join(' ')) <= 40));
});

test('format masalah dan solusi menghasilkan tepat empat slide dengan urutan solusi', () => {
  const layouts = images.buildSlideLayouts({ contentCategory: 'Tips bisnis', contentFormat: 'Masalah dan solusi', hook: 'Stok Lama Mengunci Modal', body: 'MASALAH: Stok tidak terjual 30 hari\nPENYEBAB: Perputaran tidak dicatat\nSOLUSI 1: Hitung umur stok\nSOLUSI 2: Bundel stok lambat\nLANGKAH PERTAMA: Ekspor laporan stok\nHASIL YANG DIHARAPKAN: Modal kembali bertahap', cta: 'Simpan panduan ini' });
  assert.equal(layouts.length, 4);
  assert.deepEqual(layouts.map(({ title }) => title), ['HOOK', 'MASALAH & PENYEBAB', 'SOLUSI', 'LANGKAH & HASIL']);
  assert.match(layouts[2].fit.groups.flat().join(' '), /SOLUSI 1.*SOLUSI 2/);
});

test('nomor lompat dan ganda diperbaiki menjadi urutan global tanpa reset antar-slide', () => {
  const layouts = images.buildSlideLayouts({
    hook: 'Empat fakta penting', body: '1. Fakta pertama\n3. Fakta kedua\n3. Fakta ketiga\n8. Fakta keempat',
    topic: 'Ringkasan fakta', contentFormat: 'Fakta singkat'
  });
  const points = layouts.filter(({ type }) => type === 'steps').flatMap(({ fit }) => fit.steps);
  assert.deepEqual(points.map((point) => Number(point.match(/^\d+/)[0])), [1, 2, 3, 4]);
  assert.ok(layouts.filter(({ type }) => type === 'steps').every(({ fit }) => fit.steps.length <= 2));
});

test('label isi mengikuti peran penjelasan, fakta pendukung, dampak, dan kesimpulan', () => {
  const layouts = images.buildSlideLayouts({
    hook: 'Enam fakta', body: '1. Satu\n2. Dua\n3. Tiga\n4. Empat\n5. Lima\n6. Enam',
    topic: 'Kesimpulan fakta', contentFormat: 'Fakta singkat'
  });
  assert.deepEqual(layouts.map(({ title }) => title), ['HOOK', 'PENJELASAN UTAMA', 'FAKTA PENDUKUNG', 'DAMPAK', 'KESIMPULAN']);
});

test('isi pendek lebih ke tengah dan isi panjang tetap di safe area', () => {
  const short = images.adaptiveTextFit('Isi singkat yang mudah dipahami');
  const long = images.adaptiveTextFit(Array(25).fill('langkah').join(' '));
  assert.ok(images.contentY(short) >= 720);
  assert.ok(images.contentY(long) >= images.SAFE_AREA.top);
  assert.ok(images.contentY(long) + long.height <= images.HEIGHT - images.SAFE_AREA.bottom);
});

test('title, body, dan points memakai elemen serta hierarki visual terpisah', () => {
  const layouts = images.buildSlideLayouts({ contentFormat: 'Tips cepat', slides: [
    { section: 'PEMBUKA', title: 'Pagi Sibuk Bikin Hilang Fokus?', body: 'Rutinitas kacau memengaruhi fokus sepanjang hari.', points: ['Bangun terburu-buru', 'Langsung mengecek handphone', 'Mulai tanpa rencana'] },
    { section: 'TIPS', title: 'Mulai dengan Tenang', body: '', points: ['Siapkan agenda malam hari'] },
    { section: 'CTA', title: 'Coba Besok Pagi', body: '', points: [] }
  ] });
  const first = layouts[0];
  assert.equal(first.type, 'structured');
  assert.ok(first.fit.titleFit.lines.length <= 3);
  assert.equal(first.content.points.length, 3);
  const svg = images.renderLayout(first, 1, 3, { enabled: true });
  assert.match(svg, /font-size="7[0-6]"[^>]*font-weight="700"/);
  assert.match(svg, /font-size="4[0-2]"[^>]*font-weight="400"/);
  assert.match(svg, /• Bangun terburu-buru/);
  assert.equal((svg.match(/data-role="watermark"/g) || []).length, 1);
  assert.match(svg, /y="425"/);
  assert.ok(images.contentY(first.fit) >= 580);
});

test('preview SVG adalah sumber layout yang sama dengan JPG final', async (t) => {
  const contentWithSlides = { slides: [
    { section: 'PEMBUKA', title: 'Satu Judul Jelas', body: 'Satu penjelasan singkat.', points: ['Poin pertama'] },
    { section: 'ISI', title: 'Isi Utama', body: '', points: ['Poin kedua'] },
    { section: 'CTA', title: 'Simpan Sekarang', body: '', points: [] }
  ] };
  const id = `structured-${process.pid}-${Date.now()}`;
  const layouts = images.buildSlideLayouts(contentWithSlides);
  const preview = images.renderLayout(layouts[0], 1, layouts.length, contentWithSlides.watermark);
  assert.match(preview, /Satu Judul Jelas/);
  const files = await images.createSlides(id, contentWithSlides);
  t.after(async () => Promise.all(files.map(file => fs.rm(path.join(config.root, 'public', file), { force: true }))));
  assert.equal(files.length, layouts.length);
  assert.equal((await sharp(path.join(config.root, 'public', files[0])).metadata()).format, 'jpeg');
});

test('repair layout mengubah body delapan baris menjadi struktur adaptif', () => {
  const { repairStructuredSlides } = require('../src/services/images');
  const slides = repairStructuredSlides([{ section: 'ISI', title: 'Rutinitas kerja', body: Array.from({ length: 8 }, (_, i) => `Kalimat ${i + 1} yang singkat`).join('\n'), points: [] }]);
  assert.ok(slides.length >= 1);
  assert.ok(slides.every(slide => !slide.body.includes('\n')));
  assert.ok(slides.every(slide => slide.points.length <= 3 && slide.points.every(point => point.split(/\s+/).length <= 7)));
});

test('repair layout memindahkan bullet berlebih ke slide lanjutan tanpa mengubah urutan', () => {
  const { repairStructuredSlides } = require('../src/services/images');
  const points = ['poin satu', 'poin dua', 'poin tiga', 'poin empat', 'poin lima'];
  const slides = repairStructuredSlides([{ section: 'LANGKAH 1', title: 'Kerjakan secara urut', body: '', points }]);
  assert.equal(slides.length, 2);
  assert.deepEqual(slides.flatMap(slide => slide.points), points);
  assert.equal(slides[1].section, 'LANJUTAN');
});

test('structured auto-fit menjaga batas title, body, total visual, dan font minimum', () => {
  const { buildStructuredLayout, validateVisualLayout } = require('../src/services/images');
  const layout = buildStructuredLayout({ section: 'LANGKAH 1', title: 'Bangun pola kerja yang konsisten setiap hari', body: 'Tentukan waktu dan urutan kerja yang sama setiap hari agar mudah dilakukan.', points: ['Mulai dari jadwal kecil', 'Gunakan pengingat harian', 'Evaluasi setiap minggu'] }, 1, 3, 'Tutorial langkah');
  assert.ok(layout.fit.titleFit.lines.length <= 3);
  assert.ok(layout.fit.bodyFit.lines.length <= 4);
  assert.ok(layout.fit.lineCount <= 9);
  assert.ok(layout.fit.titleFit.fontSize >= 46);
  assert.ok(layout.fit.bodyFit.fontSize >= 34);
  assert.ok(layout.fit.pointSize >= 32);
  assert.equal(validateVisualLayout(layout), true);
});
