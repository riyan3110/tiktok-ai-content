const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config');
const { normalizeSlides, validateSlides: validateContentSlides } = require('./content');

const WIDTH = 1080;
const HEIGHT = 1920;
const JPEG_QUALITY = 90;
// TikTok overlays occupy the search/header region, the action rail at the
// right, and the caption/navigation region at the bottom. Keep all meaningful
// copy inside this deliberately asymmetric canvas.
const SAFE_AREA = Object.freeze({ left: 90, right: 250, top: 340, bottom: 340 });
const SAFE_WIDTH = WIDTH - SAFE_AREA.left - SAFE_AREA.right;
const SAFE_HEIGHT = HEIGHT - SAFE_AREA.top - SAFE_AREA.bottom;
const LABEL_Y = 425;
const CONTENT_TOP = 580;
const BOTTOM_SAFE_AREA = SAFE_AREA.bottom;
const CONTENT_BOTTOM = HEIGHT - BOTTOM_SAFE_AREA;
const OVERFLOW_TOLERANCE = 8;
const WATERMARK_Y = 270;
const TEXT_INPUT_HOOK_Y = 680;

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

// Height validation is always performed in pixels on the original 1080x1920
// canvas. Browser preview dimensions intentionally are not accepted here.
function layoutHeightMetrics(fit, slideIndex) {
  const textHeight = Number(fit?.height || 0);
  const availableHeight = HEIGHT - CONTENT_TOP - BOTTOM_SAFE_AREA;
  const isOverflowing = textHeight > availableHeight + OVERFLOW_TOLERANCE;
  return {
    slideIndex,
    textHeight,
    availableHeight,
    contentTop: CONTENT_TOP,
    bottomSafeArea: BOTTOM_SAFE_AREA,
    fontSize: fit?.fontSize ?? fit?.pointSize ?? fit?.titleFit?.fontSize,
    lineHeight: fit?.lineHeight ?? fit?.bodyFit?.lineHeight ?? 1.22,
    isOverflowing
  };
}

function isTextHeightValid(textHeight, availableHeight, tolerance = OVERFLOW_TOLERANCE) {
  return Number(textHeight) <= Number(availableHeight) + Number(tolerance);
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
    let count = Math.min(2, remaining.length);
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

function normalizeWatermarkOptions(options = {}) {
  return {
    enabled: typeof options.enabled === 'boolean' ? options.enabled : config.watermarkEnabled,
    text: String(options.text || config.watermarkText).trim() || 'AI ADS LAB',
    opacity: config.watermarkOpacity,
    position: 'top-left',
    fontSize: config.watermarkFontSize
  };
}

function watermarkElement(options, contrastColor = '#FFFFFF') {
  const watermark = normalizeWatermarkOptions(options);
  if (!watermark.enabled) return '';
  return `<text data-role="watermark" x="80" y="${WATERMARK_Y}" fill="${contrastColor}" fill-opacity="${watermark.opacity}" font-family="Arial,sans-serif" font-size="${watermark.fontSize}" font-weight="600" letter-spacing="1.5" text-anchor="start">${escapeXml(watermark.text)}</text>`;
}

function frame(inner, number, total, watermark, background = {}) {
  const color = /^#[0-9a-f]{6}$/i.test(background.color || '') ? background.color : '#0B0B0D';
  const image = background.imageData ? `<image width="${WIDTH}" height="${HEIGHT}" href="${escapeXml(background.imageData)}" preserveAspectRatio="xMidYMid slice"/>` : '';
  const textColor = background.textColor === '#000000' ? '#000000' : '#FFFFFF';
  const themedInner = inner.replaceAll('fill="white"', `fill="${textColor}"`).replaceAll('fill="#f3e8ff"', `fill="${textColor}"`).replaceAll('fill="#f9a8d4"', `fill="${textColor}"`);
  return `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="${WIDTH}" height="${HEIGHT}" fill="${color}"/>${image}${watermarkElement(watermark, textColor)}${themedInner}<text x="${WIDTH - SAFE_AREA.right}" y="${LABEL_Y}" fill="${textColor}" font-family="Arial,sans-serif" font-size="28" font-weight="700" text-anchor="end">${number}/${total}</text></svg>`;
}

function buildStructuredLayout(slide, index, total, format = '', options = {}) {
  const textInputOnly = options.textInputOnly === true;
  const tutorial = !textInputOnly && (/tutorial/i.test(format) || /LANGKAH/i.test(slide.section));
  const titleFit = slide.title ? autoFitText(slide.title, { maxWidth: SAFE_WIDTH, maxHeight: 250, maxLines: 3, startSize: 76, minSize: 46, lineHeight: 1.08 }) : null;
  const bodyFit = slide.body ? autoFitText(slide.body, { maxWidth: SAFE_WIDTH, maxHeight: 220, maxLines: 4, startSize: 42, minSize: 34, lineHeight: 1.24 }) : null;
  if (slide.title && !titleFit) throw new Error('Judul tidak muat dalam maksimal tiga baris.');
  if (slide.body && !bodyFit) throw new Error('Body tidak muat dalam maksimal empat baris.');
  let pointSize = 39; let pointSpacing = 19; let points; let height; let lineCount;
  do {
    pointSize--;
    pointSpacing = Math.max(12, pointSpacing - 1);
    points = slide.points.slice(0, 3).map((point, pointIndex) => {
      const clean = String(point).replace(textInputOnly ? /^(?:[-•*]\s*|\d+[.)]\s+)/ : /^[-•*\d.)\s]+/, '').trim();
      const prefix = tutorial ? `${pointIndex + 1}.` : '•';
      return { text: `${prefix} ${clean}`, lines: wrapText(`${prefix} ${clean}`, SAFE_WIDTH, pointSize, false) };
    });
    lineCount = (titleFit?.lines.length || 0) + (bodyFit?.lines.length || 0) + points.reduce((sum, point) => sum + point.lines.length, 0);
    height = (titleFit?.height || 0) + (bodyFit ? bodyFit.height + pointSpacing : 0) + points.reduce((sum, point) => sum + point.lines.length * pointSize * 1.22 + pointSpacing, 0);
  } while ((lineCount > 9 || height > CONTENT_BOTTOM - CONTENT_TOP) && pointSize > 32);
  return {
    type: 'structured', title: slide.section || `SLIDE ${index + 1}`,
    content: { title: slide.title, body: slide.body, points },
    fit: { kind: height < 320 ? 'short' : height < 560 ? 'medium' : 'long', height, lineCount, titleFit, bodyFit, pointSize, pointSpacing, lines: [] },
    isOnlyTitle: Boolean(slide.title && !slide.body && !points.length),
    textInputHook: Boolean(textInputOnly && index === 0 && slide.title && !slide.body && !points.length), total
  };
}

