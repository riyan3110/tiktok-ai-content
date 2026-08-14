const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config');
const images = require('./images');
const { INVISIBLE_SECTION } = require('./textInputVerbatimPatch');

const BODY_MIN_KEEP_RATIO = 0.65;
const TEXT_INPUT_LOWER_SHIFT = 70;
const OPTIONAL_TRAILING_STARTS = new Set([
  'untuk', 'agar', 'secara', 'dengan', 'melalui', 'sehingga', 'ketika', 'saat', 'yang'
]);
const TRAILING_CONNECTORS = new Set([
  'dan', 'atau', 'sedangkan', 'tetapi', 'namun', 'untuk', 'agar', 'secara', 'dengan', 'melalui', 'sehingga', 'ketika', 'saat', 'yang'
]);

let installed = false;
let originalCreateSlides = null;

function cleanInline(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeToken(value) {
  return String(value || '').toLocaleLowerCase('id-ID').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
}

function terminalize(words) {
  const kept = [...words];
  while (kept.length && TRAILING_CONNECTORS.has(normalizeToken(kept.at(-1)))) kept.pop();
  let value = cleanInline(kept.join(' ')).replace(/[,:;–—-]+$/g, '').replace(/[.!?]+$/g, '');
  return value ? `${value}.` : '';
}

function bodyCandidates(value) {
  const source = cleanInline(value);
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length < 7) return [];

  const minimum = Math.max(6, Math.ceil(words.length * BODY_MIN_KEEP_RATIO));
  const preferredCuts = [];
  for (let index = words.length - 1; index >= minimum; index -= 1) {
    if (OPTIONAL_TRAILING_STARTS.has(normalizeToken(words[index]))) preferredCuts.push(index);
  }
  for (let index = words.length - 1; index >= minimum; index -= 1) {
    if (/[,;:]$/.test(words[index - 1] || '')) preferredCuts.push(index);
  }

  const fallbackCuts = [];
  for (let index = words.length - 1; index >= minimum; index -= 1) fallbackCuts.push(index);

  const seen = new Set();
  const candidates = [];
  for (const cut of [...preferredCuts, ...fallbackCuts]) {
    const candidate = terminalize(words.slice(0, cut));
    if (!candidate || candidate === source || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
  }
  return candidates;
}

function renderSlide(slide, index, total, format) {
  const prepared = {
    section: INVISIBLE_SECTION,
    title: cleanInline(slide?.title),
    body: cleanInline(slide?.body),
    points: Array.isArray(slide?.points) ? slide.points.map(cleanInline).filter(Boolean) : []
  };
  const layout = images.buildStructuredLayout(prepared, index, total, format, { textInputOnly: true });
  images.validateVisualLayout(layout, { slideIndex: index + 1 });
  return { slide: prepared, layout };
}

function fitSlide(slide, index, total, format) {
  try {
    return { ...renderSlide(slide, index, total, format), trimmed: false };
  } catch (initialError) {
    if (!cleanInline(slide?.body)) throw initialError;

    for (const body of bodyCandidates(slide.body)) {
      try {
        const fitted = renderSlide({ ...slide, body }, index, total, format);
        return { ...fitted, trimmed: true, originalBody: cleanInline(slide.body) };
      } catch {}
    }
    throw initialError;
  }
}

function prepareSoftFitContent(content = {}) {
  if (content?.verificationStatus !== 'text_input_only' || !Array.isArray(content?.slides)) return content;
  const total = content.slides.length;
  const fitted = content.slides.map((slide, index) => fitSlide(slide, index, total, content.contentFormat));
  return {
    ...content,
    slides: fitted.map(item => item.slide),
    textInputSoftTrimmedSlides: fitted.flatMap((item, index) => item.trimmed ? [index + 1] : [])
  };
}

function lowerShiftForLayout(layout) {
  const startY = images.contentY(layout.fit);
  const contentBottom = images.HEIGHT - images.BOTTOM_SAFE_AREA;
  const slack = Math.floor(contentBottom - (startY + Number(layout.fit?.height || 0)));
  return Math.max(0, Math.min(TEXT_INPUT_LOWER_SHIFT, slack));
}

function shiftContentText(svg, shift) {
  if (!shift) return svg;
  return String(svg).replace(/(<text\b[^>]*\by=")(\d+(?:\.\d+)?)(")/g, (match, prefix, rawY, suffix) => {
    const y = Number(rawY);
    if (!Number.isFinite(y) || y < images.CONTENT_TOP) return match;
    return `${prefix}${Math.round(y + shift)}${suffix}`;
  });
}

async function createTextInputSlides(id, content) {
  let prepared;
  try {
    prepared = prepareSoftFitContent(content);
  } catch (error) {
    throw Object.assign(new Error(`Generate dari Teks: teks masih tidak muat setelah diringkas sedikit dari copy yang kamu tempel. Ringkas manual bagian yang terlalu panjang. (${error.message})`), { status: 422 });
  }

  const dir = path.join(config.root, 'public/generated');
  await fs.mkdir(dir, { recursive: true });
  const layouts = images.validateCarouselLayouts(images.buildSlideLayouts(prepared));
  const files = [];

  try {
    for (let index = 0; index < layouts.length; index += 1) {
      const name = `${id}-${index + 1}.jpg`;
      const background = prepared.background?.applyToAllSlides === false
        ? (prepared.background.slideBackgrounds?.[index] || prepared.background)
        : prepared.background;
      let svg = images.renderLayout(layouts[index], index + 1, layouts.length, prepared.watermark, background);
      if (index > 0) svg = shiftContentText(svg, lowerShiftForLayout(layouts[index]));
      await sharp(Buffer.from(svg))
        .resize(images.WIDTH, images.HEIGHT)
        .flatten({ background: '#ffffff' })
        .toColourspace('srgb')
        .removeAlpha()
        .jpeg({ quality: images.JPEG_QUALITY })
        .toFile(path.join(dir, name));
      files.push(`/generated/${name}`);
    }
    return files;
  } catch (error) {
    await Promise.all(files.map(file => fs.rm(path.join(config.root, 'public', file), { force: true })));
    throw error;
  }
}

function install() {
  if (installed) return;
  originalCreateSlides = images.createSlides;
  images.createSlides = async (id, content) => {
    if (content?.verificationStatus !== 'text_input_only') return originalCreateSlides(id, content);
    return createTextInputSlides(id, content);
  };
  installed = true;
}

function resetForTests() {
  if (!installed) return;
  images.createSlides = originalCreateSlides;
  originalCreateSlides = null;
  installed = false;
}

module.exports = {
  install,
  resetForTests,
  bodyCandidates,
  fitSlide,
  prepareSoftFitContent,
  lowerShiftForLayout,
  shiftContentText,
  createTextInputSlides,
  BODY_MIN_KEEP_RATIO,
  TEXT_INPUT_LOWER_SHIFT
};
