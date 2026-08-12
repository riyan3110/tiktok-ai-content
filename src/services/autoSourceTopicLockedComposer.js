const OpenAI = require('openai');
const config = require('../config');
const research = require('./autoSourceResearchComposer');
const simple = require('./autoSourceSimpleComposer');
const identity = require('./autoSourceTopicIdentity');

// TANPA URL / AUTO SOURCE ONLY.
// For a topic with an explicit model/version identity (e.g. Grok 4.6), every
// mainEvidence must mention that exact identity. Generic topics delegate to the
// normal research composer unchanged.

const SLIDE_COUNT = 4;
const STRICT_DUPLICATE_THRESHOLD = 0.58;
const RELAXED_DUPLICATE_THRESHOLD = 0.76;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseJsonResponse(response) {
  const value = response?.choices?.[0]?.message?.content;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const raw = Array.isArray(value) ? value.map(part => part?.text || '').join('') : value;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Provider tidak mengembalikan JSON Auto Source.');
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}

async function callJson(openai, system, user) {
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' }
  });
  return parseJsonResponse(response);
}

function identityCandidates(sources = [], topic = '') {
  return research.buildFactCandidates(sources, topic).filter(candidate =>
    identity.identityMatches(topic, candidate.evidence)
    && !identity.relativeTimeMetadata(candidate.evidence)
  );
}

function chooseFacts(sources = [], topic = '', count = SLIDE_COUNT) {
  const candidates = identityCandidates(sources, topic);
  const selected = [];
  const sourceUses = new Map();

  for (const threshold of [STRICT_DUPLICATE_THRESHOLD, RELAXED_DUPLICATE_THRESHOLD, 0.9]) {
    while (selected.length < count) {
      let best = null;
      for (const candidate of candidates) {
        if (selected.includes(candidate)) continue;
        if (selected.some(existing => research.contextSimilarity(existing.evidence, candidate.evidence, topic) >= threshold)) continue;
        const uses = sourceUses.get(candidate.sourceId) || 0;
        const adjusted = Number(candidate.score || 0) + (uses === 0 ? 0.3 : 0) - Math.max(0, uses - 1) * 0.2;
        if (!best || adjusted > best.adjusted) best = { candidate, adjusted };
      }
      if (!best) break;
      selected.push(best.candidate);
      sourceUses.set(best.candidate.sourceId, (sourceUses.get(best.candidate.sourceId) || 0) + 1);
    }
    if (selected.length >= count) break;
  }

  return selected.slice(0, count);
}

function buildSlidePackets(sources = [], topic = '', format = 'Fakta singkat') {
  const facts = chooseFacts(sources, topic, SLIDE_COUNT);
  const sections = simple.sectionsForFormat(format);
  return facts.map((fact, slideIndex) => ({
    slideIndex,
    section: sections[slideIndex],
    primarySourceId: fact.sourceId,
    sourceTitle: fact.sourceTitle,
    publishedAt: fact.publishedAt,
    mainEvidence: fact.evidence,
    evidence: [fact.evidence]
  }));
}

function identityPrompt(topic) {
  const label = identity.identityQuery(topic);
  return label
    ? `Identitas topik yang WAJIB dipertahankan adalah ${JSON.stringify(label)}. Jangan mengganti ke versi/model saudara seperti versi sebelumnya atau berikutnya.`
    : '';
}

function writerPrompt({ topic, format, packets }) {
  return `AUTO SOURCE TOPIC-LOCK — TANPA URL.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\n${identityPrompt(topic)}\n\nEMPAT FAKTA TERPILIH:\n${JSON.stringify(packets)}\n\nTulis carousel 4 slide dalam Bahasa Indonesia natural.\n\nATURAN:\n- Setiap slide hanya menjelaskan mainEvidence miliknya.\n- Setiap mainEvidence sudah menyebut identitas model/versi yang diminta. Pertahankan model/versi itu sebagai subjek slide.\n- Model/versi lain boleh disebut HANYA bila mainEvidence memang membandingkannya langsung dengan model/versi topik. Jangan membuat model lama menjadi topik slide sendiri.\n- Jangan memakai fakta dari artikel lain atau pengetahuan luar.\n- Semua title/body/points tampil harus Bahasa Indonesia; nama model, perusahaan, benchmark, produk, dan istilah teknis boleh tetap asli.\n- Body 9-16 kata, padat dan informatif. Bullet 0-2 dan hanya bila menambah detail unik; maksimal 7 kata per bullet.\n- Jangan menyalin metadata waktu relatif seperti “44 menit lalu” atau “2 hours ago”.\n- Jangan mengulang konteks antarslide.\n- Pertahankan angka, harga, persentase, tanggal, modalitas, negasi, dan perbandingan persis sesuai evidence.\n- Body dan bullet wajib punya claim dengan text sama persis, sourceId sesuai packet, dan evidence VERBATIM sama dengan mainEvidence.\n- Title tidak perlu claim, tetapi tidak boleh menambah fakta baru.\n\nKembalikan HANYA JSON {"slides":[{"title":"...","body":"...","points":[],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}.`;
}

