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
  if (!config.openaiApiKey && !client) throw new Error('OPENAI_API_KEY belum dikonfigurasi');
  const openai = client || new OpenAI({ apiKey: config.openaiApiKey });
  const response = await openai.responses.create({
    model: config.openaiModel,
    instructions: 'Anda adalah kreator TikTok Indonesia. Tulis ringkas, praktis, akurat, tanpa klaim berlebihan.',
    input: `Buat konten carousel bertema tutorial membuat video iklan menggunakan AI. Hindari topik yang pernah dipakai: ${previousTopics.join(' | ') || 'belum ada'}. Body harus berupa langkah bernomor dan muat dalam satu slide. Hashtag masing-masing diawali #.`,
    text: { format: { type: 'json_schema', name: 'tiktok_content', strict: true, schema } }
  });
  return JSON.parse(response.output_text);
}

module.exports = { generateContent };
