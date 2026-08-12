const OpenAI = require('openai');
const config = require('../config');
const research = require('./autoSourceResearchComposer');
const simple = require('./autoSourceSimpleComposer');
const multi = require('./autoSourceMultiEntityTopic');
const identity = require('./autoSourceTopicIdentity');

// TANPA URL / AUTO SOURCE ONLY.
// For explicit named-entity topics such as "CoreWeave dan Super Micro":
// filter side notes -> balance entity coverage -> select distinct facts -> write.
const SLIDE_COUNT = 4;
const DUPLICATE_THRESHOLDS = [0.58, 0.76, 0.9];

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function candidateEntityInfo(candidate, topic) {
  const matched = multi.matchedEntities(topic, candidate?.evidence || '');
  return {
    ...candidate,
    matchedEntities: matched,
    marketPenalty: multi.marketSnapshotPenalty(topic, candidate?.evidence || ''),
    adjustedScore: Number(candidate?.score || 0) + matched.length * 1.25 - multi.marketSnapshotPenalty(topic, candidate?.evidence || '')
  };
}

function buildEntityCandidates(sources = [], topic = '') {
  return research.buildFactCandidates(sources, topic)
    .map(candidate => candidateEntityInfo(candidate, topic))
    .filter(candidate => candidate.matchedEntities.length > 0)
    .filter(candidate => !identity.relativeTimeMetadata(candidate.evidence))
    .filter(candidate => !multi.isRoundupSideNote(topic, candidate.evidence))
    .sort((a, b) => b.adjustedScore - a.adjustedScore || a.order - b.order);
}

function distinctEnough(candidate, selected, topic, threshold) {
  return !selected.some(existing => research.contextSimilarity(existing.evidence, candidate.evidence, topic) >= threshold);
}

function chooseBest(candidates, selected, topic, predicate = () => true) {
  for (const threshold of DUPLICATE_THRESHOLDS) {
    const available = candidates
      .filter(candidate => !selected.includes(candidate))
      .filter(candidate => predicate(candidate))
      .filter(candidate => distinctEnough(candidate, selected, topic, threshold))
      .sort((a, b) => b.adjustedScore - a.adjustedScore || a.order - b.order);
    if (available.length) return available[0];
  }
  return null;
}

function coverageCounts(selected, entities) {
  const counts = new Map(entities.map(entity => [entity, 0]));
  selected.forEach(candidate => {
    candidate.matchedEntities.forEach(entity => counts.set(entity, (counts.get(entity) || 0) + 1));
  });
  return counts;
}

function selectBalancedFacts(sources = [], topic = '', count = SLIDE_COUNT) {
  const entities = multi.entities(topic);
  if (entities.length < 2) return research.selectDistinctFacts(sources, topic, count);
  const candidates = buildEntityCandidates(sources, topic);
  const selected = [];

  // A true relationship/comparison fact is useful as framing, but a transient
  // stock-market snapshot should not win just because it mentions both names.
  const shared = chooseBest(candidates, selected, topic, candidate =>
    candidate.matchedEntities.length === entities.length && candidate.marketPenalty < 2.5
  );
  if (shared) selected.push(shared);

  // Guarantee each requested entity contributes a dedicated fact before one
  // company can dominate the carousel.
  for (const entity of entities) {
    if (selected.length >= count) break;
    const dedicated = chooseBest(candidates, selected, topic, candidate =>
      candidate.matchedEntities.length === 1 && candidate.matchedEntities[0] === entity
    ) || chooseBest(candidates, selected, topic, candidate => candidate.matchedEntities.includes(entity));
    if (dedicated) selected.push(dedicated);
  }

  while (selected.length < count) {
    const counts = coverageCounts(selected, entities);
    const minimum = Math.min(...entities.map(entity => counts.get(entity) || 0));
    const underCovered = entities.filter(entity => (counts.get(entity) || 0) === minimum);
    const next = chooseBest(candidates, selected, topic, candidate =>
      candidate.matchedEntities.some(entity => underCovered.includes(entity))
    ) || chooseBest(candidates, selected, topic);
    if (!next) break;
    selected.push(next);
  }

  return selected.slice(0, count);
}

function sectionForPacket(fact, index, entities) {
  if (fact.matchedEntities.length === entities.length) return index === 0 ? 'PEMBUKA' : 'KONTEKS BERSAMA';
  if (fact.matchedEntities.length === 1) return fact.matchedEntities[0].toLocaleUpperCase('id-ID').slice(0, 20);
  return index === 0 ? 'PEMBUKA' : 'KONTEKS';
}

