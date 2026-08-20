const textInputComposer = require('./textInputComposer');
const images = require('./images');

const MAX_TEXT_CHARS = 20000;
const SECTION_ORDER = ['HOOK', 'FAKTA UTAMA', 'DETAIL', 'PENUTUP'];
const INVISIBLE_SECTION = '\u2063';
const MAX_POINTS = 3;
const MAX_HASHTAGS = 5;
const BULLET_PATTERN = /^(?:[•●▪◦‣*+\-–—]|\d{1,2}[.)])\s*(.+)$/u;
const INLINE_BULLET_MARKER = /(?:^|\s)([•●▪◦‣*+]|\d{1,2}[.)])\s+/gu;
const HASHTAG_PATTERN = /^#[\p{L}\p{N}_]+$/u;
const HASHTAG_STOPWORDS = new Set([
  'ada', 'agar', 'akan', 'atau', 'baru', 'bagi', 'bagian', 'bahwa', 'banyak', 'berbeda', 'berisi', 'bisa', 'buat', 'buatan',
  'cara', 'dalam', 'dan', 'dapat', 'dari', 'dengan', 'detail', 'di', 'digunakan', 'diterapkan', 'ditujukan', 'dorong',
  'fakta', 'fokus', 'guna', 'hadirkan', 'hasil', 'hingga', 'hook', 'ini', 'jadi', 'juga', 'kali', 'karena', 'ke', 'konten',
  'langkah', 'lebih', 'masa', 'membantu', 'membuat', 'memiliki', 'menjadi', 'menuju', 'meningkatkan', 'model', 'oleh', 'pada',
  'penutup', 'pengguna', 'sebagai', 'seiring', 'semakin', 'slide', 'tanpa', 'telah', 'tentang', 'terhadap', 'untuk',
  'utama', 'yang'
]);

let installed = false;
let originalCompose = null;
let originalCreateSlides = null;

