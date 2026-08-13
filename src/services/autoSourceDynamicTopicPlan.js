const OpenAI = require('openai');
const config = require('../config');

// TANPA URL / AUTO SOURCE ONLY.
// Build a fresh topic plan from the exact user input. The plan is intentionally
// small: subjects + event/action/context + search queries. No catalog of known
// companies/products/news topics is required.

const GLUE_WORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','dalam','ini','itu','adalah','merupakan','sebagai','oleh','ke','di','terhadap',
  'baru','terbaru','update','berita','news','latest','new','info','fakta','singkat','the','and','or','from','for','with','about','on','in','to','of'
]);
const SUBJECT_NOISE = new Set([
  'aplikasi','fitur','teknologi','berita','update','baru','terbaru','potensi','manfaat','dampak','pengaruh','peran','cara','kemampuan','fungsi',
  'kegunaan','penggunaan','penerapan','contoh','fakta','info','memperkenalkan','menghadirkan','meluncurkan','merilis','mengumumkan',
  'hadapi','menghadapi','prioritaskan','menambahkan','memperbarui','launch','launches','launched','introduce','introduces','introduced',
  'release','releases','released','announce','announces','announced','adds','updates','unveils','reveals'
]);
const USER_INTENT_COMMANDS = new Set([
  'kenali','mengenal','mengenali','ketahui','mengetahui','pahami','memahami','simak','lihat','cek','pelajari','mempelajari',
  'bedakan','bandingkan','jelaskan','bahas','ulas','find','learn','know','understand','compare','explain','review'
]);
const ASPECT_WORDS = new Set([
  'sedang','tengah','telah','sudah','akan','bakal','kini','masih','mulai','kembali','baru','currently','now','still','already','will','plans','plan'
]);
const EVENT_VERBS = new Set([
  'uji','menguji','test','tests','testing','tested','rilis','merilis','release','releases','released','launch','launches','launched',
  'luncurkan','meluncurkan','hadir','hadirkan','menghadirkan','introduce','introduces','introduced','memperkenalkan','umumkan','mengumumkan',
  'announce','announces','announced','tambah','menambahkan','add','adds','added','perbarui','memperbarui','update','updates','updated',
  'ubah','mengubah','change','changes','changed','hapus','menghapus','remove','removes','removed','batasi','membatasi','limit','limits','limited',
  'perluas','memperluas','expand','expands','expanded','hadapi','menghadapi','face','faces','faced','prioritaskan','prioritize','prioritizes',
  'lampaui','melampaui','beat','beats','beating','exceed','exceeds','exceeded','turun','menurun','rise','rises','rose','naik','meningkat','increase','increases','increased',
  'akuisisi','mengakuisisi','acquire','acquires','acquired','kerja','bekerja','partner','partners','partnered','sign','signs','signed','menang','wins','won','lapor','melaporkan','report','reports','reported'
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

function verbLike(token = '') {
  const key = normalize(token);
  if (!key) return false;
  if (EVENT_VERBS.has(key)) return true;
  if (/^(?:meng|meny|men|mem|me|ber|ter|di)[a-z]{3,}$/i.test(key)) return true;
  if (/(?:kan)$/i.test(key) && key.length >= 6) return true;
  return false;
}

function fallbackEventParts(topic = '', subjects = []) {
  const tokens = rawTokens(topic);
  const subjectWords = new Set(subjects.flatMap(subject => normalize(subject).split(' ').filter(Boolean)));
  const candidates = [];

  for (const token of tokens) {
    const key = normalize(token);
    if (!key || subjectWords.has(key) || GLUE_WORDS.has(key) || ASPECT_WORDS.has(key)) continue;
    if (USER_INTENT_COMMANDS.has(key)) continue;
    if (SUBJECT_NOISE.has(key) && !verbLike(token)) continue;
    candidates.push(token);
  }

  if (!candidates.length) return { actionTerms: [], contextTerms: [] };
  const first = candidates[0];
  const actionTerms = verbLike(first) ? [first] : [];
  const contextTerms = actionTerms.length ? candidates.slice(1) : candidates;
  return {
    actionTerms: uniq(actionTerms, 4),
    contextTerms: uniq(contextTerms, 8)
  };
}

function fallbackPlan(topic = '') {
  const cleanTopic = clean(topic);
  const tokens = rawTokens(cleanTopic);
  const contentTerms = tokens.filter(token => {
    const key = normalize(token);
    return key && !GLUE_WORDS.has(key) && (key.length > 2 || /\d/.test(key) || /^[A-Z0-9]{2,}$/.test(token));
  });
  const semanticTerms = contentTerms.filter(term => !USER_INTENT_COMMANDS.has(normalize(term)));

  const named = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) named.push(buffer.join(' '));
    buffer = [];
  };
  for (const token of tokens) {
    const key = normalize(token);
    if (USER_INTENT_COMMANDS.has(key) || SUBJECT_NOISE.has(key) || GLUE_WORDS.has(key) || ASPECT_WORDS.has(key)) {
      flush();
      continue;
    }
    const namedLike = /[a-z][A-Z]/.test(token)
      || /^[A-Z0-9]{2,}$/.test(token)
      || /^[A-Z][A-Za-z0-9.-]{2,}$/.test(token)
      || /\d/.test(token);
    if (namedLike) buffer.push(token);
    else flush();
  }
  flush();

  const subjects = uniq(named.length ? named : semanticTerms.filter(term => !SUBJECT_NOISE.has(normalize(term))).slice(0, 2), 4);
  const subjectTokens = new Set(subjects.flatMap(value => normalize(value).split(' ').filter(Boolean)));
  const eventTerms = contentTerms.filter(term => {
    const key = normalize(term);
    return !subjectTokens.has(key) && !ASPECT_WORDS.has(key) && !USER_INTENT_COMMANDS.has(key);
  });
  const eventParts = fallbackEventParts(cleanTopic, subjects);

  return {
    rawTopic: cleanTopic,
    canonicalTopic: cleanTopic,
    subjects,
    eventTerms: uniq(eventTerms.length ? eventTerms : semanticTerms, 8),
    actionTerms: eventParts.actionTerms,
    contextTerms: eventParts.contextTerms,
    searchQueries: uniq([
      cleanTopic,
      `${cleanTopic} terbaru`,
      `${cleanTopic} latest`
    ], 5),
    marketIntent: MARKET_RE.test(cleanTopic),
    relation: /\b(?:vs\.?|versus|dibanding(?:kan)?|perbandingan)\b/i.test(cleanTopic) ? 'comparison'
      : /\b(?:dan|&)\b/i.test(cleanTopic) && named.length >= 2 ? 'multi'
        : eventParts.actionTerms.length ? 'event' : 'single',
    planner: 'fallback'
  };
}

