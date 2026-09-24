const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const sharp = require('sharp');

const images = require('../src/services/images');
const { resolveInsertBox, titleFitForInsert } = require('../src/services/insertedImagePatch');

// Geometry: title starts at SAFE_AREA.left (x=90); the red separator line runs
// from x=90 to x=1010 (WIDTH 1080 - right inset 70). The rendered title must end
// at or before the red line so it never crosses the divider or leaves the canvas.
const TITLE_X = 90;
const RED_LINE_END = 1010;

// measureTextWidth (in images.js) under-estimates Arial advances, so we verify
// against the REAL rasterized glyph run: render each line with sharp, then scan
// for the right-most dark pixel column.
async function rightmostGlyphX(text, fontSize) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="200">`
    + `<rect width="3000" height="200" fill="#ffffff"/>`
    + `<text x="0" y="120" fill="#000000" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="900">`
    + `${String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
  let maxX = 0;
  for (let y = 0; y < info.height; y++) {
    const row = y * info.width;
    for (let x = info.width - 1; x > maxX; x--) {
      if (data[row + x] < 128) { maxX = x; break; }
    }
  }
  return maxX;
}

function extractTitle(svg) {
  const blocks = [...svg.matchAll(/<text x="(\d+)"[^>]*font-size="(\d+)"[^>]*font-weight="900"[^>]*>(.*?)<\/text>/gs)];
  for (const m of blocks) {
    const lines = [...m[3].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(t => t[1]);
    if (lines.length) return { x: Number(m[1]), fontSize: Number(m[2]), lines };
  }
  return null;
}

const titleCases = [
  ['tutorial', 'Hubungkan Server ke GitLab Menggunakan SSH Tanpa Password Berulang'],
  ['story', 'Kalau hasilnya gagal, apa yang sebenarnya masih kita punya?'],
  ['news', 'Belum Ada Kabar Terverifikasi tentang Kapal Virgo']
];

test('non-default Slide 1 title uses full width and fits above the fixed Default image', () => {
  for (const [layout, title] of titleCases) {
    const fit = titleFitForInsert(images, { contentLayout: layout, slides: [{ title }] });
    assert.ok(fit, `${layout} title should fit`);
    assert.ok(fit.lines.length <= 3, `${layout} title wrapped into ${fit.lines.length} lines`);
    assert.ok(fit.height <= 174, `${layout} title height ${fit.height} exceeds image-safe area`);

    const box = resolveInsertBox(images, { contentLayout: layout, slides: [{ title }] });
    assert.deepEqual(box, { left: 54, top: 900, width: 972, height: 966 });
  }
});

test('runtime renderer keeps Default untouched while non-default titles are widened and constrained', () => {
  const script = [
    "require('./src/services/slideSpacingPatch').install();",
    "const images = require('./src/services/images');",
    "const slide = {",
    "  section: 'HEADLINE',",
    "  title: 'Belum Ada Kabar Terverifikasi tentang Kapal Virgo',",
    "  body: 'Isi singkat untuk memeriksa komposisi.',",
    "  points: ['Fakta pertama yang relevan']",
    "};",
    "for (const style of ['default', 'tutorial', 'story', 'news']) {",
    "  const layout = images.buildStructuredLayout(slide, 0, 4, 'Fakta singkat', {",
    "    textInputOnly: true,",
    "    layoutStyle: style",
    "  });",
    "  process.stdout.write('STYLE:' + style + '\\n');",
    "  process.stdout.write(images.renderLayout(layout, 1, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' }));",
    "  process.stdout.write('\\nEND\\n');",
    "}"
  ].join('\n');
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  const defaultSvg = output.split('STYLE:default\n')[1].split('\nEND')[0];
  assert.doesNotMatch(defaultSvg, /data-layout="tutorial"|data-layout="story"|data-layout="news"/);

  for (const style of ['tutorial', 'story', 'news']) {
    const svg = output.split(`STYLE:${style}\n`)[1].split('\nEND')[0];
    assert.match(svg, new RegExp(`data-layout="${style}"`));
    assert.match(svg, /width="920"/);
    // Title is the bold 900 text block; body/point tspans use lower weights.
    const titleBlocks = [...svg.matchAll(/font-weight="900"[^>]*>(.*?)<\/text>/gs)];
    assert.ok(titleBlocks.length >= 1, `${style} has no title block`);
    const titleLines = titleBlocks
      .flatMap(match => [...match[1].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)])
      .map(match => match[1].trim())
      .filter(Boolean);
    assert.ok(titleLines.length >= 1 && titleLines.length <= 3, `${style} title rendered in ${titleLines.length} lines`);
  }
});

test('non-default titles render inside the red separator line (real pixel width)', async () => {
  const script = [
    "require('./src/services/slideSpacingPatch').install();",
    "const images = require('./src/services/images');",
    "const titles = {",
    "  tutorial: 'Cara Memverifikasi Sumber Berita Sebelum Membagikannya',",
    "  story: 'Perjalanan Panjang Seorang Relawan Kemanusiaan Sejati',",
    "  news: 'Perlu Konfirmasi Lembaga Resmi tentang Anak Krakatau'",
    "};",
    "for (const style of ['tutorial', 'story', 'news']) {",
    "  const slide = { section: 'HEADLINE', title: titles[style], body: 'Isi ringkas komposisi.', points: ['Fakta pertama', 'Fakta kedua'] };",
    "  const layout = images.buildStructuredLayout(slide, 2, 4, 'Fakta singkat', { textInputOnly: true, layoutStyle: style });",
    "  process.stdout.write('STYLE:' + style + '\\n');",
    "  process.stdout.write(images.renderLayout(layout, 3, 4, { enabled: false }, { color: '#f5efe4', textColor: '#000000' }));",
    "  process.stdout.write('\\nEND\\n');",
    "}"
  ].join('\n');
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });

  for (const style of ['tutorial', 'story', 'news']) {
    const svg = output.split(`STYLE:${style}\n`)[1].split('\nEND')[0];
    const title = extractTitle(svg);
    assert.ok(title, `${style} has a rendered title`);
    assert.equal(title.x, TITLE_X, `${style} title starts at the left safe margin`);
    assert.ok(title.lines.length >= 1 && title.lines.length <= 3, `${style} title is ${title.lines.length} lines (must be 1-3)`);

    let widest = 0;
    for (const line of title.lines) {
      const px = await rightmostGlyphX(line, title.fontSize);
      if (px > widest) widest = px;
    }
    const rightEdge = title.x + widest;
    assert.ok(
      rightEdge <= RED_LINE_END,
      `${style} title right edge ${rightEdge}px crosses the red line at ${RED_LINE_END}px`
    );
  }
});
