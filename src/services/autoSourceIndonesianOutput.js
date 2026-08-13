const OpenAI = require('openai');
const config = require('../config');
const simple = require('./autoSourceSimpleComposer');

// TANPA URL / AUTO SOURCE ONLY.
// The source/evidence may be any language. Only user-visible copy must be
// natural Indonesian. This guard runs after the normal simple writer + checker
// and only calls the model when visible English copy actually leaked through.

const ENGLISH_MARKERS = new Set([
  'the','and','or','to','of','in','on','for','with','from','is','are','was','were','will','can','could','has','have','had',
  'into','without','during','through','by','users','user','supported','models','model','working','work','add','adding','plans',
  'plan','embed','generated','older','latest','news','rolls','out','global','because','part','directly','responses','altering',
  'text','content','watermark','watermarking','company','acknowledges','frequently','employ','weave','support'
]);

const INDONESIAN_MARKERS = new Set([
  'yang','dan','atau','untuk','dengan','dari','pada','dalam','ini','itu','akan','sedang','telah','sudah','dapat','bisa','oleh',
  'sebagai','karena','melalui','menjadi','secara','pengguna','fitur','menambahkan','mendukung','menggunakan','memakai','teks',
  'konten','tanda','air','jawaban','model','perusahaan','langsung','tanpa','selama','periode','lama','baru','menguji','dirilis'
]);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function tokenList(value) {
  return clean(value)
    .toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9%]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function languageSignals(value) {
  const tokens = tokenList(value);
  let english = 0;
  let indonesian = 0;
  for (const token of tokens) {
    if (ENGLISH_MARKERS.has(token)) english += 1;
    if (INDONESIAN_MARKERS.has(token)) indonesian += 1;
  }
  return { tokens, english, indonesian };
}

function likelyEnglishVisible(value) {
  const { tokens, english, indonesian } = languageSignals(value);
  if (tokens.length < 4) return false;
  if (english >= 2 && english > indonesian) return true;
  if (tokens.length >= 6 && indonesian === 0 && english >= 1) return true;
  return false;
}

function visibleValues(result = {}) {
  const values = [];
  for (const slide of Array.isArray(result?.slides) ? result.slides : []) {
    values.push(slide?.title, slide?.body, ...(Array.isArray(slide?.points) ? slide.points : []));
  }
  return values.map(clean).filter(Boolean);
}

function needsIndonesianRepair(result = {}) {
  return visibleValues(result).some(likelyEnglishVisible);
}

function repairPrompt({ topic, format, result }) {
  const visible = (result?.slides || []).map(slide => ({
    title: clean(slide?.title),
    body: clean(slide?.body),
    points: (slide?.points || []).map(clean)
  }));
  return `PERBAIKI BAHASA COPY VISIBLE AUTO SOURCE.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nCOPY SAAT INI:\n${JSON.stringify(visible)}\n\nTUGAS:\nUbah SEMUA title, body, dan bullet yang masih berbahasa Inggris menjadi Bahasa Indonesia yang natural dan ringkas.\n\nATURAN KERAS:\n- Jangan mengubah fakta, angka, persentase, tanggal, nama perusahaan, nama produk, nama model, versi, atau tingkat kepastian.\n- Jangan menambah atau menghapus konteks berita. Ini HANYA repair bahasa.\n- Nama resmi/brand/istilah teknis seperti Anthropic, Claude, API, GPU, EVM, watermark boleh tetap asli bila natural, tetapi kalimat di sekelilingnya wajib Bahasa Indonesia.\n- Pertahankan jumlah slide tepat 4.\n- Pertahankan jumlah dan urutan bullet pada tiap slide; jika tidak ada bullet, tetap kosong.\n- Body tetap padat dan natural. Jangan menyalin kalimat sumber Inggris mentah.\n- Jangan sertakan evidence atau claim; metadata fakta akan dipertahankan oleh sistem.\n\nKembalikan HANYA JSON:\n{"slides":[{"title":"...","body":"...","points":["..."]}]}`;
}