function normalizePlan(raw, topic) {
  const fallback = fallbackPlan(topic);
  const hasSubjects = Array.isArray(raw?.subjects);
  const hasEvents = Array.isArray(raw?.eventTerms);
  const hasActions = Array.isArray(raw?.actionTerms);
  const hasContexts = Array.isArray(raw?.contextTerms);
  const subjects = uniq(hasSubjects ? raw.subjects : fallback.subjects, 4);
  const eventTerms = uniq(hasEvents ? raw.eventTerms : fallback.eventTerms, 10);
  const actionTerms = uniq(hasActions ? raw.actionTerms : fallback.actionTerms, 8);
  const contextTerms = uniq(hasContexts ? raw.contextTerms : fallback.contextTerms, 12);
  const searchQueries = uniq([
    topic,
    ...(Array.isArray(raw?.searchQueries) ? raw.searchQueries : []),
    ...fallback.searchQueries
  ], 7);

  return {
    rawTopic: clean(topic),
    canonicalTopic: clean(raw?.canonicalTopic || topic),
    subjects: hasSubjects ? subjects : (subjects.length ? subjects : fallback.subjects),
    eventTerms: hasEvents ? eventTerms : (eventTerms.length ? eventTerms : fallback.eventTerms),
    actionTerms: hasActions ? actionTerms : fallback.actionTerms,
    contextTerms: hasContexts ? contextTerms : fallback.contextTerms,
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
          content: 'Anda parser topik pencarian berita. Jangan menjawab fakta atau menebak berita. Uraikan maksud literal topik user dan normalkan hanya typo nama entitas yang sangat jelas agar mesin pencari bisa menemukan sumber terbaru.'
        },
        {
          role: 'user',
          content: `TOPIK USER: ${JSON.stringify(cleanTopic)}\n\nKembalikan HANYA JSON dengan schema:\n{"canonicalTopic":"...","subjects":["..."],"eventTerms":["..."],"actionTerms":["..."],"contextTerms":["..."],"searchQueries":["..."],"marketIntent":false,"relation":"single|multi|comparison|event|general"}\n\nAturan:\n- Pahami topik sebagai judul singkat yang mungkin tidak baku. canonicalTopic harus memperjelas maksud yang sama tanpa mengarang peristiwa, produk, atau fakta baru.\n- Kata perintah pembaca seperti kenali, ketahui, pahami, simak, lihat, pelajari, compare, atau explain BUKAN subject dan BUKAN peristiwa berita.\n- subjects = nama orang/perusahaan/produk/model/fitur/tempat/organisasi yang benar-benar tertulis atau jelas merupakan subjek literal topik. Jangan invent nama baru.\n- Jika sebuah nama entitas publik mengandung typo yang sangat jelas dan maksud koreksinya berkeyakinan tinggi, gunakan ejaan yang benar di canonicalTopic, subjects, dan searchQueries. Jika ambigu, pertahankan input asli. Ini koreksi query, bukan izin mengganti subjek.\n- Pertahankan nomor versi, singkatan, angka identitas, dan pembeda model persis. TOPIK USER mentah tetap dipertahankan oleh sistem secara terpisah.\n- actionTerms = aksi inti yang diminta user (contoh literal: menguji, meluncurkan, melampaui). Sertakan sinonim Indonesia yang jelas dan beberapa verba Inggris natural yang benar-benar menyatakan aksi SAMA, termasuk bentuk object-as-verb bila lazim dalam bahasa Inggris. Ini alternatif bahasa, bukan aksi baru. Jika topik tidak punya aksi/event spesifik, kembalikan [].\n- contextTerms = konsep pembeda yang wajib ada agar artikel tentang subjek yang sama tetapi berita berbeda tidak lolos. Gunakan frasa spesifik; hindari kata generik tunggal jika dapat dibuat sebagai frasa. Sertakan padanan Indonesia/Inggris sebagai alternatif bila perlu.\n- eventTerms = frasa event atau hubungan antarkonsep yang spesifik dan berguna untuk memeriksa kecocokan artikel; tetap satu maksud yang sama.\n- searchQueries maksimal 4 dan memprioritaskan sumber terbaru. Gunakan nama subjek hasil normalisasi berkeyakinan tinggi; buat query Indonesia dan/atau Inggris yang natural sesuai bahasa sumber yang mungkin tersedia.\n- Semua topik boleh diproses; jangan memakai whitelist kategori dan jangan menolak hanya karena topik belum dikenal.\n- marketIntent true hanya bila user memang meminta saham/pasar/harga/trading.\n- Ini parser, bukan fact checker. Jangan menyimpulkan sesuatu yang tidak ada di topik.`
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
  fallbackEventParts,
  normalizePlan,
  clean,
  normalize,
  uniq,
  verbLike,
  USER_INTENT_COMMANDS
};
