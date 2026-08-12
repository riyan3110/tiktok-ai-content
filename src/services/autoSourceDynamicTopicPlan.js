const OpenAI = require('openai');
const config = require('../config');

// TANPA URL / AUTO SOURCE ONLY.
// Build a fresh topic plan from the exact user input on every generation.
// No product/company/topic catalog is required, so newly trending names work
// without adding aliases to the codebase.

const GLUE_WORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','dalam','ini','itu','adalah','merupakan','sebagai','oleh','ke','di','terhadap',
  'baru','terbaru','update','berita','news','latest','new','info','fakta','singkat','the','and','or','from','for','with','about','on','in','to','of'
]);
const MARKET_RE = /\b(?:saham|stock|stocks|share|shares|harga\s+saham|market|pasar|trading|perdagangan|investor|ticker|nasdaq|nyse)\b/i;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniq(values = [], limit = 8) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const value = clean(raw);
    const key = normalize(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function rawTokens(topic = '') {
  return clean(topic).match(/[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*/g) || [];
}

function fallbackPlan(topic = '') {
  const cleanTopic = clean(topic);
  const tokens = rawTokens(cleanTopic);
  const contentTerms = tokens.filter(token => {
    const key = normalize(token);
    return key && !GLUE_WORDS.has(key) && (key.length > 2 || /\d/.test(key) || /^[A-Z0-9]{2,}$/.test(token));
  });

  const named = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) named.push(buffer.join(' '));
    buffer = [];
  };
  for (const token of tokens) {
    const namedLike = /[a-z][A-Z]/.test(token)
      || /^[A-Z0-9]{2,}$/.test(token)
      || /^[A-Z][A-Za-z0-9.-]{2,}$/.test(token)
      || /\d/.test(token);
    if (namedLike) buffer.push(token);
    else flush();
  }
  flush();

  return {
    rawTopic: cleanTopic,
    canonicalTopic: cleanTopic,
    subjects: uniq(named.length ? named : contentTerms.slice(0, 2), 4),
    eventTerms: uniq(contentTerms, 8),
    searchQueries: uniq([
      cleanTopic,
      `${cleanTopic} terbaru`,
      `${cleanTopic} latest`
    ], 5),
    marketIntent: MARKET_RE.test(cleanTopic),
    relation: /\b(?:vs\.?|versus|dibanding(?:kan)?|perbandingan)\b/i.test(cleanTopic) ? 'comparison'
      : /\b(?:dan|&)\b/i.test(cleanTopic) && named.length >= 2 ? 'multi'
        : 'single',
    planner: 'fallback'
  };
}

function normalizePlan(raw, topic) {
  const fallback = fallbackPlan(topic);
  const subjects = uniq(Array.isArray(raw?.subjects) ? raw.subjects : fallback.subjects, 4);
  const eventTerms = uniq(Array.isArray(raw?.eventTerms) ? raw.eventTerms : fallback.eventTerms, 10);
  const searchQueries = uniq([
    topic,
    ...(Array.isArray(raw?.searchQueries) ? raw.searchQueries : []),
    ...fallback.searchQueries
  ], 7);

  return {
    rawTopic: clean(topic),
    canonicalTopic: clean(raw?.canonicalTopic || topic),
    subjects: subjects.length ? subjects : fallback.subjects,
    eventTerms: eventTerms.length ? eventTerms : fallback.eventTerms,
    searchQueries,
    marketIntent: typeof raw?.marketIntent === 'boolean' ? raw.marketIntent : fallback.marketIntent,
    relation: ['single','multi','comparison','event','general'].includes(raw?.relation) ? raw.relation : fallback.relation,
    planner: raw?.planner || 'ai'
  };
}

function parseJsonResponse(response) {
  const value = response?.choices?.[0]?.message?.content;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const raw = Array.isArray(value) ? value.map(part => part?.text || '').join('') : value;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('topic planner tidak mengembalikan JSON');
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}

async function createPlan(topic = '', { client } = {}) {
  const cleanTopic = clean(topic);
  if (!cleanTopic) return fallbackPlan(cleanTopic);

  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  try {
    const response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        {
          role: 'system',
          content: 'Anda parser topik pencarian berita. Jangan menjawab fakta atau menebak berita. Hanya uraikan maksud literal topik user agar mesin pencari bisa menemukan sumber terbaru.'
        },
        {
          role: 'user',
          content: `TOPIK USER: ${JSON.stringify(cleanTopic)}\n\nKembalikan HANYA JSON dengan schema:\n{"canonicalTopic":"...","subjects":["..."],"eventTerms":["..."],"searchQueries":["..."],"marketIntent":false,"relation":"single|multi|comparison|event|general"}\n\nAturan:\n- subjects = nama orang/perusahaan/produk/model/fitur/tempat/organisasi yang benar-benar tertulis atau jelas merupakan subjek literal topik. Jangan invent nama baru.\n- Pertahankan ejaan nama, nomor versi, singkatan, dan angka identitas persis.\n- eventTerms = aksi/peristiwa/konteks inti topik. Boleh sertakan padanan Inggris jika itu membantu pencarian global, tetapi jangan menambah fakta.\n- searchQueries maksimal 4, selalu relevan dengan topik yang sama. Minimal satu query mempertahankan nama subjek persis; boleh buat versi Inggris untuk kata aksi/konteks.\n- marketIntent true hanya bila user memang meminta saham/pasar/harga/trading.\n- Ini parser, bukan fact checker. Jangan menyimpulkan sesuatu yang tidak ada di topik.`
        }
      ],
      response_format: { type: 'json_object' }
    });
    return normalizePlan(parseJsonResponse(response), cleanTopic);
  } catch (error) {
    console.warn('[AutoSource] dynamic topic planner fallback:', error.message);
    return fallbackPlan(cleanTopic);
  }
}

module.exports = {
  createPlan,
  fallbackPlan,
  normalizePlan,
  clean,
  normalize,
  uniq
};