function checkerPrompt({ topic, format, packets, candidate, errors = [] }) {
  return `FACT-CHECK + EDITOR TOPIC-LOCK.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\n${identityPrompt(topic)}\nFAKTA PER SLIDE:\n${JSON.stringify(packets)}\nDRAFT:\n${JSON.stringify(candidate?.slides || [])}\n${errors.length ? `MASALAH:\n${JSON.stringify(errors)}\n` : ''}\nPerbaiki langsung dan kembalikan JSON final.\n\nWAJIB:\n- Jangan mengubah mainEvidence atau primarySourceId.\n- Tiap slide tetap tentang model/versi pada TOPIK, bukan sibling version atau side-note artikel.\n- Jika evidence membandingkan versi lama, versi lama hanya konteks pembanding; subjek slide tetap model/versi TOPIK.\n- Semua copy tampil Bahasa Indonesia natural.\n- Body 9-16 kata; bullet 0-2, maksimal 7 kata.\n- Hapus bullet yang meragukan atau berulang.\n- Jangan masukkan metadata seperti waktu relatif artikel.\n- claim.text harus sama persis dengan copy; evidence harus VERBATIM mainEvidence.\n- Jangan menambah fakta di luar evidence.`;
}

function evaluate(raw, packets, sources, topic) {
  const normalized = simple.normalizeCandidate(raw, packets);
  const finalized = simple.finalizeVisibleCopy(normalized, packets, sources);
  const errors = [
    ...finalized.errors,
    ...research.visibleLanguageErrors(finalized.candidate),
    ...research.duplicateContextErrors(finalized.candidate, topic)
  ];
  return { candidate: finalized.candidate, errors: [...new Set(errors)] };
}

function syncTop(candidate, topic, format, discovery) {
  const slides = candidate.slides || [];
  const first = slides[0] || {};
  const middle = slides.find((slide, index) => index > 0 && index < slides.length - 1 && slide.body) || first;
  const last = slides.at(-1) || first;
  return {
    topic,
    hook: clean(first.title || topic),
    body: clean(middle.body || first.body || topic),
    caption: clean(middle.body || first.body || topic),
    hashtags: [],
    cta: clean(last.title || 'Ringkasan'),
    trendKeywordsUsed: [],
    content_angle: `ringkasan faktual terbaru tentang ${topic}`,
    primary_tool: 'tanpa tool',
    hook_pattern: 'auto-source-topic-lock',
    verificationStatus: 'source_based',
    unsupportedClaims: [],
    effectiveContentFormat: format,
    slides,
    sourceMode: 'auto',
    sourceDiscovery: discovery ? {
      searchedAt: discovery.searchedAt,
      queries: discovery.queries || [],
      providers: discovery.providers || []
    } : undefined
  };
}

async function compose({ options = {}, sources = [], discovery = null, client } = {}) {
  const topic = clean(options.requestedTopic || discovery?.topic || sources[0]?.title || 'Topik sumber');
  if (!identity.hasSpecificIdentity(topic)) return research.compose({ options, sources, discovery, client });
  if (!sources.length) throw Object.assign(new Error('Auto Source tidak menemukan sumber yang dapat dibaca.'), { status: 422 });

  const format = options.contentFormat || 'Fakta singkat';
  const packets = buildSlidePackets(sources, topic, format);
  if (packets.length !== SLIDE_COUNT) {
    throw Object.assign(new Error(`Auto Source hanya menemukan ${packets.length} fakta unik yang benar-benar menyebut ${identity.identityQuery(topic) || 'model/versi topik'}; butuh ${SLIDE_COUNT}.`), {
      status: 422,
      code: 'AUTO_SOURCE_TOPIC_IDENTITY_FACTS'
    });
  }

  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let writerRaw;
  try {
    writerRaw = await callJson(openai, 'Anda penulis carousel Indonesia yang wajib menjaga identitas model/versi topik.', writerPrompt({ topic, format, packets }));
  } catch (error) {
    throw Object.assign(new Error(`Auto Source gagal menulis draft: ${error.message}`), { status: 502 });
  }

  const writerEval = evaluate(writerRaw, packets, sources, topic);
  let checkerRaw = writerRaw;
  try {
    checkerRaw = await callJson(openai, 'Anda fact-checker dan editor. Jangan izinkan side-note atau sibling version mengambil alih topik.', checkerPrompt({ topic, format, packets, candidate: writerEval.candidate }));
  } catch {}

  const checkerEval = evaluate(checkerRaw, packets, sources, topic);
  let best = checkerEval.errors.length <= writerEval.errors.length ? checkerEval : writerEval;

  if (best.errors.length) {
    try {
      const rescueRaw = await callJson(openai, 'Perbaiki hanya masalah yang disebut dan pertahankan model/versi topik.', checkerPrompt({ topic, format, packets, candidate: best.candidate, errors: best.errors }));
      const rescued = evaluate(rescueRaw, packets, sources, topic);
      if (rescued.errors.length < best.errors.length) best = rescued;
    } catch {}
  }

  const blocking = best.errors.filter(error => !/:point:\d+:/.test(error));
  if (blocking.length) {
    throw Object.assign(new Error(`Auto Source belum bisa menjaga topik spesifik dengan aman: ${blocking[0]}`), {
      status: 422,
      validationErrors: blocking
    });
  }

  return syncTop(best.candidate, topic, format, discovery);
}

module.exports = {
  compose,
  identityCandidates,
  chooseFacts,
  buildSlidePackets,
  writerPrompt,
  checkerPrompt,
  SLIDE_COUNT
};
