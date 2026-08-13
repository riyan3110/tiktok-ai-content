const OpenAI = require('openai');
const config = require('../config');
const simple = require('./autoSourceSimpleComposer');

// TANPA URL / AUTO SOURCE ONLY.
// The source/evidence may be any language. User-visible copy must stay natural
// Indonesian, source-faithful, and preserve the source's timing/certainty.
// This guard runs after the normal simple writer + checker. Pakai URL never
// loads this module.

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

const BODY_REPAIR_TARGET_MIN_WORDS = 14;
const FUTURE_OR_ROLLOUT = /\b(?:will\s+(?:be\s+)?(?:available|launch|roll\s+out|expand)|coming\s+(?:to|soon)|plans?\s+to\s+(?:launch|expand|roll\s+out)|(?:is|are)\s+(?:now\s+)?(?:launching|rolling\s+out|expanding)|rolling\s+out|expanding\s+to|set\s+to\s+(?:launch|expand)|akan|bakal|segera|bertahap|sedang\s+(?:diluncurkan|digulirkan|diperluas)|digulirkan|diperluas|mulai\s+(?:digulirkan|diluncurkan|tersedia)|dalam\s+proses\s+(?:peluncuran|perluasan))\b/i;
const COMPLETED_ROLLOUT = /\b(?:(?:telah|sudah)\s+(?:resmi\s+)?(?:dirilis|diluncurkan|tersedia|hadir|digulirkan|diperluas)|(?:secara\s+)?resmi\s+(?:meluncurkan|merilis|menghadirkan)|(?:has|have)\s+(?:already\s+)?(?:been\s+)?(?:released|launched|rolled\s+out|expanded|made\s+available)|officially\s+(?:launched|released))\b/i;
const VISIBLE_HYPE = /\b(?:(?:lompatan|terobosan)\s+besar|game[- ]?changer|revolusioner|pembaruan\s+besar(?:-besaran)?|perubahan\s+fundamental|transformasi\s+besar|secara\s+fundamental\s+(?:mengubah|membentuk\s+ulang)|membayangkan\s+ulang\s+(?:cara|pengalaman)|visi\s+(?:navigasi\s+)?digital\s+baru|era\s+baru\s+(?:navigasi|digital)|mengubah\s+(?:sepenuhnya\s+|total\s+)?cara\s+(?:kita|orang|pengguna)|masa\s+depan\s+(?:sudah\s+)?(?:tiba|dimulai)|fundamentally\s+(?:changes?|reshapes?|reimagines?)|reimag(?:e|ines|ined|ining)\s+(?:navigation|the\s+experience))\b/i;
const UNIVERSAL_VISIBLE_SCOPE = /\b(?:(?:semua|seluruh)\s+(?:pengguna|user|lokasi|tempat|wilayah|negara)|di\s+semua\s+(?:lokasi|tempat|wilayah|negara)|(?:semua|seluruh|setiap)\s+(?:teks|konten|hasil|output|jawaban|respons|file|gambar)|semua\s+tempat\s+ask\s+maps\s+tersedia|(?:secara\s+)?global|everywhere|worldwide|globally|all\s+(?:(?:generated|ai[- ]generated)\s+)?(?:users|locations|places|regions|countries|text|content|outputs?|responses?|files?|images?)|(?:every|each)\s+(?:(?:generated|ai[- ]generated)\s+)?(?:text|content|output|response|file|image))\b/i;
const UNIVERSAL_EVIDENCE_SCOPE = /\b(?:(?:semua|seluruh)\s+(?:pengguna|user|lokasi|tempat|wilayah|negara)|di\s+semua\s+(?:lokasi|tempat|wilayah|negara)|(?:semua|seluruh|setiap)\s+(?:teks|konten|hasil|output|jawaban|respons|file|gambar)|everywhere(?:\s+ask\s+maps\s+is\s+available)?|(?:secara\s+)?global|worldwide|globally|all\s+(?:(?:generated|ai[- ]generated)\s+)?(?:users|locations|places|regions|countries|text|content|outputs?|responses?|files?|images?)|(?:every|each)\s+(?:(?:generated|ai[- ]generated)\s+)?(?:text|content|output|response|file|image)|widely\s+available\s+to\s+all)\b/i;
const OFFLINE_VISIBLE = /\b(?:offline|tanpa\s+(?:akses\s+)?internet|tanpa\s+koneksi\s+internet|tidak\s+(?:memerlukan|membutuhkan)\s+(?:koneksi\s+)?internet|tak\s+(?:memerlukan|membutuhkan)\s+(?:koneksi\s+)?internet|without\s+(?:an?\s+)?internet\s+connection|without\s+internet|no\s+internet\s+(?:connection|access))\b/i;
const OFFLINE_EVIDENCE = /\b(?:offline|tanpa\s+(?:akses\s+)?internet|tanpa\s+koneksi\s+internet|tidak\s+(?:memerlukan|membutuhkan)\s+(?:koneksi\s+)?internet|tak\s+(?:memerlukan|membutuhkan)\s+(?:koneksi\s+)?internet|without\s+(?:an?\s+)?internet\s+connection|without\s+internet|no\s+internet\s+(?:connection|access)|without\s+network\s+access)\b/i;
const POST_REPAIR_NO_EXTRA_ANGLES = new Set(['realtime', 'personalization', 'conversation', 'mechanism', 'durability', 'detection']);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function words(value) {
  return clean(value).split(/\s+/).filter(Boolean);
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

function rolloutOverstatement(copy = '', evidence = '') {
  const visible = clean(copy);
  const source = clean(evidence);
  if (!visible || !source) return false;
  return FUTURE_OR_ROLLOUT.test(source)
    && !COMPLETED_ROLLOUT.test(source)
    && COMPLETED_ROLLOUT.test(visible);
}

function scopeOverstatement(copy = '', evidence = '') {
  const visible = clean(copy);
  const source = clean(evidence);
  if (!visible || !source || !UNIVERSAL_VISIBLE_SCOPE.test(visible)) return false;
  return !UNIVERSAL_EVIDENCE_SCOPE.test(source);
}

function offlineOverstatement(copy = '', evidence = '') {
  const visible = clean(copy);
  const source = clean(evidence);
  if (!visible || !source || !OFFLINE_VISIBLE.test(visible)) return false;
  return !OFFLINE_EVIDENCE.test(source);
}

function criticalAngleMismatch(copy = '', packet = {}) {
  const visible = clean(copy);
  const evidence = clean(packet?.mainEvidence);
  if (!visible || !evidence) return true;
  const topic = packet?.topic || '';
  const evidenceAngles = new Set(simple.factAngles(evidence, topic));
  const visibleAngles = new Set(simple.factAngles(visible, topic));
  return [...POST_REPAIR_NO_EXTRA_ANGLES].some(angle => visibleAngles.has(angle) && !evidenceAngles.has(angle));
}

function bodyNeedsDensityRepair(body = '', packet = {}) {
  const evidenceWords = words(packet?.mainEvidence).length;
  if (!evidenceWords) return false;
  const desired = Math.min(BODY_REPAIR_TARGET_MIN_WORDS, evidenceWords);
  return words(body).length < desired;
}

function visibleHype(value = '') {
  return VISIBLE_HYPE.test(clean(value));
}

function factualShapeNeedsRepair(value = '', packet = {}) {
  if (!clean(value)) return true;
  if (rolloutOverstatement(value, packet?.mainEvidence)) return true;
  if (scopeOverstatement(value, packet?.mainEvidence)) return true;
  if (offlineOverstatement(value, packet?.mainEvidence)) return true;
  if (criticalAngleMismatch(value, packet)) return true;
  return false;
}

function titleShapeNeedsRepair(value = '', packet = {}) {
  const title = clean(value);
  if (!title) return false;
  if (rolloutOverstatement(title, packet?.mainEvidence)) return true;
  if (scopeOverstatement(title, packet?.mainEvidence)) return true;
  if (offlineOverstatement(title, packet?.mainEvidence)) return true;
  return false;
}

function needsQualityRepair(result = {}, packets = []) {
  const slides = Array.isArray(result?.slides) ? result.slides : [];
  return packets.some((packet, slideIndex) => {
    const slide = slides[slideIndex] || {};
    const body = clean(slide?.body);
    const title = clean(slide?.title);
    if (!body) return true;
    if (bodyNeedsDensityRepair(body, packet)) return true;
    if (visibleHype(title) || visibleHype(body)) return true;
    if (titleShapeNeedsRepair(title, packet)) return true;
    if (factualShapeNeedsRepair(body, packet)) return true;
    if (!simple.mainEvidenceCovered(body, packet)) return true;
    return false;
  });
}

// After a translation/editor pass, do not reject good Indonesian copy merely
// because the language-agnostic semantic matcher cannot align Indonesian with
// English evidence. Keep deterministic checks that are safe cross-language:
// rollout certainty, universal scope, explicit offline claims, and guarded
// feature angles that must not be spliced into another fact.
function needsPostRepairRetry(result = {}, packets = []) {
  if (needsIndonesianRepair(result)) return true;
  const slides = Array.isArray(result?.slides) ? result.slides : [];
  return packets.some((packet, slideIndex) => {
    const slide = slides[slideIndex] || {};
    const body = clean(slide?.body);
    const title = clean(slide?.title);
    if (!body) return true;
    if (bodyNeedsDensityRepair(body, packet)) return true;
    if (visibleHype(title) || visibleHype(body)) return true;
    if (titleShapeNeedsRepair(title, packet)) return true;
    if (factualShapeNeedsRepair(body, packet)) return true;
    return false;
  });
}

function needsVisibleRepair(result = {}, packets = []) {
  return needsIndonesianRepair(result) || needsQualityRepair(result, packets);
}

function repairPrompt({ topic, format, result, packets = [] }) {
  const visible = (result?.slides || []).map(slide => ({
    title: clean(slide?.title),
    body: clean(slide?.body),
    points: (slide?.points || []).map(clean)
  }));
  const evidence = packets.map(packet => ({
    slideIndex: packet?.slideIndex,
    section: packet?.section,
    sourceTitle: packet?.sourceTitle,
    publishedAt: packet?.publishedAt,
    mainEvidence: clean(packet?.mainEvidence)
  }));
  return `EDITOR COPY VISIBLE AUTO SOURCE — TANPA URL.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nCOPY SAAT INI:\n${JSON.stringify(visible)}\n\nFAKTA SUMBER PER SLIDE:\n${JSON.stringify(evidence)}\n\nTUGAS:\nPerbaiki HANYA copy yang masih kurang pas. Pertahankan bagian yang sudah benar. Semua title, body, dan bullet final harus Bahasa Indonesia natural serta setia pada mainEvidence slide masing-masing.\n\nATURAN KERAS:\n- Slide N hanya boleh menjelaskan mainEvidence slide N. Jangan memindahkan atau mencampur fakta dari slide lain.\n- Jangan mengubah fakta, angka, persentase, tanggal, nama perusahaan, nama produk, nama model, versi, lokasi, atau tingkat kepastian.\n- WAJIB mempertahankan status waktu/ketersediaan. Jika sumber berkata akan, coming, expanding, rolling out, bertahap, atau diperluas, JANGAN mengubahnya menjadi telah/sudah dirilis, tersedia, resmi diluncurkan, atau selesai diluncurkan.\n- Cakupan WAJIB sama dengan mainEvidence. Jangan menulis “semua pengguna”, “semua lokasi”, “setiap teks/output”, “di seluruh wilayah”, “global”, atau “everywhere” kecuali mainEvidence secara eksplisit menyatakan cakupan universal tersebut.\n- Jangan menyimpulkan “offline”, “tanpa internet”, atau “tidak memerlukan koneksi internet” hanya karena mainEvidence menyebut local/on-device/personal device. Klaim offline hanya boleh bila mainEvidence mengatakannya secara eksplisit.\n- Jangan menggabungkan dua kemampuan dari fakta berbeda. Contoh: real-time transit tidak boleh dimasukkan ke body Gmail/Personal Intelligence bila mainEvidence slide itu tidak menyebut real-time transit; begitu juga sebaliknya.\n- Jangan menambah sebab-akibat, manfaat, tujuan, strategi, implikasi, atau klaim yang tidak tertulis pada mainEvidence.\n- Hilangkan wording editorial/hype seperti “pembaruan besar-besaran”, “secara fundamental mengubah”, “visi digital baru”, “era baru”, “revolusioner”, atau klaim sejenis jika itu bukan fakta konkret. Ganti dengan detail faktual dari mainEvidence, bukan filler.\n- Body target 14-20 kata bila mainEvidence cukup panjang. Utamakan satu fakta konkret + detail pembeda yang benar; jangan memanjangkan dengan kalimat umum. Jika evidence tidak cukup untuk mencapai target, tetap lebih pendek daripada menambah klaim baru.\n- Judul harus berupa label/sudut editorial 3-8 kata, berbeda dari body dan berbeda antar-slide. Judul tidak boleh menambah fakta baru.\n- Bullet 0-3 dan TIDAK wajib. Pertahankan jumlah/urutan bullet yang ada; bila bullet yang ada tidak dapat dibuktikan mainEvidence, kosongkan teks bullet itu daripada mengarang.\n- Nama resmi/brand/istilah teknis seperti Google Maps, Ask Maps, Gemini, Gmail, API, GPU, EVM boleh tetap asli bila natural.\n- Pertahankan jumlah slide tepat 4.\n- Jangan sertakan evidence atau claim; metadata fakta akan dipertahankan oleh sistem.\n\nKembalikan HANYA JSON:\n{"slides":[{"title":"...","body":"...","points":["..."]}]}`;
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
        content: 'Anda editor Bahasa Indonesia dan fact-checker copy visible. Perbaiki hanya bagian yang perlu, selalu tunduk pada mainEvidence setiap slide, dan jangan mengubah tingkat kepastian atau cakupan sumber.'
      },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' }
  });
  return parseJsonResponse(response);
}