function wordChunks(value, maximum) {
  const values = String(value || '').trim().split(/\s+/).filter(Boolean);
  return Array.from({ length: Math.ceil(values.length / maximum) }, (_, index) => values.slice(index * maximum, (index + 1) * maximum).join(' '));
}

// Final deterministic repair after the model's editorial passes: remove exact
// repetition, turn overflow into concise bullets, and move remaining bullets to
// continuation slides without changing their order.
function repairStructuredSlides(input) {
  const repaired = [];
  for (const [slideIndex, original] of normalizeSlides(input).entries()) {
    const slide = { ...original, points: [...original.points] };
    slide.body = slide.body.replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1').replace(/\s+/g, ' ').trim();
    const bodyParts = wordChunks(slide.body, 22);
    slide.body = bodyParts.shift() || '';
    const supplied = Array.isArray(input[slideIndex]?.points) ? input[slideIndex].points : slide.points;
    const overflow = [...bodyParts.flatMap(value => wordChunks(value, 7)), ...supplied.flatMap(value => wordChunks(value, 7))];
    slide.points = overflow.splice(0, 3);
    repaired.push(slide);
    while (overflow.length) repaired.push({ section: 'LANJUTAN', title: `Lanjutan: ${wordChunks(slide.title, 11)[0] || 'Penjelasan'}`, body: '', points: overflow.splice(0, 3) });
  }
  return repaired;
}

function fitStructuredSlides(input, format = '', options = {}) {
  const normalized = normalizeSlides(input);
  const canKeepOriginal = normalized.every((slide, index) => {
    if (slide.points.length > 3) return false;
    try {
      return validateVisualLayout(buildStructuredLayout(slide, index, normalized.length, format, options));
    } catch {
      return false;
    }
  });
  return canKeepOriginal ? normalized : repairStructuredSlides(input);
}

