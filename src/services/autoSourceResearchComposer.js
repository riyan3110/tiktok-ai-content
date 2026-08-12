const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const { sourceFacts } = require('./manualSourceFallback');
const simple = require('./autoSourceSimpleComposer');

// TANPA URL / AUTO SOURCE ONLY.
// Research-style production path:
// all source facts -> semantic dedupe -> four distinct anchors -> writer -> checker/editor -> one targeted rescue if needed.
const SLIDE_COUNT = 4;
const STRICT_DUPLICATE_THRESHOLD = 0.58;
const RELAXED_DUPLICATE_THRESHOLD = 0.76;
const VISIBLE_DUPLICATE_THRESHOLD = 0.64;

const STOPWORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','dalam','ini','itu','adalah','merupakan','akan','bisa','dapat',
  'di','ke','oleh','sebagai','lebih','juga','telah','sudah','sebuah','para','fitur','layanan','aplikasi','produk','update','baru',
  'the','and','or','to','of','in','on','for','with','from','is','are','was','were','will','can','could','has','have','had','a','an',
  'this','that','these','those','now','new','feature','service','app','application','product','more','also'
]);

const OVERVIEW = /\b(?:diluncurkan|dirilis|diperluas|tersedia|hadir|meluncurkan|merilis|memperluas|launch(?:ed|es)?|roll(?:ed)?\s*out|available|expand(?:ed|s|ing)?|introduc(?:ed|es|ing))\b/i;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9%.,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value) {
  return clean(value).split(/\s+/).filter(Boolean);
}

function meaningfulTokens(value) {
  return [...new Set(normalize(value).replace(/[.,]/g, ' ').split(' ')
    .filter(token => token && !STOPWORDS.has(token) && (token.length > 2 || token === 'ai' || /^\d/.test(token))))];
}

function canonicalNumbers(value) {
  const values = [];
  const pattern = /\b(\d+(?:[.,]\d+)?)(?:\s*(%|persen|percent|per\s+cent))?/gi;
  for (const match of String(value || '').matchAll(pattern)) {
    let number = String(match[1]).replace(',', '.').replace(/0+$/, '').replace(/\.$/, '');
    values.push(`${number}${match[2] ? '%' : ''}`);
  }
  return values;
}

function contextualTokens(value, topic = '') {
  const topicTokens = new Set(meaningfulTokens(topic));
  return meaningfulTokens(value).filter(token => !topicTokens.has(token));
}

function contextSimilarity(left, right, topic = '') {
  const a = contextualTokens(left, topic);
  const b = contextualTokens(right, topic);
  if (!a.length || !b.length) return 0;
  const shared = a.filter(token => b.includes(token));
  let score = shared.length / Math.min(a.length, b.length);

  const aNumbers = canonicalNumbers(left);
  const bNumbers = new Set(canonicalNumbers(right));
  const sharedNumber = aNumbers.some(number => bNumbers.has(number));
  const sharedNonNumber = shared.filter(token => !/^\d/.test(token)).length;
  if (sharedNumber && sharedNonNumber >= 1) score = Math.max(score, 0.84);
  return score;
}

function sourceForId(sources, sourceId) {
  const match = String(sourceId || '').match(/^source-(\d+)$/);
  const index = match ? Number(match[1]) - 1 : -1;
  return index >= 0 ? sources[index] || null : null;
}

function topicOverlap(topic, evidence) {
  const wanted = meaningfulTokens(topic);
  if (!wanted.length) return 0;
  const available = new Set(meaningfulTokens(evidence));
  return wanted.filter(token => available.has(token)).length / wanted.length;
}