function buildSlidePackets(sources = [], topic = '', format = 'Fakta singkat') {
  const entities = multi.entities(topic);
  const selected = selectBalancedFacts(sources, topic, SLIDE_COUNT);
  return selected.map((fact, slideIndex) => ({
    slideIndex,
    section: String(format || '').toLocaleLowerCase('id-ID') === 'fakta singkat'
      ? sectionForPacket(fact, slideIndex, entities)
      : simple.sectionsForFormat(format)[slideIndex],
    primarySourceId: fact.sourceId,
    sourceTitle: fact.sourceTitle,
    publishedAt: fact.publishedAt,
    targetEntities: fact.matchedEntities,
    mainEvidence: fact.evidence,
    evidence: [fact.evidence]
  }));
}

function writerPrompt({ topic, format, packets }) {
  const entities = multi.entities(topic);
  const marketRule = multi.marketIntent(topic)
    ? '- Topik memang meminta konteks pasar/saham; angka pasar boleh dipakai bila evidence mendukung.'
    : '- Topik TIDAK meminta saham/pasar. Jangan menjadikan pergerakan harga harian sebagai inti bila packet memuat fakta operasional/produk/infrastruktur yang lebih substantif.';
  return `AUTO SOURCE MULTI-ENTITY — TANPA URL.\n\nTOPIK: ${JSON.stringify(topic)}\nENTITAS WAJIB: ${JSON.stringify(entities)}\nFORMAT: ${JSON.stringify(format)}\nPAKET FAKTA TERPILIH:\n${JSON.stringify(packets)}\n\nTulis carousel 4 slide dalam Bahasa Indonesia natural.\n\nATURAN KERAS:\n- Carousel harus membahas SEMUA entitas pada ENTITAS WAJIB secara seimbang. Jangan biarkan satu entitas mengambil hampir semua slide.\n- Setiap slide hanya menjelaskan mainEvidence milik packet-nya. targetEntities menunjukkan entitas yang menjadi subjek slide itu.\n- Bila packet hanya menargetkan satu entitas, nama entitas itu harus muncul natural pada title atau body.\n- Bila packet menargetkan dua entitas, jelaskan hubungan/perbandingan yang benar-benar dinyatakan evidence; jangan menciptakan hubungan baru.\n- Abaikan side-note lain dalam artikel yang tidak terkait targetEntities. Jangan membawa emas, Bitcoin, indeks, atau aset lain hanya karena muncul di artikel pasar.\n${marketRule}\n- Semua title/body/points tampil Bahasa Indonesia. Nama perusahaan/model/produk dan istilah teknis boleh tetap asli.\n- Body padat 9-16 kata. Bullet 0-2, maksimal 7 kata, hanya bila menambah detail unik dari evidence yang sama.\n- Jangan ulang fakta body di bullet atau fakta slide lain.\n- Pertahankan angka, harga, persentase, tanggal, modalitas, dan negasi persis sesuai evidence.\n- Jangan menambah manfaat, sebab-akibat, hubungan bisnis, produk, atau kesimpulan yang tidak disebut evidence.\n- Body dan bullet wajib punya claim: text sama persis dengan copy tampil, sourceId sama dengan primarySourceId, evidence VERBATIM sama dengan mainEvidence packet.\n- Title tidak perlu claim, tetapi tidak boleh menambah fakta baru.\n\nKembalikan HANYA JSON {"slides":[{"title":"...","body":"...","points":[],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}.`;
}

function checkerPrompt({ topic, format, packets, candidate, errors = [] }) {
  const entities = multi.entities(topic);
  return `FACT-CHECKER + EDITOR MULTI-ENTITY.\n\nTOPIK: ${JSON.stringify(topic)}\nENTITAS WAJIB: ${JSON.stringify(entities)}\nFORMAT: ${JSON.stringify(format)}\nPACKETS:\n${JSON.stringify(packets)}\nDRAFT:\n${JSON.stringify(candidate?.slides || [])}\n${errors.length ? `MASALAH:\n${JSON.stringify(errors)}\n` : ''}\nPerbaiki draft langsung.\n\nWAJIB:\n- Semua entitas wajib tetap terwakili dan tidak boleh ada satu entitas mendominasi hampir seluruh carousel.\n- Slide N hanya boleh membahas mainEvidence packet N dan targetEntities packet N.\n- Hapus side-note yang tidak terkait, termasuk komoditas/crypto/indeks yang hanya kebetulan berada di artikel yang sama.\n- Jika topik tidak meminta saham/pasar, jangan ubah carousel menjadi ringkasan pergerakan harga harian.\n- Semua copy tampil Bahasa Indonesia natural.\n- Body 9-16 kata; bullet 0-2, maksimal 7 kata.\n- Hapus bullet yang meragukan, berulang, atau tidak penting.\n- claim.text harus sama persis dengan copy; sourceId/evidence harus tetap milik packet.\n- Jangan menambah fakta di luar evidence.\n\nKembalikan HANYA JSON final dengan schema {"slides":[...]}.`;
}

