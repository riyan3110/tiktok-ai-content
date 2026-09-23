const textInputComposer = require('./textInputComposer');
const images = require('./images');
const { resolveContentLayout } = require('./contentLayouts');

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

function parseSlideSection(section, lines, { lenient = false } = {}) {
  const points = bulletLines(lines);

  if (section === 'HOOK') {
    if (points.length && !lenient) throw verbatimError('HOOK tetap berupa judul saja; pindahkan bullet ke FAKTA UTAMA atau DETAIL.');
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
    // Non-default layouts (berita/cerita/tutorial) tolerate a slide that only
    // has a heading: the card renderer simply omits the body block. Default
    // stays strict so the legacy carousel behavior is unchanged.
    if (!body && !lenient) throw verbatimError(`${section} harus memiliki isi setelah judul, baik berupa body maupun bullet.`);
    if (normalizedPoints.length > MAX_POINTS) {
      throw verbatimError(`${section} memiliki terlalu banyak bullet untuk layout tetap. Maksimal ${MAX_POINTS} bullet setelah body.`);
    }

    return { section, title: parsed.title, body: body || '', points: normalizedPoints };
  }

  if (section === 'PENUTUP') {
    const parsed = titleAndBody(lines);
    if (!parsed.title) throw verbatimError('PENUTUP harus memiliki judul.');
    const body = [parsed.body, ...points].filter(Boolean).join(' ');
    if (!body && !lenient) throw verbatimError('PENUTUP harus memiliki isi setelah judul.');
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

// ── Per-layout heading vocabulary ─────────────────────────────────────────
// The verbatim carousel always resolves to the SAME fixed 4 slots
// (HOOK → FAKTA UTAMA → DETAIL → PENUTUP) with identical parse rules. Only the
// LABELS the user is allowed to paste differ per layout, so that each selected
// tata letak (tutorial/cerita/berita) can accept its own heading style. The
// pasted section label never reaches the image (renderer relabels via
// layoutStyle), it only marks slide boundaries. Default is NEVER routed here —
// it keeps the original strict parser untouched.
const CANONICAL_SECTION_ALIASES = [
  ['HOOK'],        // slot 0
  ['FAKTA UTAMA'], // slot 1
  ['DETAIL'],      // slot 2
  ['PENUTUP']      // slot 3
];

const LAYOUT_SECTION_ALIASES = {
  news: [
    ['HEADLINE', 'HOOK', 'JUDUL', 'PEMBUKA'],
    ['FAKTA UTAMA', 'APA YANG TERJADI', 'INTI BERITA', 'POKOK'],
    ['KONTEKS DETAIL', 'KONTEKS', 'DETAIL PENTING', 'DETAIL', 'LATAR'],
    ['PERKEMBANGAN TERAKHIR', 'PERKEMBANGAN', 'APA SELANJUTNYA', 'PENUTUP', 'KESIMPULAN']
  ],
  story: [
    ['PEMBUKA CERITA', 'PEMBUKA', 'HOOK', 'AWAL CERITA'],
    ['SITUASI AWAL', 'SITUASI', 'LATAR'],
    ['PERKEMBANGAN', 'KEJADIAN UTAMA', 'KONFLIK', 'PUNCAK'],
    ['PENYELESAIAN', 'MAKNA', 'PENUTUP', 'AKHIR CERITA', 'PELAJARAN']
  ],
  tutorial: [
    ['PEMBUKA TUTORIAL', 'PEMBUKA', 'HOOK', 'INTRO'],
    ['LANGKAH 1', 'LANGKAH SATU', 'LANGKAH PERTAMA'],
    ['LANGKAH 2', 'LANGKAH DUA', 'LANGKAH KEDUA'],
    ['HASIL PENUTUP', 'HASIL', 'PENUTUP', 'HASIL AKHIR', 'KESIMPULAN']
  ]
};

// Enumerated content markers ("FAKTA 1 — …", "LANGKAH 2: …", "TIPS 3) …"): in a
// non-default layout these are turned into bullets so the renderer can show them
// as FAKTA/numbered cards. The sentence text is preserved verbatim (copy-lock);
// only the redundant marker prefix — which the card itself already displays — is
// dropped so the words sit neatly inside the card.
const ENUM_CONTENT_MARKER = /^(?:FAKTA|LANGKAH|POIN|POINT|TIPS?|STEP|BAGIAN)\s*\d+\s*[-–—:.)]\s+(.+)$/i;

function normalizeLabelKey(value) {
  return String(value || '')
    .toLocaleUpperCase('id-ID')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLabelIndex(layoutId) {
  const index = new Map();
  const add = (labels, pos) => labels.forEach(label => index.set(normalizeLabelKey(label), pos));
  // Canonical labels always work (a default-style paste stays valid under any
  // layout), then the layout's own labels are layered on top.
  CANONICAL_SECTION_ALIASES.forEach((labels, pos) => add(labels, pos));
  const table = LAYOUT_SECTION_ALIASES[layoutId];
  if (table) table.forEach((labels, pos) => add(labels, pos));
  return index;
}

function normalizeContentLine(line) {
  const trimmed = String(line || '').trim();
  const marker = trimmed.match(ENUM_CONTENT_MARKER);
  if (marker && marker[1]) return `• ${marker[1].trim()}`;
  return line;
}

function matchLayoutHeader(line, labelIndex) {
  const value = String(line || '').trim();
  if (!value) return null;

  const meta = value.match(/^(CAPTION|HASHTAGS?|TAGAR)(?:\s*:\s*(.+))?\s*$/i);
  if (meta) return { type: 'meta', key: /^CAPTION$/i.test(meta[1]) ? 'CAPTION' : 'HASHTAGS', inlineContent: cleanInline(meta[2]) };

  let rest = value;
  let number = null;
  const slide = value.match(/^SLIDE\s*(\d+)\s*(?:[-–—:]\s*)?(.*)$/i);
  if (slide) {
    number = Number(slide[1]);
    rest = String(slide[2] || '').trim();
  }

  let label = rest;
  let inline = '';
  const colon = rest.indexOf(':');
  if (colon !== -1) {
    label = rest.slice(0, colon).trim();
    inline = rest.slice(colon + 1).trim();
  }

  const key = normalizeLabelKey(label);
  // An explicit "SLIDE n" number is the user's authoritative ordering, so it
  // wins over the label vocabulary (a "SLIDE 4 — PERKEMBANGAN" must land in slot
  // 4 even if PERKEMBANGAN is also a mid-story alias). Only when there is no
  // slide number do we resolve position from the layout's heading vocabulary.
  let position = null;
  if (number !== null) position = number - 1;
  else if (key && labelIndex.has(key)) position = labelIndex.get(key);
  if (position === null) return null;
  return { type: 'slide', position, number, inlineContent: cleanInline(inline) };
}

function parseStructuredText(text, contentLayout = 'default') {
  const source = normalizeText(text);
  if (!source) throw verbatimError('tempel copy carousel yang sudah siap dipakai.');
  if (source.length > MAX_TEXT_CHARS) throw verbatimError(`teks terlalu panjang. Maksimal ${MAX_TEXT_CHARS.toLocaleString('id-ID')} karakter.`);

  const layoutId = LAYOUT_SECTION_ALIASES[contentLayout] ? contentLayout : 'default';
  return layoutId === 'default'
    ? parseDefaultStructured(source)
    : parseLayoutStructured(source, layoutId);
}

// Default: unchanged from the original strict parser. Only the canonical labels
// (HOOK/FAKTA UTAMA/DETAIL/PENUTUP) are accepted, in order.
function parseDefaultStructured(source) {
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

// Non-default layouts: accept the layout's own heading vocabulary and map every
// slide to one of the 4 fixed slots by position. Parse rules per slot are
// identical to Default, so the carousel shape is unchanged — only the accepted
// labels differ, which is what makes each tata letak distinct.
function parseLayoutStructured(source, layoutId) {
  const labelIndex = buildLabelIndex(layoutId);
  const buckets = new Map(); // '0'..'3' | 'CAPTION' | 'HASHTAGS'
  let current = null;
  let slideCount = 0;

  for (const rawLine of logicalLines(source)) {
    const header = matchLayoutHeader(rawLine, labelIndex);
    if (header) {
      if (header.type === 'meta') {
        current = header.key;
        if (buckets.has(current)) throw verbatimError(`label ${current} muncul lebih dari sekali.`);
        buckets.set(current, []);
        if (header.inlineContent) buckets.get(current).push(header.inlineContent);
        continue;
      }
      const pos = header.position;
      if (pos < 0 || pos > 3) throw verbatimError('tata letak hanya memakai 4 bagian; nomor slide harus 1 sampai 4.');
      const key = String(pos);
      if (buckets.has(key)) throw verbatimError(`bagian ${SECTION_ORDER[pos]} muncul lebih dari sekali.`);
      if (pos !== slideCount) throw verbatimError('gunakan tepat 4 bagian berurutan sesuai tata letak. Bentuk hasil carousel tetap sama; label hanya dipakai untuk penempatan.');
      if (header.number !== null && header.number !== slideCount + 1) {
        throw verbatimError(`urutan nomor slide harus 1 sampai 4; ditemukan SLIDE ${header.number} pada posisi ${slideCount + 1}.`);
      }
      slideCount += 1;
      current = key;
      buckets.set(key, []);
      if (header.inlineContent) buckets.get(key).push(header.inlineContent);
      continue;
    }
    if (current === null) {
      if (!String(rawLine || '').trim()) continue;
      throw verbatimError('baris pertama harus berupa bagian pertama tata letak (mis. SLIDE 1 atau judul bagian pembuka).');
    }
    if (current === 'CAPTION' || current === 'HASHTAGS') buckets.get(current).push(rawLine);
    else buckets.get(current).push(normalizeContentLine(rawLine));
  }

  if (slideCount !== 4) {
    throw verbatimError('gunakan tepat 4 bagian berurutan sesuai tata letak. Bentuk hasil carousel tetap sama; label hanya dipakai untuk penempatan.');
  }

  const slides = SECTION_ORDER.map((section, index) => parseSlideSection(section, buckets.get(String(index)) || [], { lenient: true }));
  const caption = (buckets.get('CAPTION') || []).map(cleanInline).filter(Boolean).join(' ');
  const suppliedHashtags = parseHashtags(buckets.get('HASHTAGS') || []);
  const hashtags = suppliedHashtags.length ? suppliedHashtags : generateHashtags(slides, caption);

  return { slides, caption, hashtags };
}

function flattenPastedSlideCopy(slides) {
  return slides.slice(1).flatMap(slide => [slide.title, slide.body, ...slide.points]).filter(Boolean).join('\n');
}

async function composeVerbatim({ text, client, contentLayout = 'default' } = {}) {
  const layout = resolveContentLayout(contentLayout);
  // COPY-LOCK untuk SEMUA tata letak (default, tutorial, cerita, berita).
  // Aturan tetap: AI tidak boleh menulis ulang, meringkas, memotong, atau
  // menambah kalimat yang ditempel pengguna. Kalimat hanya DITEMPATKAN pada
  // background sesuai urutannya. Pilihan tata letak hanya mengubah gaya visual
  // (kartu/label) lewat contentLayout, bukan isi teks. Karena itu paste path
  // tidak lagi memanggil composer AI untuk Tutorial/Cerita/Berita.
  const parsed = parseStructuredText(text, layout);
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
    contentLayout: layout,
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
