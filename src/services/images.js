const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config');

const WIDTH = 1080;
const HEIGHT = 1920;
const JPEG_QUALITY = 90;
// TikTok overlays occupy the search/header region, the action rail at the
// right, and the caption/navigation region at the bottom. Keep all meaningful
// copy inside this deliberately asymmetric canvas.
const SAFE_AREA = Object.freeze({ left: 90, right: 260, top: 280, bottom: 350 });
const SAFE_WIDTH = WIDTH - SAFE_AREA.left - SAFE_AREA.right;
const SAFE_HEIGHT = HEIGHT - SAFE_AREA.top - SAFE_AREA.bottom;
const LABEL_Y = 310;
const CONTENT_TOP = 390;
const CONTENT_BOTTOM = HEIGHT - SAFE_AREA.bottom;

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

function adaptiveTextFit(text, maxWidth = SAFE_WIDTH) {
  const value = String(text || '').trim();
  const bands = [
    { kind: 'short', startSize: 68, minSize: 58, maxLines: 4, lineHeight: 1.25 },
    { kind: 'medium', startSize: 56, minSize: 46, maxLines: 6, lineHeight: 1.28 },
    { kind: 'long', startSize: 46, minSize: 38, maxLines: 7, lineHeight: 1.3 }
  ];
  for (const band of bands) {
    const fit = autoFitText(value, { maxWidth, maxHeight: SAFE_HEIGHT - 110, ...band });
    if (fit) return { ...fit, kind: band.kind };
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
  const value = steps.join('\n');
  for (const band of [
    { kind: 'short', start: 68, min: 58, maxLines: 4, lineHeight: 1.25 },
    { kind: 'medium', start: 56, min: 46, maxLines: 6, lineHeight: 1.28 },
    { kind: 'long', start: 46, min: 38, maxLines: 7, lineHeight: 1.3 }
  ]) {
    for (let fontSize = band.start; fontSize >= band.min; fontSize--) {
      const groups = steps.map((step) => wrapText(step, SAFE_WIDTH, fontSize, false));
      const lineCount = groups.reduce((sum, lines) => sum + lines.length, 0);
      const height = groups.reduce((sum, lines) => sum + lines.length * fontSize * band.lineHeight, 0) + Math.max(0, groups.length - 1) * 24;
      if (lineCount <= band.maxLines && height <= SAFE_HEIGHT - 130) return { fontSize, groups, height, lineHeight: band.lineHeight, lineCount, kind: band.kind };
    }
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
      const words = page[0].split(/\s+/);
      let cut = words.length - 1;
      while (cut > 1 && !fitStepPage([words.slice(0, cut).join(' ')])) cut--;
      page = [words.slice(0, cut).join(' ')];
      const rest = words.slice(cut).join(' ');
      if (rest) remaining.unshift(rest);
      fitted = fitStepPage(page);
    }
    pages.push({ steps: page, ...fitted });
  }
  return pages;
}

