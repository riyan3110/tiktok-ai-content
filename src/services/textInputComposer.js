const OpenAI = require('openai');
const config = require('../config');

const MIN_TEXT_CHARS = 80;
const MAX_TEXT_CHARS = 20000;
const MAX_REPAIRS = 2;

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

function validateResult(result, sourceText) {
  const errors = [];
  const slides = normalizeSlides(result?.slides);
  if (!clean(result?.topic)) errors.push('topic wajib diisi');
  if (!clean(result?.caption)) errors.push('caption wajib diisi');
  if (slides.length < 4 || slides.length > 5) errors.push(`jumlah slide harus 4 atau 5, sekarang ${slides.length}`);

  const seen = new Set();
  slides.forEach((slide, index) => {
    const number = index + 1;
    if (!slide.title) errors.push(`slide ${number}: judul kosong`);
    if (!slide.body) errors.push(`slide ${number}: body kosong`);
    if (words(slide.title).length > 10) errors.push(`slide ${number}: judul terlalu panjang`);
    const fields = [slide.title, slide.body, ...slide.points].map(normalized).filter(Boolean);
    for (const field of fields) {
      if (seen.has(field)) errors.push(`slide ${number}: ada kalimat yang diulang persis`);
      seen.add(field);
    }
    if (normalized(slide.title) === normalized(slide.body)) errors.push(`slide ${number}: judul dan body tidak boleh sama`);
  });

  if (slides.length >= 4) {
    const first = slides[0];
    const last = slides.at(-1);
    const firstWords = words(first.body).length;
    if (first.points.length) errors.push('slide 1 harus tanpa bullet');
    if (firstWords < 24 || firstWords > 42) errors.push(`slide 1 harus cukup padat, target 25–40 kata; sekarang ${firstWords} kata`);

    for (const index of [1, 2]) {
      const slide = slides[index];
      if (!slide) continue;
      if (slide.points.length < 2 || slide.points.length > 3) errors.push(`slide ${index + 1} harus memiliki 2–3 bullet`);
      const bodyWords = words(slide.body).length;
      if (bodyWords < 8 || bodyWords > 26) errors.push(`slide ${index + 1}: body target 8–26 kata`);
      slide.points.forEach((point, pointIndex) => {
        const count = words(point).length;
        if (count < 2 || count > 11) errors.push(`slide ${index + 1} bullet ${pointIndex + 1}: target 2–11 kata`);
      });
    }

    if (slides.length === 5) {
      const fourth = slides[3];
      if (fourth.points.length) errors.push('slide 4 pada carousel 5 slide tidak perlu bullet');
      const count = words(fourth.body).length;
      if (count < 12 || count > 32) errors.push(`slide 4: body target 12–32 kata; sekarang ${count} kata`);
    }

    if (last.points.length) errors.push('slide terakhir harus tanpa bullet');
    const lastWords = words(last.body).length;
    if (lastWords < 16 || lastWords > 38) errors.push(`slide terakhir harus berupa penutup yang cukup isi, target 18–35 kata; sekarang ${lastWords} kata`);
  }

  const extraNumbers = validateGroundedNumbers({ ...result, slides }, sourceText);
  if (extraNumbers.length) errors.push(`angka baru yang tidak ada di teks input: ${extraNumbers.join(', ')}`);

  return { errors: [...new Set(errors)], slides };
}

