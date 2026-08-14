const textInputComposer = require('./textInputComposer');
const images = require('./images');

const MAX_TEXT_CHARS = 20000;
const SECTION_ORDER = ['HOOK', 'FAKTA UTAMA', 'DETAIL', 'PENUTUP'];
const INVISIBLE_SECTION = '\u2063';

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

function parseHeader(line) {
  const value = String(line || '').trim();
  const slide = value.match(/^(?:SLIDE\s*(\d+)\s*(?:[-–—:]\s*)?)?(HOOK|FAKTA\s+UTAMA|DETAIL|PENUTUP)\s*:?[\s]*$/i);
  if (slide) return { type: 'slide', number: slide[1] ? Number(slide[1]) : null, key: normalizeSectionLabel(slide[2]) };
  const meta = value.match(/^(CAPTION|HASHTAGS?)\s*:?[\s]*$/i);
  if (meta) return { type: 'meta', key: /^CAPTION$/i.test(meta[1]) ? 'CAPTION' : 'HASHTAGS' };
  return null;
}

function paragraphBlocks(lines = []) {
  const blocks = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    blocks.push(current.map(cleanInline).filter(Boolean).join(' '));
    current = [];
  };
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^[•*\-]\s+/.test(line)) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks.filter(Boolean);
}

function bulletLines(lines = []) {
  return lines
    .map(raw => String(raw || '').trim())
    .filter(line => /^[•*\-]\s+/.test(line))
    .map(line => line.replace(/^[•*\-]\s+/, '').trim())
    .filter(Boolean);
}

function parseSlideSection(section, lines) {
  const blocks = paragraphBlocks(lines);
  const points = bulletLines(lines);

  if (section === 'HOOK') {
    if (points.length) throw verbatimError('HOOK tidak boleh berisi bullet.');
    if (blocks.length !== 1) throw verbatimError('HOOK harus berisi tepat satu judul. Pisahkan bagian berikutnya dengan label FAKTA UTAMA.');
    return { section, title: blocks[0], body: '', points: [] };
  }

  if (section === 'FAKTA UTAMA' || section === 'DETAIL') {
    if (blocks.length < 2) throw verbatimError(`${section} harus berisi judul lalu body pada paragraf berikutnya.`);
    if (points.length > 3) throw verbatimError(`${section} maksimal memiliki 3 bullet. AI Ads Lab tidak akan memotong bullet yang kamu tempel.`);
    return {
      section,
      title: blocks[0],
      body: blocks.slice(1).join(' '),
      points
    };
  }

  if (section === 'PENUTUP') {
    if (points.length) throw verbatimError('PENUTUP tidak boleh berisi bullet.');
    if (blocks.length < 2) throw verbatimError('PENUTUP harus berisi judul lalu body pada paragraf berikutnya.');
    return { section, title: blocks[0], body: blocks.slice(1).join(' '), points: [] };
  }

  throw verbatimError(`bagian ${section} tidak dikenali.`);
}

function parseHashtags(lines = []) {
  const value = lines.map(line => String(line || '').trim()).filter(Boolean).join(' ');
  if (!value) return [];
  const tokens = value.split(/[\s,]+/).filter(Boolean);
  if (tokens.some(token => !/^#[\p{L}\p{N}_]+$/u.test(token))) {
    throw verbatimError('HASHTAGS hanya boleh berisi hashtag yang memang kamu tempel.');
  }
  return tokens;
}

function parseStructuredText(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n').trim();
  if (!source) throw verbatimError('tempel copy carousel yang sudah siap dipakai.');
  if (source.length > MAX_TEXT_CHARS) throw verbatimError(`teks terlalu panjang. Maksimal ${MAX_TEXT_CHARS.toLocaleString('id-ID')} karakter.`);

  const buckets = new Map();
  let current = null;
  let slideHeaderCount = 0;
  const seenSlides = [];

  for (const rawLine of source.split('\n')) {
    const header = parseHeader(rawLine);
    if (header) {
      current = header.key;
      if (buckets.has(current)) throw verbatimError(`label ${current} muncul lebih dari sekali.`);
      buckets.set(current, []);
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
    throw verbatimError('gunakan tepat 4 bagian berurutan: HOOK, FAKTA UTAMA, DETAIL, PENUTUP. Label hanya dipakai untuk penempatan dan tidak akan ditampilkan.');
  }

  const slides = SECTION_ORDER.map(section => parseSlideSection(section, buckets.get(section) || []));
  const captionBlocks = paragraphBlocks(buckets.get('CAPTION') || []);
  const caption = captionBlocks.join(' ');
  const hashtags = parseHashtags(buckets.get('HASHTAGS') || []);

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

  const slides = content.slides.map((slide, index) => ({
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
      throw verbatimError(`teks slide ${index + 1} tidak muat pada template. Ringkas teks yang kamu tempel; AI Ads Lab tidak akan memotong, menulis ulang, atau menambah kalimat. (${error.message})`);
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
  parseHeader,
  parseStructuredText,
  parseSlideSection,
  composeVerbatim,
  prepareVerbatimRenderContent,
  SECTION_ORDER,
  INVISIBLE_SECTION,
  MAX_TEXT_CHARS
};