function cleanInline(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function verbatimError(message) {
  return Object.assign(new Error(`Generate dari Teks: ${message}`), { status: 422 });
}

function normalizeSectionLabel(value) {
  return cleanInline(value).toLocaleUpperCase('id-ID').replace(/\s+/g, ' ');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function parseHeader(line) {
  const value = String(line || '').trim();
  const slide = value.match(/^(?:SLIDE\s*(\d+)\s*(?:[-–—:]\s*)?)?(HOOK|FAKTA\s+UTAMA|DETAIL|PENUTUP)(?:\s*:\s*(.+))?\s*$/i);
  if (slide) return {
    type: 'slide',
    number: slide[1] ? Number(slide[1]) : null,
    key: normalizeSectionLabel(slide[2]),
    inlineContent: cleanInline(slide[3])
  };
  const meta = value.match(/^(CAPTION|HASHTAGS?|TAGAR)(?:\s*:\s*(.+))?\s*$/i);
  if (meta) return {
    type: 'meta',
    key: /^CAPTION$/i.test(meta[1]) ? 'CAPTION' : 'HASHTAGS',
    inlineContent: cleanInline(meta[2])
  };
  return null;
}

function bulletValue(line) {
  const match = String(line || '').trim().match(BULLET_PATTERN);
  return match ? cleanInline(match[1]) : '';
}

function splitInlineBullets(rawLine) {
  const line = String(rawLine || '').trim();
  if (!line || !bulletValue(line)) return [line];

  const matches = [...line.matchAll(INLINE_BULLET_MARKER)];
  if (matches.length <= 1) return [line];

  const parts = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : line.length;
    const value = cleanInline(line.slice(start, end));
    if (value) parts.push(`• ${value}`);
  }
  return parts.length ? parts : [line];
}

function logicalLines(value) {
  return normalizeText(value)
    .split('\n')
    .flatMap(line => splitInlineBullets(line));
}

function plainLines(lines = []) {
  return lines
    .map(raw => String(raw || '').trim())
    .filter(Boolean)
    .filter(line => !bulletValue(line))
    .map(cleanInline)
    .filter(Boolean);
}

function bulletLines(lines = []) {
  return lines.flatMap(splitInlineBullets).map(bulletValue).filter(Boolean);
}

function titleAndBody(lines = []) {
  const visibleLines = plainLines(lines);
  return {
    title: visibleLines[0] || '',
    body: visibleLines.slice(1).join(' ')
  };
}

function parseSlideSection(section, lines) {
  const points = bulletLines(lines);

  if (section === 'HOOK') {
    if (points.length) throw verbatimError('HOOK tetap berupa judul saja; pindahkan bullet ke FAKTA UTAMA atau DETAIL.');
    const title = plainLines(lines).join(' ');
    if (!title) throw verbatimError('HOOK harus memiliki judul.');
    return { section, title, body: '', points: [] };
  }

  if (section === 'FAKTA UTAMA' || section === 'DETAIL') {
    const parsed = titleAndBody(lines);
    if (!parsed.title) throw verbatimError(`${section} harus memiliki judul.`);

    let body = parsed.body;
    let normalizedPoints = [...points];
    if (!body && normalizedPoints.length) body = normalizedPoints.shift();
    if (!body) throw verbatimError(`${section} harus memiliki isi setelah judul, baik berupa body maupun bullet.`);
    if (normalizedPoints.length > MAX_POINTS) {
      throw verbatimError(`${section} memiliki terlalu banyak bullet untuk layout tetap. Maksimal ${MAX_POINTS} bullet setelah body.`);
    }

    return { section, title: parsed.title, body, points: normalizedPoints };
  }

  if (section === 'PENUTUP') {
    const parsed = titleAndBody(lines);
    if (!parsed.title) throw verbatimError('PENUTUP harus memiliki judul.');
    const body = [parsed.body, ...points].filter(Boolean).join(' ');
    if (!body) throw verbatimError('PENUTUP harus memiliki isi setelah judul.');
    return { section, title: parsed.title, body, points: [] };
  }

  throw verbatimError(`bagian ${section} tidak dikenali.`);
}

function parseHashtags(lines = []) {
  const value = lines.map(line => String(line || '').trim()).filter(Boolean).join(' ');
  if (!value) return [];
  const tokens = value.split(/[\s,]+/).filter(Boolean);
  if (tokens.some(token => !HASHTAG_PATTERN.test(token))) {
    throw verbatimError('HASHTAGS/TAGAR hanya boleh berisi hashtag yang valid.');
  }
  return [...new Set(tokens)].slice(0, MAX_HASHTAGS);
}

function hashtagToken(value) {
  return String(value || '').replace(/[^\p{L}\p{N}_]/gu, '').trim();
}

function generateHashtags(slides = [], caption = '') {
  const candidates = new Map();
  let order = 0;
  const addText = (value, weight) => {
    const words = String(value || '').match(/[\p{L}\p{N}_-]+/gu) || [];
    for (const raw of words) {
      const token = hashtagToken(raw);
      if (!token) continue;
      const lower = token.toLocaleLowerCase('id-ID');
      if (HASHTAG_STOPWORDS.has(lower)) continue;
      if (token.length < 3 && token.toUpperCase() !== 'AI') continue;
      if (/^\d+$/.test(token)) continue;
      const previous = candidates.get(lower) || { token, score: 0, order: order++ };
      previous.score += weight;
      if (/^[A-Z][\p{L}\p{N}_-]*$/u.test(raw) || raw === raw.toUpperCase()) previous.score += 1;
      candidates.set(lower, previous);
    }
  };

  for (const slide of slides) {
    addText(slide.title, 5);
    addText(slide.body, 2);
    for (const point of slide.points || []) addText(point, 2);
  }
  addText(caption, 1);

  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_HASHTAGS)
    .map(item => `#${item.token}`);
}

