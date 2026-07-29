const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config');

const WIDTH = 1080;
const HEIGHT = 1920;
const JPEG_QUALITY = 90;
const SAFE_AREA = Object.freeze({ left: 90, right: 220, top: 180, bottom: 240 });
const SAFE_WIDTH = WIDTH - SAFE_AREA.left - SAFE_AREA.right;
const SAFE_HEIGHT = HEIGHT - SAFE_AREA.top - SAFE_AREA.bottom;

const escapeXml = (value) => String(value).replace(/[<>&'\"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

// Approximate Arial's glyph advances in em. Unlike a character limit, this makes
// narrow letters (i, l) consume less room than wide letters (M, W).
function measureTextWidth(text, fontSize, bold = false) {
  let em = 0;
  for (const character of String(text)) {
    if (/\s/.test(character)) em += 0.28;
    else if (/[ilI1.,'`:;!|]/.test(character)) em += 0.27;
    else if (/[MW@%&mw]/.test(character)) em += 0.88;
    else if (/[A-Z0-9]/.test(character)) em += 0.64;
    else em += 0.54;
  }
  return em * fontSize * (bold ? 1.04 : 1);
}

function wrapText(text, maxWidth, fontSize, bold = false) {
  const paragraphs = String(text || '').trim().split(/\n+/);
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (let word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureTextWidth(candidate, fontSize, bold) <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      while (measureTextWidth(word, fontSize, bold) > maxWidth) {
        let end = 1;
        while (end < word.length && measureTextWidth(word.slice(0, end + 1), fontSize, bold) <= maxWidth) end++;
        lines.push(word.slice(0, end));
        word = word.slice(end);
      }
      line = word;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function autoFitText(text, { maxWidth = SAFE_WIDTH, maxHeight, maxLines = Infinity, startSize, minSize, lineHeight }) {
  for (let fontSize = startSize; fontSize >= minSize; fontSize--) {
    const lines = wrapText(text, maxWidth, fontSize, true);
    const height = lines.length * fontSize * lineHeight;
    if (lines.length <= maxLines && height <= maxHeight) return { fontSize, lines, height, lineHeight };
  }
  return null;
}

function parseSteps(body) {
  const value = String(body || '').trim();
  const matches = [...value.matchAll(/(?:^|\n|\s)(\d+[.)])\s*/g)];
  if (!matches.length) {
    const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    return lines.length > 1 ? lines.map((line) => line.replace(/^[-•*]\s*/, '')) : value ? [value] : [];
  }
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : value.length;
    return `${match[1]} ${value.slice(start, end).trim()}`;
  });
}

function fitStepPage(steps) {
  const availableHeight = 1090;
  for (let fontSize = 46; fontSize >= 34; fontSize--) {
    const groups = steps.map((step) => wrapText(step, SAFE_WIDTH, fontSize, false));
    const height = groups.reduce((sum, lines) => sum + lines.length * fontSize * 1.3, 0) + Math.max(0, groups.length - 1) * 22;
    if (height <= availableHeight) return { fontSize, groups, height };
  }
  return null;
}

function paginateSteps(steps) {
  const pages = [];
  let remaining = [...steps];
  while (remaining.length) {
    let count = Math.min(5, remaining.length);
    while (count > 1 && !fitStepPage(remaining.slice(0, count))) count--;
    let page = remaining.splice(0, count);
    let fitted = fitStepPage(page);
    if (!fitted) {
      const lines = wrapText(page[0], SAFE_WIDTH, 34);
      const maxLines = Math.floor(1090 / (34 * 1.3));
      page = [lines.slice(0, maxLines).join(' ')];
      remaining.unshift(lines.slice(maxLines).join(' '));
      fitted = fitStepPage(page);
    }
    pages.push({ steps: page, ...fitted });
  }
  return pages;
}

function textElement(lines, { y, fontSize, lineHeight, weight = 700, fill = 'white' }) {
  return `<text x="${SAFE_AREA.left}" y="${y}" fill="${fill}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" text-anchor="start" filter="url(#shadow)">${lines.map((line, i) => `<tspan x="${SAFE_AREA.left}" dy="${i ? fontSize * lineHeight : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}

function frame(inner, number, total) {
  return `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#15122d"/><stop offset="1" stop-color="#5b21b6"/></linearGradient><filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#090617" flood-opacity=".7"/></filter></defs><rect width="1080" height="1920" fill="url(#g)"/><circle cx="940" cy="190" r="260" fill="#ec4899" opacity=".28"/><text x="${SAFE_AREA.left}" y="${SAFE_AREA.top + 30}" fill="#f9a8d4" font-family="Arial,sans-serif" font-size="30" font-weight="700">AI ADS LAB • ${number}/${total}</text>${inner}<text x="${SAFE_AREA.left}" y="${HEIGHT - SAFE_AREA.bottom - 40}" fill="#ddd6fe" font-family="Arial,sans-serif" font-size="30">Simpan untuk dipraktikkan nanti ✦</text></svg>`;
}

function buildSlideLayouts(content) {
  const hook = autoFitText(content.hook, { maxHeight: 520, maxLines: 3, startSize: 72, minSize: 52, lineHeight: 1.15 });
  const hookLayouts = hook ? [hook] : paginatePlainText(content.hook, 3, 72, 52, 520, 1.15);
  const format = content.contentFormat || 'Tutorial langkah';
  const formatTitles = {
    'Tutorial langkah': 'LANGKAH PRAKTIS', Listicle: 'DAFTAR PILIHAN',
    'Fakta singkat': 'FAKTA UTAMA', 'Masalah dan solusi': 'MASALAH → SOLUSI',
    'Before-after': 'BEFORE → AFTER', 'Tips cepat': 'TIPS CEPAT'
  };
  const points = parseSteps(content.body);
  const stepLayouts = format === 'Fakta singkat'
    ? points.flatMap((point) => paginateSteps([point]))
    : paginateSteps(points);
  const ctaText = `${content.topic}\n${content.cta}`;
  const ctaLayouts = paginatePlainText(ctaText, 4, 72, 34, SAFE_HEIGHT * 0.6, 1.15);
  return [
    ...hookLayouts.map((fit) => ({ type: 'hook', title: 'HOOK', fit })),
    ...stepLayouts.map((fit) => ({ type: 'steps', title: formatTitles[format] || 'ISI KONTEN', fit })),
    ...ctaLayouts.map((fit) => ({ type: 'cta', title: 'SIAP COBA?', fit }))
  ];
}

function paginatePlainText(text, maxLines, startSize, minSize, maxHeight, lineHeight) {
  const allLines = wrapText(text, SAFE_WIDTH, minSize, true);
  const pages = [];
  for (let index = 0; index < allLines.length; index += maxLines) {
    const chunk = allLines.slice(index, index + maxLines).join(' ');
    pages.push(autoFitText(chunk, { maxHeight, maxLines, startSize, minSize, lineHeight }));
  }
  return pages.length ? pages : [{ fontSize: startSize, lines: [], height: 0, lineHeight }];
}

function renderLayout(layout, number, total) {
  const heading = textElement([layout.title], { y: 310, fontSize: 38, lineHeight: 1.15, fill: '#f9a8d4' });
  if (layout.type === 'steps') {
    let y = 430;
    const elements = layout.fit.groups.map((lines) => {
      const element = textElement(lines, { y, fontSize: layout.fit.fontSize, lineHeight: 1.3, weight: 600 });
      y += lines.length * layout.fit.fontSize * 1.3 + 22;
      return element;
    }).join('');
    return frame(heading + elements, number, total);
  }
  return frame(heading + textElement(layout.fit.lines, { y: 430, fontSize: layout.fit.fontSize, lineHeight: layout.fit.lineHeight }), number, total);
}

async function createSlides(id, content) {
  const dir = path.join(config.root, 'public/generated');
  await fs.mkdir(dir, { recursive: true });
  const layouts = buildSlideLayouts(content);
  const files = [];
  for (let i = 0; i < layouts.length; i++) {
    const name = `${id}-${i + 1}.jpg`;
    await sharp(Buffer.from(renderLayout(layouts[i], i + 1, layouts.length))).resize(WIDTH, HEIGHT).flatten({ background: '#ffffff' }).toColourspace('srgb').removeAlpha().jpeg({ quality: JPEG_QUALITY }).toFile(path.join(dir, name));
    files.push(`/generated/${name}`);
  }
  return files;
}

async function validateSlides(files) {
  if (!Array.isArray(files) || !files.length) throw invalidImage('Daftar file slide kosong. Buat ulang konten sebelum mengunggah.');
  for (const file of files) {
    if (typeof file !== 'string' || !file.startsWith('/generated/') || !file.toLowerCase().endsWith('.jpg')) throw invalidImage(`Slide "${file}" bukan file JPG yang valid. Buat ulang konten sebelum mengunggah.`);
    const diskPath = path.join(config.root, 'public', file);
    let metadata;
    try { metadata = await sharp(diskPath).metadata(); } catch { throw invalidImage(`File slide "${file}" tidak dapat dibaca. Buat ulang konten sebelum mengunggah.`); }
    if (metadata.format !== 'jpeg') throw invalidImage(`File slide "${file}" bukan JPEG asli. Buat ulang konten sebelum mengunggah.`);
    if (metadata.width !== WIDTH || metadata.height !== HEIGHT) throw invalidImage(`Ukuran slide "${file}" harus ${WIDTH} x ${HEIGHT} piksel.`);
    if (metadata.channels !== 3 || metadata.hasAlpha || metadata.space !== 'srgb') throw invalidImage(`Mode warna slide "${file}" harus RGB/sRGB tanpa transparansi.`);
  }
}

function invalidImage(message) { return Object.assign(new Error(message), { status: 400 }); }

module.exports = { createSlides, validateSlides, measureTextWidth, wrapText, autoFitText, parseSteps, paginateSteps, buildSlideLayouts, SAFE_AREA, WIDTH, HEIGHT, JPEG_QUALITY };