function buildFactCandidates(sources = [], topic = '') {
  const ranked = sourceFilter.extractFactBank(sources, topic);
  const fallback = sourceFacts(sources);
  const merged = [...ranked, ...fallback];
  const seen = new Set();
  const candidates = [];

  merged.forEach((fact, order) => {
    const sourceId = clean(fact?.sourceId);
    const evidence = clean(fact?.evidence);
    if (!sourceId || !evidence || words(evidence).length < 5) return;
    const key = `${sourceId}|${normalize(evidence)}`;
    if (seen.has(key)) return;
    seen.add(key);

    const source = sourceForId(sources, sourceId) || {};
    const extraTokens = contextualTokens(evidence, topic).length;
    const discoveryScore = Number(source?.discovery?.score || 0);
    const score = topicOverlap(topic, evidence) * 6
      + Math.min(extraTokens, 14) * 0.1
      + Math.min(canonicalNumbers(evidence).length, 2) * 0.35
      + Math.max(0, 1.2 - order * 0.025)
      + Math.min(1.5, Math.max(0, discoveryScore) * 0.015)
      + (OVERVIEW.test(evidence) ? 0.55 : 0);

    candidates.push({
      sourceId,
      evidence,
      score,
      order,
      sourceTitle: clean(source.title),
      publishedAt: source.publishedAt || source.discovery?.publishedAt || null
    });
  });

  return candidates.sort((a, b) => b.score - a.score || a.order - b.order);
}

function chooseNext(candidates, selected, sourceUses, threshold, topic) {
  let best = null;
  for (const candidate of candidates) {
    if (selected.includes(candidate)) continue;
    if (selected.some(existing => contextSimilarity(existing.evidence, candidate.evidence, topic) >= threshold)) continue;
    const uses = sourceUses.get(candidate.sourceId) || 0;
    const adjusted = candidate.score + (uses === 0 ? 0.35 : 0) - Math.max(0, uses - 1) * 0.18;
    if (!best || adjusted > best.adjusted) best = { candidate, adjusted };
  }
  return best?.candidate || null;
}

function selectDistinctFacts(sources = [], topic = '', count = SLIDE_COUNT) {
  const candidates = buildFactCandidates(sources, topic);
  const selected = [];
  const sourceUses = new Map();

  // Prefer one launch/availability overview for slide 1 when a strong one exists.
  const overview = candidates.find(candidate => OVERVIEW.test(candidate.evidence));
  if (overview) {
    selected.push(overview);
    sourceUses.set(overview.sourceId, 1);
  }

  for (const threshold of [STRICT_DUPLICATE_THRESHOLD, RELAXED_DUPLICATE_THRESHOLD, 0.9]) {
    while (selected.length < count) {
      const next = chooseNext(candidates, selected, sourceUses, threshold, topic);
      if (!next) break;
      selected.push(next);
      sourceUses.set(next.sourceId, (sourceUses.get(next.sourceId) || 0) + 1);
    }
    if (selected.length >= count) break;
  }

  if (!selected.length && candidates.length) selected.push(candidates[0]);
  return selected.slice(0, count);
}

function buildSlidePackets(sources = [], topic = '', format = 'Fakta singkat') {
  const selected = selectDistinctFacts(sources, topic, SLIDE_COUNT);
  const sections = simple.sectionsForFormat(format);
  return selected.map((fact, slideIndex) => ({
    slideIndex,
    section: sections[slideIndex],
    primarySourceId: fact.sourceId,
    sourceTitle: fact.sourceTitle,
    publishedAt: fact.publishedAt,
    mainEvidence: fact.evidence,
    evidence: [fact.evidence]
  }));
}