function entityCoverageErrors(candidate = {}, packets = [], topic = '') {
  const errors = [];
  const entities = multi.entities(topic);
  const seen = new Map(entities.map(entity => [entity, 0]));
  (candidate.slides || []).forEach((slide, slideIndex) => {
    const packet = packets[slideIndex];
    const visible = [slide?.title, slide?.body, ...(slide?.points || [])].filter(Boolean).join(' ');
    const expected = packet?.targetEntities || [];
    for (const entity of expected) {
      if (!multi.entityMatches(entity, visible)) errors.push(`ENTITY_SCOPE: slide:${slideIndex} tidak menyebut entitas utama ${entity}.`);
      else seen.set(entity, (seen.get(entity) || 0) + 1);
    }
  });
  for (const entity of entities) {
    if ((seen.get(entity) || 0) < 1) errors.push(`ENTITY_COVERAGE: ${entity} tidak terwakili di carousel.`);
  }
  return errors;
}

function evaluate(raw, packets, sources, topic) {
  const normalized = simple.normalizeCandidate(raw, packets);
  const finalized = simple.finalizeVisibleCopy(normalized, packets, sources);
  const errors = [
    ...finalized.errors,
    ...research.visibleLanguageErrors(finalized.candidate),
    ...research.duplicateContextErrors(finalized.candidate, topic),
    ...entityCoverageErrors(finalized.candidate, packets, topic)
  ];
  return { candidate: finalized.candidate, errors: [...new Set(errors)] };
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
    hook_pattern: 'auto-source-multi-entity',
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
  if (!multi.hasMultiEntityTopic(topic)) return research.compose({ options, sources, discovery, client });
  if (!sources.length) throw Object.assign(new Error('Auto Source tidak menemukan sumber yang dapat dibaca.'), { status: 422 });

  const format = options.contentFormat || 'Fakta singkat';
  const packets = buildSlidePackets(sources, topic, format);
  if (packets.length !== SLIDE_COUNT) {
    throw Object.assign(new Error(`Auto Source hanya menemukan ${packets.length} fakta unik yang relevan dan seimbang untuk ${multi.entities(topic).join(' + ')}; butuh ${SLIDE_COUNT}.`), {
      status: 422,
      code: 'AUTO_SOURCE_MULTI_ENTITY_FACTS'
    });
  }

  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let writerRaw;
  try {
    writerRaw = await callJson(openai, 'Anda penulis carousel Indonesia. Jaga cakupan dua entitas tetap seimbang dan buang side-note artikel.', writerPrompt({ topic, format, packets }));
  } catch (error) {
    throw Object.assign(new Error(`Auto Source gagal menulis draft: ${error.message}`), { status: 502 });
  }

  const writerEval = evaluate(writerRaw, packets, sources, topic);
  let checkerRaw = writerRaw;
  try {
    checkerRaw = await callJson(openai, 'Anda fact-checker/editor. Setiap slide harus tetap pada entitas dan evidence packet-nya.', checkerPrompt({ topic, format, packets, candidate: writerEval.candidate }));
  } catch {}

  const checkerEval = evaluate(checkerRaw, packets, sources, topic);
  let best = checkerEval.errors.length <= writerEval.errors.length ? checkerEval : writerEval;
  if (best.errors.length) {
    try {
      const rescueRaw = await callJson(openai, 'Perbaiki hanya masalah konkret yang disebut; jangan menambah fakta atau side-note.', checkerPrompt({ topic, format, packets, candidate: best.candidate, errors: best.errors }));
      const rescued = evaluate(rescueRaw, packets, sources, topic);
      if (rescued.errors.length < best.errors.length) best = rescued;
    } catch {}
  }

  const blocking = best.errors.filter(error => !/:point:\d+:/.test(error));
  if (blocking.length) {
    throw Object.assign(new Error(`Auto Source belum bisa menjaga cakupan multi-entitas dengan aman: ${blocking[0]}`), {
      status: 422,
      validationErrors: blocking
    });
  }
  return syncTop(best.candidate, topic, format, discovery);
}

module.exports = {
  compose,
  buildEntityCandidates,
  selectBalancedFacts,
  buildSlidePackets,
  entityCoverageErrors,
  writerPrompt,
  checkerPrompt,
  SLIDE_COUNT
};