function parseStructuredText(text) {
  const source = normalizeText(text);
  if (!source) throw verbatimError('tempel copy carousel yang sudah siap dipakai.');
  if (source.length > MAX_TEXT_CHARS) throw verbatimError(`teks terlalu panjang. Maksimal ${MAX_TEXT_CHARS.toLocaleString('id-ID')} karakter.`);

  const buckets = new Map();
  let current = null;
  let slideHeaderCount = 0;
  const seenSlides = [];

  for (const rawLine of logicalLines(source)) {
    const header = parseHeader(rawLine);
    if (header) {
      current = header.key;
      if (buckets.has(current)) throw verbatimError(`label ${current} muncul lebih dari sekali.`);
      buckets.set(current, []);
      if (header.inlineContent) buckets.get(current).push(header.inlineContent);
      if (header.type === 'slide') {
        slideHeaderCount += 1;
        seenSlides.push(current);
        if (header.number !== null && header.number !== slideHeaderCount) {
          throw verbatimError(`urutan nomor slide harus 1 sampai 4; ditemukan SLIDE ${header.number} pada posisi ${slideHeaderCount}.`);
        }
      }
      continue;
    }
    if (!current) {
      if (!String(rawLine || '').trim()) continue;
      throw verbatimError('baris pertama harus berupa HOOK atau SLIDE 1 — HOOK.');
    }
    buckets.get(current).push(rawLine);
  }

  if (seenSlides.length !== 4 || seenSlides.some((section, index) => section !== SECTION_ORDER[index])) {
    throw verbatimError('gunakan tepat 4 bagian berurutan: HOOK, FAKTA UTAMA, DETAIL, PENUTUP. Bentuk hasil carousel tetap sama; label hanya dipakai untuk penempatan.');
  }

  const slides = SECTION_ORDER.map(section => parseSlideSection(section, buckets.get(section) || []));
  const caption = (buckets.get('CAPTION') || []).map(cleanInline).filter(Boolean).join(' ');
  const suppliedHashtags = parseHashtags(buckets.get('HASHTAGS') || []);
  const hashtags = suppliedHashtags.length ? suppliedHashtags : generateHashtags(slides, caption);

  return { slides, caption, hashtags };
}

function flattenPastedSlideCopy(slides) {
  return slides.slice(1).flatMap(slide => [slide.title, slide.body, ...slide.points]).filter(Boolean).join('\n');
}

async function composeVerbatim({ text } = {}) {
  const parsed = parseStructuredText(text);
  const [hook, fact, detail, closing] = parsed.slides;
  return {
    focus: {
      masalah: hook.title,
      penyebab: fact.body || fact.title,
      solusi: detail.body || detail.title,
      hasil: closing.body || closing.title
    },
    topic: hook.title,
    hook: hook.title,
    body: flattenPastedSlideCopy(parsed.slides),
    caption: parsed.caption,
    hashtags: parsed.hashtags,
    cta: closing.title,
    trendKeywordsUsed: [],
    content_angle: hook.title,
    primary_tool: 'teks pengguna',
    hook_pattern: 'text-input-verbatim',
    verificationStatus: 'text_input_only',
    unsupportedClaims: [],
    slides: parsed.slides
  };
}

function prepareVerbatimRenderContent(content = {}) {
  if (content?.verificationStatus !== 'text_input_only' || !Array.isArray(content?.slides)) return content;
  if (content.slides.length !== 4) throw verbatimError('renderer hanya menerima 4 slide copy-locked.');

  const slides = content.slides.map(slide => ({
    section: INVISIBLE_SECTION,
    title: cleanInline(slide?.title),
    body: cleanInline(slide?.body),
    points: Array.isArray(slide?.points) ? slide.points.map(cleanInline).filter(Boolean) : []
  }));

  for (let index = 0; index < slides.length; index += 1) {
    try {
      const layout = images.buildStructuredLayout(slides[index], index, slides.length, content.contentFormat, { textInputOnly: true });
      images.validateVisualLayout(layout, { slideIndex: index + 1 });
    } catch (error) {
      throw verbatimError(`teks slide ${index + 1} tidak muat pada template. Ringkas teks yang kamu tempel; AI Ads Lab tidak akan menambah klaim baru. (${error.message})`);
    }
  }

  return { ...content, slides };
}

function install() {
  if (installed) return;
  originalCompose = textInputComposer.compose;
  originalCreateSlides = images.createSlides;

  textInputComposer.compose = composeVerbatim;
  images.createSlides = async (id, content) => {
    if (content?.verificationStatus !== 'text_input_only') return originalCreateSlides(id, content);
    return originalCreateSlides(id, prepareVerbatimRenderContent(content));
  };

  installed = true;
}

function resetForTests() {
  if (!installed) return;
  textInputComposer.compose = originalCompose;
  images.createSlides = originalCreateSlides;
  originalCompose = null;
  originalCreateSlides = null;
  installed = false;
}

module.exports = {
  install,
  resetForTests,
  normalizeText,
  logicalLines,
  parseHeader,
  parseStructuredText,
  parseSlideSection,
  parseHashtags,
  generateHashtags,
  composeVerbatim,
  prepareVerbatimRenderContent,
  SECTION_ORDER,
  INVISIBLE_SECTION,
  MAX_TEXT_CHARS,
  MAX_POINTS,
  MAX_HASHTAGS
};
