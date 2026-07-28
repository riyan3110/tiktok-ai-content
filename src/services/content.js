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

async function generateContent(previousTopics, client) {
  if (!client) config.validateAiConfig();
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [
      { role: 'system', content: 'Anda adalah kreator TikTok Indonesia. Tulis ringkas, praktis, akurat, tanpa klaim berlebihan.' },
      { role: 'user', content: `Buat konten carousel bertema tutorial membuat video iklan menggunakan AI. Hindari topik yang pernah dipakai: ${previousTopics.join(' | ') || 'belum ada'}. Body harus berupa langkah bernomor dan muat dalam satu slide. Hashtag masing-masing diawali #. Kembalikan hanya JSON yang mengikuti schema ini: ${JSON.stringify(schema)}` }
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