function buildSlideLayouts(content) {
  if (Array.isArray(content.slides)) {
    // Generate dari Teks has its own fixed carousel structure. Keep its hook
    // and bullets independent from the UI format selector without changing URL mode.
    const textInputOnly = content.verificationStatus === 'text_input_only';
    const layoutOptions = { textInputOnly };
    // Do not summarize or bulletize copy that already fits the native canvas.
    const slides = fitStructuredSlides(content.slides, content.contentFormat, layoutOptions);
    // Source-filtered copy has already passed its own evidence-aware validation.
    // The renderer should only enforce structural/layout limits here; rerunning
    // the generic duplicate-copy gate can falsely reject valid source-backed
    // paraphrases that intentionally repeat the core entity across fields.
    const sourceVerified = ['source_based', 'needs_review'].includes(content.verificationStatus);
    const errors = validateContentSlides(slides, { format: content.contentFormat, validateCopy: !sourceVerified });
    if (errors.length) throw Object.assign(new Error(`Tahap layout: ${errors.join(' ')}`), { status: 422 });
    return validateCarouselLayouts(slides.map((slide, index) => buildStructuredLayout(slide, index, slides.length, content.contentFormat, layoutOptions)));
  }
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
  // Numbers supplied by an AI are not trusted. Rebuild them once, before any
  // pagination, so numbering can never restart or skip between slides.
  const rawPoints = normalizePointSequence(parseSteps(content.body).flatMap(splitAtWordLimit).filter(Boolean));
  if (kind === 'tutorial') return buildTutorialLayouts(content, hookText, rawPoints);
  const desiredBodySlides = kind === 'tutorial' ? 3 : 2;
  const longContent = rawPoints.reduce((sum, point) => sum + wordCount(point), 0) > 105;
  const bodySlideCount = Math.min(longContent ? 4 : desiredBodySlides, rawPoints.length);
  const groups = groupPoints(rawPoints, bodySlideCount);
  const formatTitle = {
    tips: 'TIPS', motivation: 'PESAN', solution: 'MASALAH → SOLUSI',
    beforeAfter: 'BEFORE → AFTER', education: 'PENJELASAN', ugc: 'IDE KONTEN', custom: 'PENJELASAN'
  }[kind];
  const stepLayouts = groups.flatMap((steps) => paginateSteps(steps)).map((fit, index, pages) => ({
    type: 'steps',
    title: semanticSlideLabel(kind, index, pages.length, formatTitle),
    fit
  }));
  const finalText = limitWords(content.topic || 'Sudah siap menerapkannya?', 35);
  const finalFit = adaptiveTextFit(finalText);
  return validateCarouselLayouts([
    { type: 'hook', title: 'HOOK', fit: hook },
    ...stepLayouts,
    { type: 'cta', title: kind === 'fact' ? 'KESIMPULAN' : kind === 'tutorial' ? 'HASIL / CTA' : 'KESIMPULAN / CTA', fit: finalFit }
  ]);
}

function normalizePointSequence(points) {
  return points.map((point, index) => `${index + 1}. ${String(point).replace(/^\s*\d+[.)]\s*/, '').trim()}`);
}

function semanticSlideLabel(kind, index, total, fallback) {
  if (kind !== 'fact' && kind !== 'education' && kind !== 'custom') return fallback;
  if (index === 0) return 'PENJELASAN UTAMA';
  if (index === total - 1 && total > 2) return 'DAMPAK';
  return 'FAKTA PENDUKUNG';
}

function validateCarouselLayouts(layouts) {
  const stepLayouts = layouts.filter(({ type }) => type === 'steps');
  const numbers = stepLayouts.flatMap(({ fit }) => fit.steps || []).map((step) => Number(String(step).match(/^(\d+)[.)]/)?.[1])).filter(Number.isFinite);
  if (numbers.some((number, index) => number !== index + 1) || new Set(numbers).size !== numbers.length) {
    throw new Error('Urutan nomor poin carousel tidak valid.');
  }
  if (stepLayouts.some(({ fit }) => (fit.steps?.length || 0) > 2 || wordCount(fit.steps?.join(' ')) > 40)) {
    throw new Error('Isi slide melebihi batas dua poin atau 40 kata.');
  }
  if (layouts.length < 3) throw Object.assign(new Error(`Tahap layout: hanya ${layouts.length} slide valid; minimal 3 slide.`), { status: 422 });
  layouts.forEach((layout, index) => {
    try { validateVisualLayout(layout, { slideIndex: index + 1 }); } catch (error) {
      const message = error.code === 'TEXT_OVERFLOW'
        ? `Slide ${index + 1} ${error.message}`
        : `Slide ${index + 1} gagal pada tahap layout: ${error.message}`;
      throw Object.assign(new Error(message), { status: 422 });
    }
  });
  return layouts;
}

