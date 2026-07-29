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
  let direction = 'Pilih topik baru bertema tutorial membuat video iklan menggunakan AI.';
  if (options.topicSource === 'manual') direction = `Gunakan topik pengguna ini sebagai dasar wajib: "${options.requestedTopic}". Anda boleh memperbaiki judul agar menarik, tetapi jangan mengubah inti topiknya.`;
  if (options.topicSource === 'trending' && options.requestedTopic) direction = `Buat konten berdasarkan topik trending ini: "${options.requestedTopic}". Pertahankan inti tren dan kaitkan dengan niche kreator digital.`;
  if (options.topicSource === 'trending' && options.trendingFallback) direction = `Karena API tren tidak tersedia, pilih topik yang kemungkinan sedang tren pada tanggal ${options.date}, dalam niche tutorial AI, video iklan, UGC, editing, konten kreator, TikTok, Canva, atau tools AI.`;
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [
      { role: 'system', content: 'Anda adalah kreator TikTok Indonesia. Tulis ringkas, praktis, akurat, tanpa klaim berlebihan.' },
      { role: 'user', content: `${direction} Hindari topik yang pernah dipakai (bandingkan tanpa membedakan kapital dan spasi): ${previousTopics.join(' | ') || 'belum ada'}. Body harus berupa langkah bernomor dan muat dalam satu slide. Hashtag masing-masing diawali #. Kembalikan hanya JSON yang mengikuti schema ini: ${JSON.stringify(schema)}` }
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