function promptFor(text) {
  return `MODE: GENERATE DARI TEKS — TRANSFORM ONLY.\n\nTEKS INPUT PENGGUNA:\n<<<TEXT_INPUT>>>\n${text}\n<<<END_TEXT_INPUT>>>\n\nTUGAS:\nSusun teks input menjadi carousel AI Ads Lab berbahasa Indonesia yang rapi. Anda BUKAN peneliti dan BUKAN mesin pencari. Jangan browsing, jangan memakai pengetahuan internal, dan jangan menambahkan fakta dari luar teks input. Anda hanya boleh meringkas, memparafrasekan, mengurutkan, dan memperjelas informasi yang memang tertulis pada TEXT_INPUT.\n\nSTRUKTUR WAJIB:\n- Total 4 atau 5 slide. Gunakan 5 hanya jika teks memang memiliki informasi berbeda yang cukup; jangan membuat fakta tambahan demi slide ke-5.\n- Slide 1 = HOOK. Judul kuat tetapi tidak clickbait berlebihan. Body sekitar 25–40 kata, 2–3 kalimat pendek, memberi konteks yang cukup. points wajib [].\n- Slide 2 = FAKTA UTAMA. Body singkat + 2–3 bullet pada points. Setiap bullet membawa informasi berbeda.\n- Slide 3 = DETAIL / HAL PENTING. Body singkat + 2–3 bullet pada points. Jangan mengulang slide 2.\n- Jika ada slide 4 sebelum penutup (carousel 5 slide), pakai untuk konteks/detail tambahan yang benar-benar ada di teks. Tanpa bullet.\n- Slide terakhir = PENUTUP atau KESIMPULAN. Body sekitar 18–35 kata. points wajib []. Jangan sekadar mengulang hook.\n\nATURAN KERAS:\n- Tidak boleh menambah fakta, angka, tanggal, nama, lokasi, fitur, manfaat, sebab-akibat, opini, prediksi, atau status peluncuran yang tidak ada di teks input.\n- Nama brand, produk, model, angka, persentase, tanggal, dan tingkat kepastian harus dipertahankan maknanya.\n- Judul dan body harus berbeda. Semua judul antar-slide harus berbeda.\n- Jangan mengulang satu fakta dengan susunan kata berbeda pada beberapa slide.\n- Bullet jangan diawali simbol • karena renderer akan menambah tanda bullet sendiri.\n- Gunakan Bahasa Indonesia natural. Istilah resmi/brand boleh dipertahankan.\n- Caption 45–90 kata, hanya merangkum isi carousel dari teks input dan tidak menambah klaim baru.\n- Hashtag 3–5 item dan hanya berdasarkan objek/topik yang memang ada di teks input.\n\nKembalikan HANYA JSON dengan bentuk:\n{"topic":"judul/topik singkat","caption":"...","hashtags":["#..."],"slides":[{"section":"HOOK","title":"...","body":"...","points":[]},{"section":"FAKTA UTAMA","title":"...","body":"...","points":["...","..."]},{"section":"DETAIL","title":"...","body":"...","points":["...","..."]},{"section":"PENUTUP","title":"...","body":"...","points":[]}]}\nJika 5 slide, sisipkan satu slide KONTEKS sebelum PENUTUP.`;
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
  if (!client) config.validateAiConfig();
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const messages = [
    { role: 'system', content: 'Anda editor layout carousel Indonesia dalam mode transform-only. Fakta hanya boleh berasal dari teks pengguna yang diberikan.' },
    { role: 'user', content: promptFor(sourceText) }
  ];

  let parsed = parseOutput(await openai.chat.completions.create({
    model: config.aiModel,
    messages,
    response_format: { type: 'json_object' }
  }));

  for (let repair = 0; repair <= MAX_REPAIRS; repair += 1) {
    const checked = validateResult(parsed, sourceText);
    if (!checked.errors.length) return buildContent(parsed, checked.slides);
    if (repair === MAX_REPAIRS) {
      throw Object.assign(new Error(`Generate dari Teks belum lolos pengecekan: ${checked.errors[0]}`), {
        status: 422,
        validationErrors: checked.errors
      });
    }
    parsed = parseOutput(await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        ...messages,
        { role: 'assistant', content: JSON.stringify(parsed) },
        { role: 'user', content: `Perbaiki JSON tadi TANPA menambah informasi dari luar TEXT_INPUT. Masalah yang harus diperbaiki: ${checked.errors.join('; ')}. Pertahankan fakta, nama, angka, dan tingkat kepastian dari teks input. Pastikan slide 1 cukup padat tanpa bullet, slide 2–3 punya 2–3 bullet, slide terakhir berupa penutup tanpa bullet, dan total tetap 4–5 slide. Kembalikan JSON lengkap saja.` }
      ],
      response_format: { type: 'json_object' }
    }));
  }
  throw Object.assign(new Error('Generate dari Teks gagal disusun.'), { status: 422 });
}

module.exports = {
  compose,
  validateInputText,
  validateResult,
  normalizeSlides,
  validateGroundedNumbers,
  buildContent,
  MIN_TEXT_CHARS,
  MAX_TEXT_CHARS
};