// Tutorials are deliberately denser than other formats: the hook promises the
// outcome, related numbered actions share a practical-steps page, and the last
// page closes with the outcome, one useful note, and the CTA.
function buildTutorialLayouts(content, hookText, points) {
  const numbered = normalizePointSequence(points);
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
  return validateCarouselLayouts([{ type: 'hook', title: 'HOOK & HASIL', fit: hookFit }, ...stepLayouts, { type: 'cta', title: 'HASIL / TIPS / CTA', fit: closingFit }]);
}

function groupTutorialSteps(points, count) {
  if (!points.length) return [['1. Ikuti petunjuk praktis sesuai urutan, lalu periksa hasil sebelum menyimpan perubahan.']];
  return groupSequentialPoints(points, 40);
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
  return groupSequentialPoints(points, 40);
}

function groupSequentialPoints(points, wordLimit) {
  const groups = [];
  for (const original of points) {
    const point = limitWords(original, wordLimit);
    const current = groups.at(-1);
    if (!current || current.length === 2 || wordCount(current.join(' ')) + wordCount(point) > wordLimit) groups.push([point]);
    else current.push(point);
  }
  return groups;
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
  if (fit.kind === 'short') return Math.round(Math.max(720, Math.min(900, (HEIGHT - fit.height) / 2)));
  // Keep the end of medium/long blocks at or below 55% of the canvas. This
  // retains breathing room while preventing an unintentional empty lower half.
  const balancedY = Math.round(HEIGHT * 0.55 - fit.height);
  if (fit.kind === 'medium') return Math.max(CONTENT_TOP, balancedY);
  return Math.max(CONTENT_TOP, balancedY);
}

function validateVisualLayout(layout, { slideIndex } = {}) {
  if (!layout?.fit) throw new Error('Layout slide tidak memiliki isi.');
  const fit = layout.fit;
  const y = contentY(fit);
  const metrics = layoutHeightMetrics(fit, slideIndex);
  console.debug(metrics);
  if (LABEL_Y < SAFE_AREA.top || y < CONTENT_TOP) throw new Error('Teks tertutup search bar TikTok.');
  if (metrics.isOverflowing) {
    const error = new Error(`tidak muat: tinggi teks ${Math.round(metrics.textHeight)} px, area tersedia ${metrics.availableHeight} px.`);
    error.code = 'TEXT_OVERFLOW';
    throw error;
  }
  const allLines = layout.type === 'structured'
    ? [fit.titleFit?.lines, fit.bodyFit?.lines, ...(layout.content?.points || []).map(point => point.lines)].flat().filter(Boolean)
    : fit.lines || fit.groups?.flat() || [];
  if (allLines.some((line) => measureTextWidth(line, fit.fontSize, layout.type !== 'steps') > SAFE_WIDTH + 1)) throw new Error('Teks masuk ke area ikon kanan TikTok.');
  // Short slides sit lower in the upper-middle; this prevents a small block at
  // the very top from making most of the composition look unintentionally empty.
  if (fit.kind === 'short' && y < 500) throw new Error('Slide memiliki area kosong berlebihan.');
  return true;
}

function renderLayout(layout, number, total, watermark, background) {
  validateVisualLayout(layout);
  const heading = textElement([layout.title], { y: LABEL_Y, fontSize: 34, lineHeight: 1.15, fill: '#f9a8d4' });
  const startY = contentY(layout.fit);
  if (layout.type === 'structured') {
    let y = layout.isOnlyTitle
      ? (layout.textInputHook ? TEXT_INPUT_HOOK_Y : Math.round(Math.max(CONTENT_TOP, (CONTENT_TOP + CONTENT_BOTTOM - layout.fit.height) / 2)))
      : startY;
    const parts = [];
    if (layout.fit.titleFit) {
      parts.push(textElement(layout.fit.titleFit.lines, { y, fontSize: layout.fit.titleFit.fontSize, lineHeight: 1.1, weight: 700 }));
      y += layout.fit.titleFit.height;
    }
    if (layout.fit.bodyFit) {
      y += layout.fit.pointSpacing;
      parts.push(textElement(layout.fit.bodyFit.lines, { y, fontSize: layout.fit.bodyFit.fontSize, lineHeight: layout.fit.bodyFit.lineHeight, weight: 400, fill: '#f3e8ff' }));
      y += layout.fit.bodyFit.height;
    }
    for (const point of layout.content.points) {
      y += layout.fit.pointSpacing;
      parts.push(textElement(point.lines, { y, fontSize: layout.fit.pointSize, lineHeight: 1.22, weight: 600 }));
      y += point.lines.length * layout.fit.pointSize * 1.22;
    }
    return frame(heading + parts.join(''), number, total, watermark, background);
  }
  if (layout.type === 'steps') {
    let y = startY;
    const elements = layout.fit.groups.map((lines) => {
      const element = textElement(lines, { y, fontSize: layout.fit.fontSize, lineHeight: layout.fit.lineHeight, weight: 600 });
      y += lines.length * layout.fit.fontSize * layout.fit.lineHeight + 24;
      return element;
    }).join('');
    return frame(heading + elements, number, total, watermark, background);
  }
  return frame(heading + textElement(layout.fit.lines, { y: startY, fontSize: layout.fit.fontSize, lineHeight: layout.fit.lineHeight }), number, total, watermark, background);
}