function textElement(lines, { y, fontSize, lineHeight, weight = 700, fill = 'white' }) {
  return `<text x="${SAFE_AREA.left}" y="${y}" fill="${fill}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" text-anchor="start" filter="url(#shadow)">${lines.map((line, i) => `<tspan x="${SAFE_AREA.left}" dy="${i ? fontSize * lineHeight : 0}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}

function contentKind(category = '', format = '') {
  const value = `${category} ${format}`.toLocaleLowerCase('id-ID');
  if (value.includes('fakta')) return 'fact';
  if (value.includes('tutorial')) return 'tutorial';
  if (value.includes('masalah') && value.includes('solusi')) return 'solution';
  if (value.includes('tips')) return 'tips';
  if (value.includes('motivasi')) return 'motivation';
  if (value.includes('before-after')) return 'beforeAfter';
  if (value.includes('edukasi')) return 'education';
  if (value.includes('iklan') || value.includes('ugc')) return 'ugc';
  return 'custom';
}

function resolveFooter() { return ''; }

function frame(inner, number, total) {
  return `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#15122d"/><stop offset="1" stop-color="#5b21b6"/></linearGradient><filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#090617" flood-opacity=".7"/></filter></defs><rect width="1080" height="1920" fill="url(#g)"/><circle cx="940" cy="190" r="260" fill="#ec4899" opacity=".28"/>${inner}<text x="${WIDTH - SAFE_AREA.right}" y="${LABEL_Y}" fill="#f9a8d4" font-family="Arial,sans-serif" font-size="28" font-weight="700" text-anchor="end">${number}/${total}</text></svg>`;
}

function buildSlideLayouts(content) {
  const format = content.contentFormat || 'Tutorial langkah';
  const kind = contentKind(content.contentCategory, format);
  const hookText = limitWords(content.hook, 20);
  const hook = adaptiveTextFit(hookText);
  if (kind === 'solution') {
    const sections = String(content.body || '').split(/(?=^(?:MASALAH|PENYEBAB|SOLUSI [12]|LANGKAH PERTAMA|HASIL YANG DIHARAPKAN)\s*:)/gim).map((part) => part.trim()).filter(Boolean);
    if (sections.length >= 6) {
      const groups = [sections.slice(0, 2), sections.slice(2, 4), [...sections.slice(4, 6), `CTA: ${content.cta}`]];
      const titles = ['MASALAH & PENYEBAB', 'SOLUSI', 'LANGKAH & HASIL'];
      return [{ type: 'hook', title: 'HOOK', fit: hook }, ...groups.map((steps, index) => ({ type: 'steps', title: titles[index], fit: fitStepPage(steps) }))];
    }
  }
  const rawPoints = parseSteps(content.body).flatMap(splitAtWordLimit).filter(Boolean);
  if (kind === 'tutorial') return buildTutorialLayouts(content, hookText, rawPoints);
  const desiredBodySlides = kind === 'tutorial' ? 3 : 2;
  const longContent = rawPoints.reduce((sum, point) => sum + wordCount(point), 0) > 105;
  const bodySlideCount = Math.min(longContent ? 4 : desiredBodySlides, rawPoints.length);
  const groups = groupPoints(rawPoints, bodySlideCount);
  const formatTitle = {
    tips: 'TIPS', motivation: 'PESAN', solution: 'MASALAH → SOLUSI',
    beforeAfter: 'BEFORE → AFTER', education: 'PENJELASAN', ugc: 'IDE KONTEN', custom: 'PENJELASAN'
  }[kind];
  const stepLayouts = groups.map((steps, index) => ({
    type: 'steps',
    title: kind === 'fact' ? (index === 0 ? 'PENJELASAN UTAMA' : 'FAKTA PENDUKUNG')
      : kind === 'tutorial' ? `LANGKAH ${index + 1}` : formatTitle,
    ...paginateSteps(steps)[0]
  })).map(({ type, title, ...fit }) => ({ type, title, fit }));
  const finalText = limitWords(content.topic || 'Sudah siap menerapkannya?', 35);
  const finalFit = adaptiveTextFit(finalText);
  return [
    { type: 'hook', title: 'HOOK', fit: hook },
    ...stepLayouts,
    { type: 'cta', title: kind === 'fact' ? 'KESIMPULAN' : kind === 'tutorial' ? 'HASIL / CTA' : 'KESIMPULAN / CTA', fit: finalFit }
  ];
}

// Tutorials are deliberately denser than other formats: the hook promises the
// outcome, related numbered actions share a practical-steps page, and the last
// page closes with the outcome, one useful note, and the CTA.
function buildTutorialLayouts(content, hookText, points) {
  const numbered = points.map((point, index) => point.replace(/^\d+[.)]\s*/, `${index + 1}. `));
  const totalWords = numbered.reduce((sum, point) => sum + wordCount(point), 0);
  const stepPageCount = numbered.length <= 5 && totalWords <= 45 ? 1
    : numbered.length <= 7 && totalWords <= 90 ? 2 : 3;
  const groups = groupTutorialSteps(numbered, Math.min(stepPageCount, numbered.length || 1));
  const result = limitWords(content.result || content.focus?.hasil || content.topic || 'Terapkan langkahnya dan periksa hasil akhir.', 14);
  const tip = limitWords(content.tip || content.focus?.solusi || content.caption || 'Bandingkan hasil sebelum dan sesudah agar perbaikannya terlihat.', 14);
  const hookFit = adaptiveTextFit(`${hookText}\nHASIL: ${result}`);
  const fittedGroups = groups.flatMap((steps) => paginateSteps(steps)).map((fit) => {
    if (fit.steps.length !== 1 || wordCount(fit.steps[0]) >= 15) return fit;
    const enriched = [fit.steps[0], `Hasil: ${result}`];
    const enrichedFit = fitStepPage(enriched);
    return enrichedFit ? { steps: enriched, ...enrichedFit } : fit;
  });
  const stepLayouts = fittedGroups.map((fit, index) => ({
    type: 'steps',
    title: fittedGroups.length === 1 ? 'LANGKAH PRAKTIS' : `LANGKAH ${index + 1}`,
    fit: { steps: fit.steps, fontSize: fit.fontSize, groups: fit.groups, height: fit.height, lineHeight: fit.lineHeight, lineCount: fit.lineCount, kind: fit.kind }
  }));
  const cta = limitWords(content.cta || 'Simpan panduan ini untuk dipraktikkan.', 9);
  const closing = `HASIL AKHIR: ${result}\nTIP: ${tip}\nCTA: ${cta}`;
  const closingFit = adaptiveTextFit(closing);
  return [{ type: 'hook', title: 'HOOK & HASIL', fit: hookFit }, ...stepLayouts, { type: 'cta', title: 'HASIL / TIPS / CTA', fit: closingFit }];
}