async function ensureIndonesian({ result, topic = '', format = 'Fakta singkat', sources = [], client } = {}) {
  const packets = simple.buildSlidePackets(sources, topic, format);
  if (packets.length !== simple.SLIDE_COUNT) return result;
  if (!needsVisibleRepair(result, packets)) return result;

  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let current = result;

  // Normally one pass is enough. The second pass is only a fail-safe when the
  // provider leaves English, hype, thin copy, a rollout-status overstatement,
  // a widened scope, or a feature spliced in from another fact.
  for (let attempt = 0; attempt < 2 && needsVisibleRepair(current, packets); attempt += 1) {
    let translated;
    try {
      translated = await callRepair(openai, repairPrompt({ topic, format, result: current, packets }));
    } catch {
      break;
    }
    const candidate = applyVisibleRepair(current, translated);
    const finalized = simple.finalizeVisibleCopy(candidate, packets, sources);
    // Unsupported numbers, broken claim metadata, empty copy, and other
    // factual errors remain blocking. Cross-language semantic mismatch alone
    // must not throw away a valid Indonesian repair and expose English evidence.
    const blocking = simple.unsafeBlockingErrors(finalized.errors, packets);
    if (blocking.length || needsPostRepairRetry(finalized.candidate, packets)) continue;
    current = syncVisibleTop({ ...current, slides: finalized.candidate.slides });
  }

  return current;
}

module.exports = {
  languageSignals,
  likelyEnglishVisible,
  visibleValues,
  needsIndonesianRepair,
  rolloutOverstatement,
  scopeOverstatement,
  offlineOverstatement,
  criticalAngleMismatch,
  bodyNeedsDensityRepair,
  visibleHype,
  factualShapeNeedsRepair,
  titleShapeNeedsRepair,
  needsQualityRepair,
  needsPostRepairRetry,
  needsVisibleRepair,
  repairPrompt,
  applyVisibleRepair,
  syncVisibleTop,
  ensureIndonesian
};
