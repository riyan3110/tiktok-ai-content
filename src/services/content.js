const OpenAI = require('openai');
const config = require('../config');

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    topic: { type: 'string' }, hook: { type: 'string' }, body: { type: 'string' },
    caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' }
  },
  required: ['topic', 'hook', 'body', 'caption', 'hashtags', 'cta']
};

async function generateContent(previousTopics, options = {}, client) {
  // Backward compatibility for callers that passed the client as argument two.
  if (options?.chat) { client = options; options = {}; }
  if (!client) config.validateAiConfig();
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const category = options.contentCategory || 'Iklan & UGC';
  const format = options.contentFormat || 'Tutorial langkah';
  const categoryDirections = {
    'Iklan & UGC': 'Fokus pada iklan atau UGC seperti sistem lama: konsep, produksi, atau optimasi konten promosi.',
    'Tutorial AI': 'Buat langkah nyata menggunakan tool AI; jangan berubah menjadi promosi tool.',
    'Tips bisnis': 'Berikan saran bisnis yang spesifik, realistis, dan dapat diterapkan.',
    Produktivitas: 'Berikan tips praktis yang membantu audiens bekerja atau belajar lebih efektif.',
    'Fakta unik': 'Sajikan fakta singkat, menarik, akurat, dan hindari membuat klaim yang tidak dapat dipastikan.',
    'Edukasi teknologi': 'Jelaskan konsep teknologi dengan bahasa sederhana dan contoh yang mudah dipahami.',
    Motivasi: 'Buat motivasi yang membumi, tidak berlebihan, dan memiliki tindakan kecil yang jelas.',
    'Konten kreator': 'Berikan wawasan praktis untuk proses kreatif, produksi, atau pertumbuhan kreator.'
  };
  const formatDirections = {
    'Tutorial langkah': 'Susun body sebagai langkah bernomor yang berurutan.',
    Listicle: 'Susun body sebagai poin-poin singkat; satu gagasan jelas per poin.',
    'Fakta singkat': 'Susun body sebagai beberapa fakta, dengan satu fakta utama per poin/slide.',
    'Masalah dan solusi': 'Susun body berurutan: Masalah, Penyebab, lalu Solusi.',
    'Before-after': 'Susun body dengan Kondisi awal (before), perubahan yang dilakukan, dan Hasil (after).',
    'Tips cepat': 'Susun body sebagai tips sangat pendek, praktis, dan mudah dibaca.'
  };
  const categoryDirection = categoryDirections[category] || `Buat konten yang benar-benar relevan dengan kategori khusus "${category}".`;
  let direction = `Pilih topik baru dalam kategori "${category}". ${categoryDirection}`;
  if (options.topicSource === 'manual') direction = `Gunakan topik pengguna ini sebagai dasar wajib: "${options.requestedTopic}". Anda boleh memperbaiki judul agar menarik, tetapi jangan mengubah inti topiknya.`;
  if (options.topicSource === 'trending' && options.requestedTopic) direction = `Buat konten berdasarkan topik trending ini: "${options.requestedTopic}". Pertahankan inti tren dan kaitkan secara alami dengan kategori "${category}".`;
  if (options.topicSource === 'trending' && options.trendingFallback) direction = `Karena API tren tidak tersedia, pilih topik yang kemungkinan sedang tren pada tanggal ${options.date} khusus untuk kategori "${category}".`;
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [
      { role: 'system', content: 'Anda adalah kreator TikTok Indonesia. Tulis ringkas, praktis, akurat, tanpa klaim berlebihan.' },
      { role: 'user', content: `${direction} Apa pun sumber topiknya, ikuti arahan kategori ini: ${categoryDirection} Gunakan format "${format}": ${formatDirections[format]}. Jangan memaksakan isi menjadi video iklan kecuali kategorinya Iklan & UGC atau topik manual memang meminta iklan. Hindari topik yang pernah dipakai (bandingkan tanpa membedakan kapital dan spasi): ${previousTopics.join(' | ') || 'belum ada'}. Body harus ringkas dan setiap poin harus cocok dijadikan satu slide. Hashtag masing-masing diawali #. Kembalikan hanya JSON yang mengikuti schema ini: ${JSON.stringify(schema)}` }
    ],
    response_format: { type: 'json_object' }
  });
  const output = response.choices?.[0]?.message?.content;
  if (!output) throw new Error(`Provider AI ${config.aiProvider || 'yang dipilih'} tidak mengembalikan konten`);
  try {
    const content = JSON.parse(output);
    const valid = schema.required.every((key) => Object.hasOwn(content, key)) &&
      schema.required.filter((key) => key !== 'hashtags').every((key) => typeof content[key] === 'string') &&
      Array.isArray(content.hashtags) && content.hashtags.every((value) => typeof value === 'string');
    if (!valid) throw new Error('struktur tidak sesuai schema');
    return content;
  } catch {
    throw new Error(`Provider AI ${config.aiProvider || 'yang dipilih'} mengembalikan JSON yang tidak valid atau strukturnya tidak sesuai`);
  }
}

module.exports = { generateContent };
