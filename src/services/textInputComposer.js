const OpenAI = require('openai');
const config = require('../config');

const MIN_TEXT_CHARS = 80;
const MAX_TEXT_CHARS = 20000;
const MAX_REPAIRS = 2;
const FIVE_SLIDE_MIN_WORDS = 220;

const COPY_FILLER_WORDS = new Set([
  'yang', 'dan', 'atau', 'dari', 'untuk', 'dengan', 'tentang', 'cara',
  'adalah', 'pada', 'itu', 'ini', 'sebagai', 'terjadi', 'penting',
  'slide', 'fakta', 'utama', 'detail', 'penutup', 'kesimpulan'
]);

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const words = value => clean(value).split(/\s+/).filter(Boolean);
const normalized = value => clean(value)
  .toLocaleLowerCase('id-ID')
  .replace(/[^a-z0-9%.,\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function numbers(value) {
  return [...new Set(String(value || '').match(/\b\d+(?:[.,]\d+)*(?:%|gb|tb|mb|miliar|juta|ribu)?\b/gi) || [])]
    .map(item => item.toLocaleLowerCase('id-ID'));
}

function stripPoint(value) {
  return clean(value).replace(/^(?:[•*\-–—]|\d+[.)])\s*/, '').trim();
}

function normalizeSlides(input) {
  if (!Array.isArray(input)) return [];
  return input.map((slide = {}) => ({
    section: clean(slide.section),
    title: clean(slide.title),
    body: clean(slide.body),
    points: Array.isArray(slide.points) ? slide.points.map(stripPoint).filter(Boolean).slice(0, 3) : []
  })).filter(slide => slide.title || slide.body || slide.points.length);
}

function meaningfulTokens(value) {
  return normalized(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => (token.length > 2 || token === 'ai') && !COPY_FILLER_WORDS.has(token));
}

function duplicateSlideCopy(slide = {}) {
  const fields = [slide.title, slide.body, ...(slide.points || [])]
    .map(value => ({ raw: clean(value), tokens: [...new Set(meaningfulTokens(value))] }))
    .filter(field => field.tokens.length);

  for (let left = 0; left < fields.length; left += 1) {
    for (let right = left + 1; right < fields.length; right += 1) {
      const a = fields[left].tokens;
      const b = fields[right].tokens;
      const shared = a.filter(token => b.includes(token));
      if (
        normalized(fields[left].raw) === normalized(fields[right].raw) ||
        (shared.length >= 2 && shared.length / Math.min(a.length, b.length) >= 0.75)
      ) return true;
    }
  }
  return false;
}

function targetSlideCount(sourceText) {
  return words(sourceText).length >= FIVE_SLIDE_MIN_WORDS ? 5 : 4;
}

function shapeSlides(input, targetCount) {
  let slides = normalizeSlides(input);
  if (slides.length > targetCount) {
    const first = slides[0];
    const last = slides.at(-1);
    slides = [first, ...slides.slice(1, -1).slice(0, targetCount - 2), last];
  }

  slides = slides.map((slide, index) => {
    const next = { ...slide, points: [...slide.points] };
    if (index === 0 || index === slides.length - 1) next.points = [];
    if (targetCount === 5 && index === 3) next.points = [];
    return next;
  });
  return slides;
}

function shapeParsed(parsed, targetCount) {
  return { ...(parsed || {}), slides: shapeSlides(parsed?.slides, targetCount) };
}

function parseOutput(response) {
  const output = response?.choices?.[0]?.message?.content;
  if (!output) throw new Error(`Provider AI ${config.aiProvider || 'yang dipilih'} tidak mengembalikan konten`);
  try { return JSON.parse(output); }
  catch {
    console.error('[Text input composer][JSON invalid]', output);
    throw new Error(`Provider AI ${config.aiProvider || 'yang dipilih'} mengembalikan JSON yang tidak valid`);
  }
}

function validateInputText(text) {
  const value = String(text || '').trim();
  if (value.length < MIN_TEXT_CHARS) {
    throw Object.assign(new Error('Teks terlalu pendek. Tempel ringkasan berita yang lebih lengkap agar bisa disusun menjadi 4–5 slide tanpa mengarang fakta.'), { status: 422 });
  }
  if (value.length > MAX_TEXT_CHARS) {
    throw Object.assign(new Error(`Teks terlalu panjang. Maksimal ${MAX_TEXT_CHARS.toLocaleString('id-ID')} karakter.`), { status: 422 });
  }
  return value;
}

function validateGroundedNumbers(result, sourceText) {
  const sourceNumbers = new Set(numbers(sourceText));
  const visible = [
    result?.topic,
    result?.caption,
    ...(result?.slides || []).flatMap(slide => [slide?.title, slide?.body, ...(slide?.points || [])])
  ].join(' ');
  return numbers(visible).filter(value => !sourceNumbers.has(value));
}

function validateResult(result, sourceText, requestedSlideCount = targetSlideCount(sourceText)) {
  const errors = [];
  const slides = shapeSlides(result?.slides, requestedSlideCount);
  if (!clean(result?.topic)) errors.push('topic wajib diisi');
  if (!clean(result?.caption)) errors.push('caption wajib diisi');
  if (slides.length !== requestedSlideCount) {
    errors.push(`jumlah slide harus tepat ${requestedSlideCount}, sekarang ${slides.length}`);
  }

  const seen = new Set();
  slides.forEach((slide, index) => {
    const number = index + 1;
    if (!slide.title) errors.push(`slide ${number}: judul kosong`);
    if (!slide.body) errors.push(`slide ${number}: body kosong`);
    if (words(slide.title).length > 10) errors.push(`slide ${number}: judul maksimal 10 kata`);

    const fields = [slide.title, slide.body, ...slide.points].map(normalized).filter(Boolean);
    for (const field of fields) {
      if (seen.has(field)) errors.push(`slide ${number}: ada kalimat yang diulang persis`);
      seen.add(field);
    }

    if (normalized(slide.title) === normalized(slide.body)) {
      errors.push(`slide ${number}: judul dan body tidak boleh sama`);
    }
    if (duplicateSlideCopy(slide)) {
      errors.push(`slide ${number}: judul, body, dan bullet harus membawa informasi yang berbeda`);
    }
  });

  if (slides.length === requestedSlideCount) {
    const first = slides[0];
    const last = slides.at(-1);
    const firstWords = words(first.body).length;
    if (first.points.length) errors.push('slide 1 harus tanpa bullet');
    if (firstWords < 16 || firstWords > 18) {
      errors.push(`slide 1 harus padat tetapi tetap muat, target 16–18 kata; sekarang ${firstWords} kata`);
    }

    for (const index of [1, 2]) {
      const slide = slides[index];
      if (!slide) continue;
      if (slide.points.length < 2 || slide.points.length > 3) {
        errors.push(`slide ${index + 1} harus memiliki 2–3 bullet`);
      }
      const bodyWords = words(slide.body).length;
      if (bodyWords < 8 || bodyWords > 14) {
        errors.push(`slide ${index + 1}: body target 8–14 kata`);
      }
      slide.points.forEach((point, pointIndex) => {
        const count = words(point).length;
        if (count < 3 || count > 7) {
          errors.push(`slide ${index + 1} bullet ${pointIndex + 1}: target 3–7 kata`);
        }
      });
    }

    if (requestedSlideCount === 5) {
      const fourth = slides[3];
      if (fourth.points.length) errors.push('slide 4 pada carousel 5 slide harus tanpa bullet');
      const count = words(fourth.body).length;
      if (count < 10 || count > 16) {
        errors.push(`slide 4: body target 10–16 kata; sekarang ${count} kata`);
      }
    }

    if (last.points.length) errors.push('slide terakhir harus tanpa bullet');
    const lastWords = words(last.body).length;
    if (lastWords < 14 || lastWords > 18) {
      errors.push(`slide terakhir harus berupa penutup yang cukup isi, target 14–18 kata; sekarang ${lastWords} kata`);
    }
  }

  const extraNumbers = validateGroundedNumbers({ ...result, slides }, sourceText);
  if (extraNumbers.length) errors.push(`angka baru yang tidak ada di teks input: ${extraNumbers.join(', ')}`);

  return { errors: [...new Set(errors)], slides };
}

function promptFor(text, requestedSlideCount) {
  const optionalContext = requestedSlideCount === 5
    ? '- Slide 4 = KONTEKS / DETAIL TAMBAHAN. Body 10–16 kata dan points wajib [].\n'
    : '';

  return `MODE: GENERATE DARI TEKS — TRANSFORM ONLY.\n\nTEKS INPUT PENGGUNA:\n<<<TEXT_INPUT>>>\n${text}\n<<<END_TEXT_INPUT>>>\n\nTUGAS:\nSusun teks input menjadi carousel AI Ads Lab berbahasa Indonesia yang rapi. Anda BUKAN peneliti dan BUKAN mesin pencari. Jangan browsing, jangan memakai pengetahuan internal, dan jangan menambahkan fakta dari luar teks input. Anda hanya boleh meringkas, memparafrasekan, mengurutkan, dan memperjelas informasi yang memang tertulis pada TEXT_INPUT.\n\nSTRUKTUR WAJIB:\n- Total HARUS tepat ${requestedSlideCount} slide. Jangan membuat slide tambahan.\n- Slide 1 = HOOK. Judul kuat tetapi tidak clickbait berlebihan. Body 16–18 kata, tetap cukup padat dan memberi konteks. points wajib [].\n- Slide 2 = FAKTA UTAMA. Body 8–14 kata + 2–3 bullet. Setiap bullet 3–7 kata dan membawa informasi berbeda.\n- Slide 3 = DETAIL / HAL PENTING. Body 8–14 kata + 2–3 bullet. Setiap bullet 3–7 kata. Jangan mengulang slide 2.\n${optionalContext}- Slide terakhir = PENUTUP / KESIMPULAN. Body 14–18 kata. points wajib []. Jangan sekadar mengulang hook.\n\nATURAN KERAS:\n- Tidak boleh menambah fakta, angka, tanggal, nama, lokasi, fitur, manfaat, sebab-akibat, opini, prediksi, atau status peluncuran yang tidak ada di teks input.\n- Nama brand, produk, model, angka, persentase, tanggal, dan tingkat kepastian harus dipertahankan maknanya.\n- Judul maksimal 10 kata.\n- Judul adalah label/angle slide, bukan salinan body. Body harus menambahkan konteks baru dan tidak mengulang ide judul.\n- Bullet tidak boleh mengulang body atau bullet lain pada slide yang sama.\n- Semua judul antar-slide harus berbeda.\n- Jangan mengulang satu fakta dengan susunan kata berbeda pada slide 2 dan 3. Penutup boleh merangkum, tetapi jangan menyalin kalimat sebelumnya.\n- Bullet jangan diawali simbol • karena renderer akan menambah tanda bullet sendiri.\n- Gunakan Bahasa Indonesia natural. Istilah resmi/brand boleh dipertahankan.\n- Caption 45–90 kata, hanya merangkum isi carousel dari teks input dan tidak menambah klaim baru.\n- Hashtag 3–5 item dan hanya berdasarkan objek/topik yang memang ada di teks input.\n\nKembalikan HANYA JSON dengan bentuk:\n{\"topic\":\"judul/topik singkat\",\"caption\":\"...\",\"hashtags\":[\"#...\"],\"slides\":[{\"section\":\"HOOK\",\"title\":\"...\",\"body\":\"...\",\"points\":[]},{\"section\":\"FAKTA UTAMA\",\"title\":\"...\",\"body\":\"...\",\"points\":[\"...\",\"...\"]},{\"section\":\"DETAIL\",\"title\":\"...\",\"body\":\"...\",\"points\":[\"...\",\"...\"]}${requestedSlideCount === 5 ? ',{\"section\":\"KONTEKS\",\"title\":\"...\",\"body\":\"...\",\"points\":[]}' : ''},{\"section\":\"PENUTUP\",\"title\":\"...\",\"body\":\"...\",\"points\":[]}]} `;
}

function buildContent(parsed, slides) {
  const first = slides[0];
  const last = slides.at(-1);
  const middle = slides.slice(1, -1);
  return {
    focus: {
      masalah: first?.body || parsed.topic,
      penyebab: middle[0]?.body || first?.body || parsed.topic,
      solusi: middle[1]?.body || middle[0]?.body || parsed.topic,
      hasil: last?.body || parsed.topic
    },
    topic: clean(parsed.topic),
    hook: clean(first?.title || parsed.topic),
    body: middle.map(slide => [slide.body, ...slide.points].filter(Boolean).join(' • ')).join('\n'),
    caption: clean(parsed.caption),
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map(clean).filter(Boolean).slice(0, 5) : [],
    cta: clean(last?.title || 'Kesimpulan'),
    trendKeywordsUsed: [],
    content_angle: clean(parsed.topic),
    primary_tool: 'teks pengguna',
    hook_pattern: 'text-input-hook',
    verificationStatus: 'text_input_only',
    unsupportedClaims: [],
    slides
  };
}

async function compose({ text, client } = {}) {
  const sourceText = validateInputText(text);
  const requestedSlideCount = targetSlideCount(sourceText);
  if (!client) config.validateAiConfig();
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const messages = [
    { role: 'system', content: 'Anda editor layout carousel Indonesia dalam mode transform-only. Fakta hanya boleh berasal dari teks pengguna yang diberikan.' },
    { role: 'user', content: promptFor(sourceText, requestedSlideCount) }
  ];

  let parsed = shapeParsed(parseOutput(await openai.chat.completions.create({
    model: config.aiModel,
    messages,
    response_format: { type: 'json_object' }
  })), requestedSlideCount);

  for (let repair = 0; repair <= MAX_REPAIRS; repair += 1) {
    const checked = validateResult(parsed, sourceText, requestedSlideCount);
    if (!checked.errors.length) return buildContent(parsed, checked.slides);
    if (repair === MAX_REPAIRS) {
      throw Object.assign(new Error(`Generate dari Teks belum lolos pengecekan: ${checked.errors[0]}`), {
        status: 422,
        validationErrors: checked.errors
      });
    }
    parsed = shapeParsed(parseOutput(await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        ...messages,
        { role: 'assistant', content: JSON.stringify(parsed) },
        {
          role: 'user',
          content: `Perbaiki JSON tadi TANPA menambah informasi dari luar TEXT_INPUT. Masalah: ${checked.errors.join('; ')}. Total harus tepat ${requestedSlideCount} slide. Pastikan slide 1 body 16–18 kata tanpa bullet; slide 2–3 body 8–14 kata dengan 2–3 bullet berisi 3–7 kata; ${requestedSlideCount === 5 ? 'slide 4 body 10–16 kata tanpa bullet; ' : ''}slide terakhir body 14–18 kata tanpa bullet. Judul, body, dan bullet pada slide yang sama harus membawa informasi berbeda. Jangan menyalin satu fakta yang sama ke slide 2 dan 3. Pertahankan fakta, nama, angka, dan tingkat kepastian dari teks input. Kembalikan JSON lengkap saja.`
        }
      ],
      response_format: { type: 'json_object' }
    })), requestedSlideCount);
  }

  throw Object.assign(new Error('Generate dari Teks gagal disusun.'), { status: 422 });
}

module.exports = {
  compose,
  validateInputText,
  validateResult,
  normalizeSlides,
  validateGroundedNumbers,
  duplicateSlideCopy,
  targetSlideCount,
  shapeSlides,
  buildContent,
  MIN_TEXT_CHARS,
  MAX_TEXT_CHARS,
  FIVE_SLIDE_MIN_WORDS
};
