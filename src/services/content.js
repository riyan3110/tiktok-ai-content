const OpenAI = require('openai');
const config = require('../config');

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    focus: {
      type: 'object', additionalProperties: false,
      properties: {
        masalah: { type: 'string' }, penyebab: { type: 'string' },
        solusi: { type: 'string' }, hasil: { type: 'string' }
      },
      required: ['masalah', 'penyebab', 'solusi', 'hasil']
    },
    topic: { type: 'string' }, hook: { type: 'string' }, body: { type: 'string' },
    caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' },
    trendKeywordsUsed: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    result: { type: 'string' }, tip: { type: 'string' }
  },
  required: ['focus', 'topic', 'hook', 'body', 'caption', 'hashtags', 'cta', 'trendKeywordsUsed']
};

const words = (value) => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalizedLine = (value) => String(value || '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

function numberedValues(body, label) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*(\\d+)\\s*[:.)-]`, 'gi');
  return [...String(body || '').matchAll(pattern)].map((match) => Number(match[1]));
}

function validateContent(content, { format = 'Tutorial langkah' } = {}) {
  const errors = [];
  const strings = ['topic', 'hook', 'body', 'caption', 'cta'];
  if (!content || strings.some((key) => typeof content[key] !== 'string' || !content[key].trim()) ||
      !Array.isArray(content?.hashtags) || content.hashtags.some((tag) => typeof tag !== 'string')) {
    return ['Ada kolom wajib atau slide yang kosong.'];
  }
  if (!content.focus || ['masalah', 'penyebab', 'solusi', 'hasil'].some((key) => !String(content.focus[key] || '').trim())) {
    errors.push('Fokus utama (masalah, penyebab, solusi, hasil) belum lengkap.');
  }
  if (words(content.hook).length > 12) errors.push('Hook melebihi 12 kata.');

  const nonEmptyLines = content.body.split('\n').map((line) => line.trim()).filter(Boolean);
  const seen = new Set();
  for (const line of [content.hook, ...nonEmptyLines]) {
    const value = normalizedLine(line.replace(/^(?:solusi|langkah|penyebab)\s*\d*\s*[:.)-]?\s*/i, ''));
    if (value.length >= 12 && seen.has(value)) errors.push('Isi mengandung poin yang berulang.');
    seen.add(value);
  }

  for (const label of ['solusi', 'langkah']) {
    const values = numberedValues(content.body, label);
    values.forEach((value, index) => { if (value !== index + 1) errors.push(`Urutan ${label} harus dimulai dari 1 dan berurutan.`); });
  }

  if (format === 'Masalah dan solusi') {
    const required = [/^MASALAH\s*:/im, /^PENYEBAB\s*:/im, /^SOLUSI 1\s*:/im, /^SOLUSI 2\s*:/im, /^LANGKAH PERTAMA\s*:/im, /^HASIL YANG DIHARAPKAN\s*:/im];
    if (required.some((pattern) => !pattern.test(content.body))) errors.push('Struktur Masalah dan solusi belum lengkap atau urutan solusi tidak dimulai dari 1.');
    const sections = content.body.split(/(?=^(?:MASALAH|PENYEBAB|SOLUSI [12]|LANGKAH PERTAMA|HASIL YANG DIHARAPKAN)\s*:)/gim);
    const slideWords = [sections.slice(0, 2), sections.slice(2, 4), [...sections.slice(4), content.cta]].map((parts) => words(parts.join(' ')).length);
    if (slideWords.some((count) => count > 35)) errors.push('Ada slide yang melebihi 35 kata.');
  } else if (nonEmptyLines.some((line) => words(line).length > 35)) errors.push('Ada slide yang melebihi 35 kata.');

  if (/tingkatkan strategi bisnis|gunakan pemasaran yang tepat|optimalkan penjualan/i.test(content.body)) {
    errors.push('Solusi masih generik dan belum berupa tindakan konkret.');
  }
  return [...new Set(errors)];
}

function parseOutput(response) {
  const output = response.choices?.[0]?.message?.content;
  if (!output) throw new Error(`Provider AI ${config.aiProvider || 'yang dipilih'} tidak mengembalikan konten`);
  try { return JSON.parse(output); } catch { throw new Error(`Provider AI ${config.aiProvider || 'yang dipilih'} mengembalikan JSON yang tidak valid atau strukturnya tidak sesuai`); }
}

async function generateContent(previousTopics, options = {}, client) {
  if (options?.chat) { client = options; options = {}; }
  if (!client) config.validateAiConfig();
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const category = options.contentCategory || 'Iklan & UGC';
  const format = options.contentFormat || 'Tutorial langkah';
  const categoryDirections = {
    'Tutorial AI': 'Buat langkah nyata menggunakan tool AI.', 'Tips bisnis': 'Berikan tindakan bisnis spesifik dan realistis.',
    Produktivitas: 'Berikan tindakan kecil yang praktis.', 'Fakta unik': 'Gunakan fakta akurat tanpa klaim yang tidak pasti.',
    'Edukasi teknologi': 'Gunakan bahasa sederhana dan satu contoh yang mudah dipahami.', Motivasi: 'Gunakan motivasi yang membumi.',
    'Konten kreator': 'Berikan tindakan praktis untuk proses kreator.', 'Iklan & UGC': 'Fokus pada konsep atau produksi konten promosi.'
  };
  const source = options.topicSource === 'manual' ? `Gunakan topik pengguna: "${options.requestedTopic}" dan jangan mengubah inti topiknya.`
    : options.topicSource === 'trending' && options.requestedTopic ? `Gunakan topik tren: "${options.requestedTopic}".`
      : `Pilih topik baru dalam kategori "${category}".`;
  const specialStructure = format === 'Masalah dan solusi'
    ? 'Body wajib persis berurutan dengan label: MASALAH:, PENYEBAB: (maksimal dua penyebab), SOLUSI 1:, SOLUSI 2:, LANGKAH PERTAMA:, HASIL YANG DIHARAPKAN:. Ini akan menjadi slide 2, 3, dan 4; CTA singkat disimpan di kolom cta.'
    : format === 'Tutorial langkah'
      ? 'Gunakan default 3 slide: hook + hasil; satu slide LANGKAH PRAKTIS berisi 3–5 langkah bernomor dengan total maksimal 45 kata; lalu hasil akhir + tip relevan + CTA. Hanya pecah menjadi 4 slide untuk 6–7 langkah atau isi sedang, dan maksimal 5 untuk isi panjang. Gabungkan langkah terkait; jangan buat slide untuk satu kalimat pendek. Isi kolom result dan tip secara spesifik.'
      : 'Body berisi poin slide yang berurutan dan gabungkan poin yang saling berkaitan.';
  const categorizedKeywords = (options.trendReference?.keyword_categories || options.trendReference?.keywords?.map(keyword => ({ keyword, category: 'UMUM' })) || []).map(({ category, keyword }) => `[${category}] ${keyword}`).join(' | ');
  const trendDirection = options.trendReference ? `Referensi tren aktif memiliki tiga daftar terpisah. KEYWORD/HASHTAG BERKATEGORI: ${categorizedKeywords || 'tidak ada'}; gunakan hanya untuk memilih istilah dan konteks yang relevan. Sebelum menulis, baca topik dan kategori konten, lalu pilih nol sampai maksimal 3 keyword yang paling relevan. Prioritaskan kategori konten pengguna jika topik ambigu. Abaikan seluruh keyword dari kategori yang tidak sesuai dan keyword yang tidak berkaitan langsung; jangan mencampur lintas kategori hanya karena sedang tren dan jangan memaksakan tren bila tidak ada yang relevan. Gunakan ejaan keyword persis pada trendKeywordsUsed. Jangan mencampurkan ketiganya sebagai satu daftar. GAYA HOOK: ${(options.trendReference.trend_hooks || []).join(' | ') || 'tidak ada'}; gunakan hanya sebagai referensi kalimat pembuka, jangan menyalin hook mentah terus-menerus dan buat variasi yang natural. POLA KONTEN: ${(options.trendReference.trend_content_patterns || []).join(' | ') || 'tidak ada'}; gunakan hanya sebagai referensi struktur penyampaian. Jangan ubah inti topik atau membuat klaim tren tanpa dasar catatan: "${options.trendReference.notes || ''}".` : 'Tidak ada referensi tren aktif; isi trendKeywordsUsed dengan array kosong.';
  const prompt = `${source} ${trendDirection} Pertahankan inti topik dan kategori "${category}". ${categoryDirections[category] || 'Pastikan isi relevan dengan kategori khusus ini.'} Jangan memaksakan isi menjadi video iklan. Format "${format}". Sebelum menulis, tetapkan tepat satu fokus pada objek focus: satu masalah utama, penyebab utama, solusi utama, dan hasil yang diharapkan. Jangan campur masalah lain. ${specialStructure} Tentukan 3 slide untuk isi sangat singkat, 4 untuk isi sedang, dan maksimal 5 untuk isi panjang; jangan memakai 5 jika cukup 3–4. Isi utama tiap slide minimal 15 kata (kecuali hook), dan gabungkan bagian di bawah 20 kata dengan slide sebelah. Maksimal 45 kata per slide. Hook spesifik, maksimal 12 kata. Gunakan kalimat langsung, mudah dipahami, tidak berulang, tanpa klaim berlebihan. Semua saran harus berupa tindakan konkret dan solusi harus menjawab masalah. Caption hanya merangkum slide tanpa klaim baru. Nomor selalu mulai 1 dan berurutan. Hindari topik lama: ${previousTopics.join(' | ') || 'belum ada'}. Hashtag diawali #. Kembalikan hanya JSON sesuai schema: ${JSON.stringify(schema)}`;
  const messages = [
    { role: 'system', content: 'Anda editor carousel TikTok Indonesia yang cermat. Utamakan satu fokus dan langkah konkret.' },
    { role: 'user', content: prompt }
  ];
  let content = parseOutput(await openai.chat.completions.create({ model: config.aiModel, messages, response_format: { type: 'json_object' } }));
  let errors = validateContent(content, { format });
  if (errors.length) {
    content = parseOutput(await openai.chat.completions.create({
      model: config.aiModel,
      messages: [...messages, { role: 'assistant', content: JSON.stringify(content) }, { role: 'user', content: `Hasil belum lolos validasi: ${errors.join(' ')} Perbaiki satu kali. Pastikan solusi benar-benar menjawab masalah dan caption tidak menambah klaim. Kembalikan JSON lengkap saja.` }],
      response_format: { type: 'json_object' }
    }));
    errors = validateContent(content, { format });
  }
  if (errors.length) throw Object.assign(new Error(`Konten AI tidak lolos validasi: ${errors.join(' ')}`), { status: 422 });
  return content;
}

async function generateAngles(mainTopic, count, options = {}, client) {
  if (!client) config.validateAiConfig();
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [{ role: 'system', content: 'Anda adalah perencana konten TikTok Indonesia.' }, { role: 'user', content: `Buat tepat ${count} sudut pembahasan yang jelas berbeda untuk topik utama "${mainTopic}", kategori "${options.category}", format "${options.format}". Pastikan judul, hook, bahasan, caption, dan CTA nantinya dapat berbeda serta kemiripan isi di bawah 60%. Kembalikan hanya JSON {"angles":["..."]}.` }],
    response_format: { type: 'json_object' }
  });
  const parsed = parseOutput(response);
  return parsed.angles;
}

module.exports = { generateContent, generateAngles, validateContent, numberedValues };