async function createSlides(id, content) {
  const dir = path.join(config.root, 'public/generated');
  await fs.mkdir(dir, { recursive: true });
  let layouts;
  try {
    layouts = validateCarouselLayouts(buildSlideLayouts(content));
  } catch (error) {
    if (Array.isArray(content.slides)) throw error;
    // One deterministic repair pass: normalize whitespace and point numbering,
    // then validate the complete carousel before writing even the first JPG.
    const repaired = { ...content, body: normalizePointSequence(parseSteps(content.body).flatMap(splitAtWordLimit).filter(Boolean)).join('\n') };
    layouts = validateCarouselLayouts(buildSlideLayouts(repaired));
  }
  const files = [];
  try {
    for (let i = 0; i < layouts.length; i++) {
      const name = `${id}-${i + 1}.jpg`;
      const background = content.background?.applyToAllSlides === false ? (content.background.slideBackgrounds?.[i] || content.background) : content.background;
      await sharp(Buffer.from(renderLayout(layouts[i], i + 1, layouts.length, content.watermark, background))).resize(WIDTH, HEIGHT).flatten({ background: '#ffffff' }).toColourspace('srgb').removeAlpha().jpeg({ quality: JPEG_QUALITY }).toFile(path.join(dir, name));
      files.push(`/generated/${name}`);
    }
    return files;
  } catch (error) {
    await Promise.all(files.map(file => fs.rm(path.join(config.root, 'public', file), { force: true })));
    throw error;
  }
}

function generatedPath(file) {
  if (typeof file !== 'string' || !/^\/generated\/[a-zA-Z0-9._-]+\.jpg$/.test(file)) return null;
  const target = path.resolve(config.root, 'public', file.slice(1));
  const root = path.resolve(config.root, 'public/generated');
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

async function cleanupSlides(files = []) { await Promise.all([...new Set(files)].map(generatedPath).filter(Boolean).map(file => fs.rm(file, { force: true }))); }

async function promoteSlides(files, contentId, previous = [], afterReplace) {
  if (!Array.isArray(files) || !files.length || !files.every(generatedPath)) throw new Error('File render sementara tidak valid.');
  const stable = files.map((_, index) => `/generated/${contentId}-${index + 1}.jpg`);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const backups = []; const promoted = [];
  try {
    for (let index = 0; index < stable.length; index++) {
      const target = generatedPath(stable[index]);
      try { await fs.access(target); const backup = `${target}.backup-${token}`; await fs.rename(target, backup); backups.push({ target, backup }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rename(generatedPath(files[index]), target); promoted.push(target);
    }
    if (afterReplace) await afterReplace(stable);
  } catch (error) {
    await Promise.all(promoted.map(file => fs.rm(file, { force: true })));
    await Promise.all(backups.map(({ target, backup }) => fs.rename(backup, target).catch(() => {})));
    await cleanupSlides(files);
    throw error;
  }
  await Promise.all(backups.map(({ backup }) => fs.rm(backup, { force: true })));
  await cleanupSlides(files.filter(file => !stable.includes(file)));
  await cleanupSlides(previous.filter(file => !stable.includes(file)));
  return stable;
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

module.exports = { createSlides, validateSlides, measureTextWidth, wrapText, autoFitText, adaptiveTextFit, parseSteps, paginateSteps, buildSlideLayouts, buildStructuredLayout, repairStructuredSlides, fitStructuredSlides, normalizePointSequence, semanticSlideLabel, validateCarouselLayouts, resolveFooter, renderLayout, validateVisualLayout, layoutHeightMetrics, isTextHeightValid, contentY, wordCount, normalizeWatermarkOptions, watermarkElement, cleanupSlides, promoteSlides, generatedPath, SAFE_AREA, WIDTH, HEIGHT, JPEG_QUALITY, WATERMARK_Y, LABEL_Y, CONTENT_TOP, BOTTOM_SAFE_AREA, OVERFLOW_TOLERANCE };