function writerPrompt({ topic, format, packets }) {
  return `AUTO SOURCE RISET — TANPA URL.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nEMPAT FAKTA UTAMA YANG SUDAH DIDEDUPLIKASI:\n${JSON.stringify(packets)}\n\nTulis carousel 4 slide dalam BAHASA INDONESIA NATURAL.\n\nATURAN KERAS:\n- Setiap slide WAJIB menjelaskan mainEvidence milik slide itu. Jangan memilih fakta lain sebagai topik utama.\n- Empat mainEvidence sudah dipilih karena berbeda. Pertahankan empat sudut yang berbeda; jangan menyamaratakan dua slide menjadi konteks generik yang sama.\n- Gunakan HANYA evidence pada packet slide. Jangan memakai pengetahuan luar.\n- Evidence boleh bahasa Inggris, tetapi SEMUA copy tampil (title, body, points) WAJIB Bahasa Indonesia. Terjemahkan/parafrase maknanya; JANGAN salin satu kalimat Inggris utuh ke body/bullet.\n- Nama produk, perusahaan, model, singkatan, dan istilah teknis boleh tetap asli.\n- Title harus spesifik terhadap fakta slide, bukan judul generik.\n- Body padat 9-16 kata agar muat desain. Pertahankan angka, negara, nama, modalitas, dan ketidakpastian persis secara makna.\n- Bullet TIDAK wajib. Gunakan 0-2 bullet, maksimal 7 kata per bullet, hanya jika evidence yang sama memang memuat detail tambahan yang berbeda.\n- Jangan ulang fakta body di bullet. Jangan ulang fakta slide lain.\n- Jangan mengubah tool/fitur menjadi aplikasi mandiri, model menjadi aplikasi, atau jenis entitas lainnya.\n- Jangan menambah manfaat, sebab-akibat, tujuan, angka, versi, lokasi, tanggal, atau kepastian yang tidak disebut evidence.\n- Body dan setiap bullet wajib punya claim: text sama persis dengan copy tampil, sourceId sama dengan primarySourceId, evidence VERBATIM sama dengan mainEvidence packet.\n- Title tidak perlu claim, tetapi tidak boleh menambah fakta di luar body/evidence.\n\nKembalikan HANYA JSON:\n{"slides":[{"title":"...","body":"...","points":[],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
}

function checkerPrompt({ topic, format, packets, candidate, errors = [] }) {
  return `FACT-CHECKER + EDITOR AUTO SOURCE.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nFAKTA UTAMA PER SLIDE:\n${JSON.stringify(packets)}\n\nDRAFT:\n${JSON.stringify(candidate?.slides || [])}\n${errors.length ? `\nMASALAH YANG HARUS DIPERBAIKI:\n${JSON.stringify(errors)}\n` : ''}\nTUGAS:\nPerbaiki draft langsung. Jangan mengubah fakta utama antar-slide.\n\nWAJIB:\n- Slide N hanya boleh membahas mainEvidence slide N.\n- Empat slide harus punya empat konteks/fakta berbeda. Bila dua slide terdengar membahas hal sama, tulis ulang agar kembali ke mainEvidence masing-masing.\n- SEMUA title/body/points harus Bahasa Indonesia natural. Evidence Inggris hanya untuk verifikasi dan tidak boleh ditempel mentah sebagai copy tampil.\n- Jika body melampaui makna evidence, sempitkan ke klaim yang benar-benar dinyatakan evidence.\n- Jika bullet meragukan, berulang, atau tidak penting, HAPUS. Bullet 0-2 boleh.\n- Body 9-16 kata; bullet maksimal 7 kata.\n- Pertahankan entity type, angka, persentase, tanggal, lokasi, daftar, modalitas, negasi, dan ketidakpastian sesuai evidence.\n- claim.text harus sama persis dengan copy; sourceId harus primarySourceId; evidence harus VERBATIM mainEvidence packet.\n- Jangan menambah pengetahuan luar.\n\nKembalikan HANYA JSON final dengan schema {"slides":[...]}.`;
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

function visibleLanguageErrors(candidate = {}) {
  const errors = [];
  (candidate.slides || []).forEach((slide, slideIndex) => {
    const fields = [
      ['title', slide.title],
      ['body', slide.body],
      ...(slide.points || []).map((point, pointIndex) => [`point:${pointIndex}`, point])
    ];
    for (const [field, value] of fields) {
      if (sourceFilter.likelyEnglishDisplayText(value)) errors.push(`LANGUAGE: slide:${slideIndex}:${field} masih berupa kalimat Inggris.`);
    }
  });
  return errors;
}

function duplicateContextErrors(candidate = {}, topic = '') {
  const errors = [];
  const slides = candidate.slides || [];
  for (let right = 1; right < slides.length; right += 1) {
    const rightText = [slides[right]?.title, slides[right]?.body, ...(slides[right]?.points || [])].filter(Boolean).join(' ');
    for (let left = 0; left < right; left += 1) {
      const leftText = [slides[left]?.title, slides[left]?.body, ...(slides[left]?.points || [])].filter(Boolean).join(' ');
      if (contextSimilarity(leftText, rightText, topic) >= VISIBLE_DUPLICATE_THRESHOLD) {
        errors.push(`DUPLICATE_CONTEXT: slide:${right} mengulang inti slide:${left}.`);
        break;
      }
    }
  }
  return errors;
}

function evaluate(raw, packets, sources, topic) {
  const normalized = simple.normalizeCandidate(raw, packets);
  const finalized = simple.finalizeVisibleCopy(normalized, packets, sources);
  const errors = [
    ...finalized.errors,
    ...visibleLanguageErrors(finalized.candidate),
    ...duplicateContextErrors(finalized.candidate, topic)
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
    hook_pattern: 'auto-source-research',
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
  if (!sources.length) throw Object.assign(new Error('Auto Source tidak menemukan sumber yang dapat dibaca.'), { status: 422 });
  const topic = clean(options.requestedTopic || discovery?.topic || sources[0]?.title || 'Topik sumber');
  const format = options.contentFormat || 'Fakta singkat';
  const packets = buildSlidePackets(sources, topic, format);
  if (packets.length !== SLIDE_COUNT) {
    throw Object.assign(new Error(`Auto Source hanya menemukan ${packets.length} fakta unik yang cukup kuat; butuh ${SLIDE_COUNT}.`), { status: 422 });
  }

  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let writerRaw;
  try {
    writerRaw = await callJson(
      openai,
      'Anda penulis carousel Indonesia. Empat fakta utama sudah dipilih; jangan mengarang, jangan menyalin kalimat Inggris ke copy tampil, dan jangan menyatukan konteks antar-slide.',
      writerPrompt({ topic, format, packets })
    );
  } catch (error) {
    throw Object.assign(new Error(`Auto Source gagal menulis draft: ${error.message}`), { status: 502 });
  }

  const writerEval = evaluate(writerRaw, packets, sources, topic);
  let checkerRaw = writerRaw;
  try {
    checkerRaw = await callJson(
      openai,
      'Anda fact-checker sekaligus editor Bahasa Indonesia. Pastikan tiap slide mengikuti fakta utamanya sendiri dan semua copy tampil berbahasa Indonesia.',
      checkerPrompt({ topic, format, packets, candidate: writerEval.candidate })
    );
  } catch {}

  const checkerEval = evaluate(checkerRaw, packets, sources, topic);
  let best = checkerEval.errors.length <= writerEval.errors.length ? checkerEval : writerEval;

  // Exactly one targeted rescue, only when something concrete is still wrong.
  if (best.errors.length) {
    try {
      const rescueRaw = await callJson(
        openai,
        'Perbaiki hanya masalah yang disebut. Jangan mengubah fakta utama, jangan menambah fakta, dan pastikan copy tampil Bahasa Indonesia.',
        checkerPrompt({ topic, format, packets, candidate: best.candidate, errors: best.errors })
      );
      const rescued = evaluate(rescueRaw, packets, sources, topic);
      if (rescued.errors.length < best.errors.length) best = rescued;
    } catch {}
  }

  const blocking = best.errors.filter(error => !/:point:\d+:/.test(error));
  if (blocking.length) {
    throw Object.assign(new Error(`Auto Source belum bisa menyusun empat fakta unik dengan aman: ${blocking[0]}`), {
      status: 422,
      validationErrors: blocking
    });
  }

  return syncTop(best.candidate, topic, format, discovery);
}

module.exports = {
  compose,
  buildFactCandidates,
  selectDistinctFacts,
  buildSlidePackets,
  contextSimilarity,
  visibleLanguageErrors,
  duplicateContextErrors,
  writerPrompt,
  checkerPrompt,
  SLIDE_COUNT,
  STRICT_DUPLICATE_THRESHOLD,
  VISIBLE_DUPLICATE_THRESHOLD
};