function groupTutorialSteps(points, count) {
  if (!points.length) return [['1. Ikuti petunjuk praktis sesuai urutan, lalu periksa hasil sebelum menyimpan perubahan.']];
  const groups = Array.from({ length: count }, () => []);
  points.forEach((point, index) => groups[Math.min(count - 1, Math.floor(index * count / points.length))].push(point));
  return groups.map((group) => {
    const kept = [];
    let words = 0;
    for (const point of group) {
      if (kept.length && words + wordCount(point) > 45) break;
      kept.push(point);
      words += wordCount(point);
    }
    return kept;
  });
}

function wordCount(text) { return String(text || '').trim().split(/\s+/).filter(Boolean).length; }

function limitWords(text, maximum) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).slice(0, maximum).join(' ');
}

function splitAtWordLimit(point) {
  const words = String(point || '').trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let index = 0; index < words.length; index += 35) chunks.push(words.slice(index, index + 35).join(' '));
  return chunks;
}

// Distribute related points across a fixed, compact number of pages. This merges
// short points instead of wasting a slide on a single short sentence.
function groupPoints(points, count) {
  if (!points.length) return [['Konten sedang disiapkan.']];
  const groups = Array.from({ length: Math.min(count, points.length) }, () => []);
  points.forEach((point, index) => groups[Math.min(groups.length - 1, Math.floor(index * groups.length / points.length))].push(point));
  return groups.map((group) => {
    const result = [];
    let words = 0;
    for (const point of group) {
      if (words + wordCount(point) > 35) break;
      result.push(point);
      words += wordCount(point);
    }
    return result.length ? result : [limitWords(group[0], 35)];
  });
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

function contentY(fit) {
  if (fit.kind === 'short') return 540;
  if (fit.kind === 'medium') return 450;
  return CONTENT_TOP;
}

function validateVisualLayout(layout) {
  if (!layout?.fit) throw new Error('Layout slide tidak memiliki isi.');
  const fit = layout.fit;
  const lineCount = fit.lineCount ?? fit.lines?.length ?? fit.groups?.reduce((sum, lines) => sum + lines.length, 0) ?? 0;
  const y = contentY(fit);
  const bottom = y + fit.height;
  if (LABEL_Y < SAFE_AREA.top || y < CONTENT_TOP) throw new Error('Teks tertutup search bar TikTok.');
  if (bottom > CONTENT_BOTTOM) throw new Error('Teks tertutup caption bawah TikTok.');
  if (lineCount > 7) throw new Error('Isi slide melebihi tujuh baris.');
  const allLines = fit.lines || fit.groups?.flat() || [];
  if (allLines.some((line) => measureTextWidth(line, fit.fontSize, layout.type !== 'steps') > SAFE_WIDTH + 1)) throw new Error('Teks masuk ke area ikon kanan TikTok.');
  // Short slides sit lower in the upper-middle; this prevents a small block at
  // the very top from making most of the composition look unintentionally empty.
  if (fit.kind === 'short' && y < 500) throw new Error('Slide memiliki area kosong berlebihan.');
  return true;
}

function renderLayout(layout, number, total) {
  validateVisualLayout(layout);
  const heading = textElement([layout.title], { y: LABEL_Y, fontSize: 34, lineHeight: 1.15, fill: '#f9a8d4' });
  const startY = contentY(layout.fit);
  if (layout.type === 'steps') {
    let y = startY;
    const elements = layout.fit.groups.map((lines) => {
      const element = textElement(lines, { y, fontSize: layout.fit.fontSize, lineHeight: layout.fit.lineHeight, weight: 600 });
      y += lines.length * layout.fit.fontSize * layout.fit.lineHeight + 24;
      return element;
    }).join('');
    return frame(heading + elements, number, total);
  }
  return frame(heading + textElement(layout.fit.lines, { y: startY, fontSize: layout.fit.fontSize, lineHeight: layout.fit.lineHeight }), number, total);
}

async function createSlides(id, content) {
  const dir = path.join(config.root, 'public/generated');
  await fs.mkdir(dir, { recursive: true });
  const layouts = buildSlideLayouts(content);
  const files = [];
  for (let i = 0; i < layouts.length; i++) {
    const name = `${id}-${i + 1}.jpg`;
    await sharp(Buffer.from(renderLayout(layouts[i], i + 1, layouts.length, content))).resize(WIDTH, HEIGHT).flatten({ background: '#ffffff' }).toColourspace('srgb').removeAlpha().jpeg({ quality: JPEG_QUALITY }).toFile(path.join(dir, name));
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

module.exports = { createSlides, validateSlides, measureTextWidth, wrapText, autoFitText, adaptiveTextFit, parseSteps, paginateSteps, buildSlideLayouts, resolveFooter, renderLayout, validateVisualLayout, contentY, wordCount, SAFE_AREA, WIDTH, HEIGHT, JPEG_QUALITY };