function parseJsonResponse(response) {
  const value = response?.choices?.[0]?.message?.content;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const raw = Array.isArray(value) ? value.map(part => part?.text || '').join('') : value;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Provider tidak mengembalikan JSON repair bahasa.');
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}

function claimByField(slide = {}) {
  return new Map((slide?.claims || []).map(claim => [String(claim?.field || ''), claim]));
}

function applyVisibleRepair(result = {}, translated = {}) {
  const translatedSlides = Array.isArray(translated?.slides) ? translated.slides : [];
  return {
    ...result,
    slides: (result?.slides || []).map((slide, slideIndex) => {
      const next = translatedSlides[slideIndex] || {};
      const originalPoints = Array.isArray(slide?.points) ? slide.points : [];
      const nextPoints = Array.isArray(next?.points) ? next.points : [];
      const points = originalPoints.map((point, pointIndex) => clean(nextPoints[pointIndex]) || clean(point));
      const map = claimByField(slide);
      const body = clean(next?.body) || clean(slide?.body);
      const claims = [];
      const bodyClaim = map.get(`slide:${slideIndex}:body`);
      if (body && bodyClaim) claims.push({ ...bodyClaim, text: body });
      points.forEach((point, pointIndex) => {
        const claim = map.get(`slide:${slideIndex}:point:${pointIndex}`);
        if (point && claim) claims.push({ ...claim, text: point });
      });
      return {
        ...slide,
        title: clean(next?.title) || clean(slide?.title),
        body,
        points,
        claims
      };
    })
  };
}

function syncVisibleTop(result = {}) {
  const slides = result?.slides || [];
  const first = slides[0] || {};
  const middle = slides.find((slide, index) => index > 0 && index < slides.length - 1 && slide?.body) || first;
  const last = slides.at(-1) || first;
  return {
    ...result,
    hook: clean(first?.title || result?.hook),
    body: clean(middle?.body || first?.body || result?.body),
    caption: simple.buildCaption(slides, result?.caption || middle?.body || first?.body, result?.topic),
    cta: clean(last?.title || result?.cta || 'Ringkasan')
  };
}

async function callRepair(openai, prompt) {
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [
      {
        role: 'system',
        content: 'Anda editor Bahasa Indonesia. Tugas Anda hanya menerjemahkan/parafrase copy visible ke Bahasa Indonesia tanpa mengubah fakta.'
      },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' }
  });
  return parseJsonResponse(response);
}

async function ensureIndonesian({ result, topic = '', format = 'Fakta singkat', sources = [], client } = {}) {
  if (!needsIndonesianRepair(result)) return result;

  const packets = simple.buildSlidePackets(sources, topic, format);
  if (packets.length !== simple.SLIDE_COUNT) return result;
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let current = result;

  // Normally this loop runs once. A second pass is only a fail-safe when the
  // provider ignored the first language-only repair instruction.
  for (let attempt = 0; attempt < 2 && needsIndonesianRepair(current); attempt += 1) {
    let translated;
    try {
      translated = await callRepair(openai, repairPrompt({ topic, format, result: current }));
    } catch {
      break;
    }
    const candidate = applyVisibleRepair(current, translated);
    const finalized = simple.finalizeVisibleCopy(candidate, packets, sources);
    // A literal-evidence fallback can be translated faithfully even when the
    // language-agnostic editorial heuristic still sees a repeated angle or
    // misses a cross-language detail alias. Unsupported numbers, broken claim
    // metadata, empty copy, and other factual errors remain blocking.
    const blocking = simple.unsafeBlockingErrors(finalized.errors, packets);
    if (blocking.length) continue;
    current = syncVisibleTop({ ...current, slides: finalized.candidate.slides });
  }

  return current;
}

module.exports = {
  languageSignals,
  likelyEnglishVisible,
  visibleValues,
  needsIndonesianRepair,
  repairPrompt,
  applyVisibleRepair,
  syncVisibleTop,
  ensureIndonesian
};
