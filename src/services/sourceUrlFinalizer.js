const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const manualSourceDedupe = require('./manualSourceDedupe');
const manualSourceFallback = require('./manualSourceFallback');
const {
  sourceFacts,
  requestedListicleCount,
  sourceRichness,
  expandEvidenceForBody,
  compactPoint,
  naturalTitleFromEvidence,
  isLowValueEvidence
} = manualSourceFallback;

// Keep the legacy exported ceiling for compatibility, but Pakai URL now only
// performs one final rewrite pass. Any failure then falls back to source text.
const MAX_FINALIZE_ATTEMPTS = 3;
const FAST_FINALIZE_ATTEMPTS = 1;
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
const visibleCount = slide => [slide?.title, slide?.body, ...(Array.isArray(slide?.points) ? slide.points : [])]
  .reduce((sum, value) => sum + words(value).length, 0);

function defaultSections(format, count) {
  const normalized = String(format || '').trim().toLocaleLowerCase('id-ID');
  if (normalized === 'listicle') return Array.from({ length: count }, (_, index) => `ITEM ${index + 1}`);
  if (normalized === 'tutorial langkah') {
    const middle = Array.from({ length: Math.max(2, count - 2) }, (_, index) => `LANGKAH ${index + 1}`);
    return ['PEMBUKA', ...middle, 'HASIL/PENUTUP'].slice(0, count);
  }
  if (normalized === 'masalah dan solusi') return ['MASALAH', ...Array.from({ length: Math.max(2, count - 2) }, () => 'SOLUSI'), 'PENUTUP'].slice(0, count);
  if (normalized === 'tips cepat') {
    const middle = Array.from({ length: Math.max(2, count - 2) }, (_, index) => `TIPS ${index + 1}`);
    return ['PEMBUKA', ...middle, 'PENUTUP'].slice(0, count);
  }
  if (normalized === 'before-after') {
    const base = ['BEFORE', 'PERUBAHAN', 'AFTER', 'PENUTUP'];
    if (count === 5) base.splice(2, 0, 'KONTEKS');
    return base.slice(0, count);
  }
  const middle = ['FAKTA UTAMA', 'PENJELASAN', 'KONTEKS'];
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return 'PEMBUKA';
    if (index === count - 1) return 'KESIMPULAN';
    return middle[Math.min(index - 1, middle.length - 1)];
  });
}

function targetSections(generated, format, facts, sources = [], topic = '') {
  const normalizedFormat = String(format || '').trim().toLocaleLowerCase('id-ID');
  if (normalizedFormat === 'listicle') {
    const explicitCount = requestedListicleCount(sources, topic);
    if (explicitCount) return defaultSections(format, explicitCount);
  }
  const current = Array.isArray(generated?.slides) ? generated.slides : [];
  if (current.length >= 4 && current.length <= 5 && current.every(slide => String(slide?.section || '').trim())) {
    return current.map(slide => String(slide.section).trim());
  }
  const count = facts.length >= 9 ? 5 : 4;
  return defaultSections(format, count);
}

function groupedFacts(sources, facts) {
  return (sources || []).map((source, index) => {
    const sourceId = `source-${index + 1}`;
    const sourceFactsForId = facts.filter(fact => fact.sourceId === sourceId).slice(0, 24);
    const seenBodies = new Set();
    const bodyFacts = [];
    for (const fact of sourceFactsForId) {
      const evidence = expandEvidenceForBody(source?.text, fact.evidence, 10, 24);
      const key = normalize(evidence);
      if (words(evidence).length < 10 || !key || seenBodies.has(key)) continue;
      seenBodies.add(key);
      bodyFacts.push(evidence);
      if (bodyFacts.length >= 24) break;
    }
    return {
      sourceId,
      title: String(source?.title || '').trim(),
      url: String(source?.finalUrl || source?.url || '').trim(),
      bodyFacts,
      facts: sourceFactsForId.map(fact => fact.evidence)
    };
  });
}

function contentShapeGoalErrors(content, facts) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const profile = sourceRichness(facts, slides.length || 4);
  return slides.flatMap((slide, index) => {
    const errors = [];
    const bodyCount = words(slide?.body).length;
    const points = Array.isArray(slide?.points) ? slide.points : [];
    const count = visibleCount(slide);
    if (bodyCount < profile.bodyMin) errors.push(`slide:${index}:shape-goal: body baru ${bodyCount} kata; wajib minimal ${profile.bodyMin} kata dan target 10–18 kata.`);
    if (points.length < profile.targetPoints) errors.push(`slide:${index}:shape-goal: baru ${points.length} bullet; target ${profile.targetPoints} bullet fakta berbeda.`);
    if (count < profile.visibleGoal) errors.push(`slide:${index}:shape-goal: baru ${count} kata visible; perkaya menuju sekitar ${profile.visibleGoal} tanpa filler.`);
    return errors;
  });
}

const densityGoalErrors = contentShapeGoalErrors;

function qualityScore(content) {
  return (content?.slides || []).reduce((sum, slide) => {
    const points = Array.isArray(slide?.points) ? slide.points.length : 0;
    return sum + visibleCount(slide) + (points * 8);
  }, 0);
}

const densityScore = qualityScore;

function finalizerPrompt({ generated, sources, facts, format, topic, errors }) {
  const sections = targetSections(generated, format, facts, sources, topic);
  const sourceGroups = groupedFacts(sources, facts);
  const profile = sourceRichness(facts, sections.length);
  return `FINAL AI REWRITE — SEMUA URL WAJIB DIPAKAI DAN OUTPUT HARUS NATURAL.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT EFEKTIF: ${JSON.stringify(format)}\nSECTION WAJIB: ${JSON.stringify(sections)}\nTARGET BENTUK SLIDE: judul unik dan spesifik + body minimal ${profile.bodyMin} kata (ideal 10–18) + ${profile.targetPoints} bullet fakta bila source mendukung\nTARGET KEPADATAN NATURAL: sekitar ${profile.visibleGoal} kata visible\nERROR SEBELUMNYA: ${JSON.stringify(errors || [])}\n\nSUMBER DAN FACT BANK PER URL:\n${JSON.stringify(sourceGroups)}\n\nDRAF SAAT INI (BOLEH DIBUANG TOTAL JIKA JELEK/GENERIC):\n${JSON.stringify(generated?.slides || [])}\n\nATURAN KERAS:\n- Tulis ulang seluruh carousel dalam Bahasa Indonesia yang benar-benar natural, enak dibaca, informatif, dan tetap setia pada konteks sumber. Jangan mempertahankan wording draft hanya karena sudah ada.\n- SETIAP sourceId yang tercantum WAJIB menyumbang minimal satu fakta yang terlihat pada body atau bullet. Jangan ada URL yang diabaikan.\n- HANYA gunakan BODY FACT BANK dan FACT BANK di atas. Jangan memakai pengetahuan luar, asumsi, filler, atau klaim yang tidak dinyatakan sumber.\n- JUDUL setiap slide WAJIB spesifik terhadap fakta slide, 3–10 kata bila memungkinkan, unik antar-slide, dan terdengar seperti judul editorial manusia. DILARANG memakai judul generik seperti \"Ringkasan dari sumber\", \"Fakta sumber 2\", \"Poin 3 dari sumber\", \"Kesimpulan dari sumber\", atau variasinya.\n- Jangan sekadar menyalin judul artikel mentah ke setiap slide. Ringkas ide slide menjadi judul yang lebih natural tanpa menambah klaim. Jika judul faktual, sertakan claim title dengan evidence yang mendukung.\n- BODY WAJIB minimal ${profile.bodyMin} kata. Untuk source kaya targetkan 10–18 kata; maksimal 24. Body harus berupa kalimat utuh, bukan potongan metadata atau headline.\n- Untuk claim body, evidence WAJIB PERSIS salah satu entry bodyFacts dari sourceId yang sama. Untuk bullet, evidence WAJIB PERSIS salah satu entry facts dari sourceId yang sama.\n- Setiap body dan setiap bullet WAJIB mempunyai claim dengan field tepat, text PERSIS sama dengan copy terlihat, sourceId benar, dan evidence benar.\n- Evidence boleh berbahasa Inggris, tetapi copy terlihat harus diparafrase/diterjemahkan natural ke Bahasa Indonesia tanpa mengubah makna, angka, modalitas, subjek, sebab-akibat, atau tingkat kepastian.\n- SETIAP angka visible pada title/body/points WAJIB berasal dari evidence untuk claim field yang sama dan dipertahankan PERSIS. Jika evidence tidak memiliki angka, copy claim dilarang menambah angka.\n- Ordinal seperti ke-2, ke-14, pertama, kedua, ketiga, dan seterusnya hanya boleh dipakai bila evidence claim yang sama menyatakan urutan/ordinal itu.\n- Jangan mengubah tahun menjadi jumlah, menyimpulkan ranking/posisi dari jumlah item, atau membuat \"produk ke-N\", \"fitur ke-N\", \"model ke-N\", maupun \"versi ke-N\" hanya karena source menyebut beberapa item.\n- JANGAN memakai evidence canonical yang sama dua kali, baik dalam satu slide maupun lintas slide. Jangan mengulang ide dengan wording berbeda.\n- Untuk source kaya, pola minimum mengikuti contoh produksi: judul yang bagus; satu kalimat body yang menjelaskan konteks utama; lalu 3 bullet fakta pendek yang berbeda.\n- Bullet masing-masing 3–7 kata dan WAJIB berupa frasa/kalimat mini yang utuh. DILARANG mengakhiri bullet dengan kata gantung seperti \"yang\", \"di\", \"dari\", \"oleh\", \"berada\", \"adalah\", \"dengan\", \"untuk\", \"secara\", \"memiliki\", atau \"menjadi\". Jangan memotong kalimat hanya karena batas 7 kata; parafrase menjadi frasa lengkap.\n- Bullet harus menambah informasi baru terhadap body dan bullet lain. Jangan mengulang body dalam bentuk lebih pendek.\n- DILARANG memasukkan nama publisher/byline, tanggal/jam publikasi, WIB/WITA/WIT, URL/link, dateline situs, caption gambar, atau metadata artikel sebagai isi slide.\n- DILARANG memasukkan headline artikel terkait/rekomendasi/Baca Juga, walaupun teks itu muncul di draft lama. Jika fakta tidak ada di FACT BANK bersih, jangan dipakai.\n- Jika ERROR SEBELUMNYA menyebut natural, metadata, duplicate, body pendek, shape-goal, atau richness, perbaiki slide tersebut dengan menulis ulang copy dari evidence yang berbeda.\n- Satu slide = satu ide utama yang koheren. Usahakan body dan seluruh bullet slide berasal dari konteks/sourceId yang sama; campur sourceId hanya bila fakta benar-benar membahas ide yang sama.\n- Pertahankan section PERSIS sesuai SECTION WAJIB. Jika Listicle sumber eksplisit menyebut 4 atau 5 item, jumlah slide harus mengikuti jumlah itu.\n- Untuk LANGKAH/SOLUSI/TIPS, hanya tulis tindakan pengguna bila evidence memang mendukung tindakan itu. Jangan mengubah fitur, risiko, atau tindakan pihak lain menjadi instruksi palsu.\n- Untuk BEFORE/AFTER/HASIL, hubungan perubahan atau outcome hanya boleh ditulis jika evidence mendukung hubungan tersebut.\n- Jangan masukkan Baca Juga, rekomendasi artikel, cookie/privacy policy, newsletter, copyright, sidebar, teaser, atau metadata situs.\n\nKembalikan HANYA JSON:\n{"slides":[{"section":"...","title":"judul natural spesifik","body":"kalimat utuh natural","points":["bullet utuh","bullet utuh","bullet utuh"],"claims":[{"field":"slide:0:title","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:point:0","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
}

function responseJson(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) return content;

  let raw = content;
  if (Array.isArray(content)) {
    if (!content.length || content.some(part => part?.type !== 'text' || typeof part?.text !== 'string')) {
      throw new Error('content array tidak berisi textual JSON yang didukung.');
    }
    raw = content.map(part => part.text).join('');
  }
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('provider output kosong.');

  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  if (!jsonText) throw new Error('provider output kosong setelah normalisasi.');
  return JSON.parse(jsonText);
}

function parseSlides(response, sections) {
  const parsed = responseJson(response);
  if (!Array.isArray(parsed?.slides) || parsed.slides.length !== sections.length) throw new Error('Final AI rewrite mengubah jumlah slide.');
  return parsed.slides.map((slide, index) => {
    const section = String(slide?.section || '').trim();
    if (normalize(section) !== normalize(sections[index])) throw new Error(`Final AI rewrite mengubah section slide ${index + 1}.`);
    return {
      section: sections[index],
      title: String(slide?.title || '').trim(),
      body: String(slide?.body || '').trim(),
      points: Array.isArray(slide?.points) ? slide.points.map(value => String(value || '').trim()).filter(Boolean) : [],
      claims: Array.isArray(slide?.claims) ? slide.claims.map(claim => ({
        field: String(claim?.field || '').trim(),
        text: String(claim?.text || '').trim(),
        sourceId: String(claim?.sourceId || '').trim(),
        evidence: String(claim?.evidence || '').trim()
      })).filter(claim => claim.field || claim.text || claim.sourceId || claim.evidence) : []
    };
  });
}

const ORDINAL_WORDS = new Set([
  'pertama', 'kedua', 'ketiga', 'keempat', 'kelima', 'keenam', 'ketujuh', 'kedelapan', 'kesembilan', 'kesepuluh'
]);

function ordinalTokens(value) {
  const text = String(value || '').toLocaleLowerCase('id-ID');
  const found = text.match(/\bke-?\d+\b/g) || [];
  for (const word of text.match(/[a-z]+/g) || []) if (ORDINAL_WORDS.has(word)) found.push(word);
  return found;
}

function numberTokens(value) {
  return String(value || '').match(/\b\d+(?:[.,]\d+)?%?\b/g) || [];
}

function numericGroundingErrors(content) {
  const errors = [];
  for (const slide of Array.isArray(content?.slides) ? content.slides : []) {
    for (const claim of Array.isArray(slide?.claims) ? slide.claims : []) {
      const text = String(claim?.text || '');
      const evidence = String(claim?.evidence || '');
      const evidenceNumbers = new Set(numberTokens(evidence));
      const unsupportedNumbers = numberTokens(text).filter(number => !evidenceNumbers.has(number));
      const evidenceOrdinals = new Set(ordinalTokens(evidence));
      const unsupportedOrdinals = ordinalTokens(text).filter(ordinal => !evidenceOrdinals.has(ordinal));
      if (unsupportedNumbers.length || unsupportedOrdinals.length) {
        errors.push(`NUMERIC_GROUNDING: angka/ordinal pada claim tidak didukung evidence yang sama: ${text}. Evidence: ${evidence}`);
      }
    }
  }
  return [...new Set(errors)];
}

function syncTop(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  if (!slides.length) return content;
  const first = slides[0];
  const middle = slides.find((slide, index) => index > 0 && (slide.body || slide.points?.length)) || first;
  const last = slides.at(-1);
  const main = slide => String(slide?.body || '').trim() || (slide?.points || []).join(' ').trim() || String(slide?.title || '').trim();
  return {
    ...content,
    hook: String(first?.title || content?.hook || '').trim(),
    body: main(middle),
    caption: main(middle),
    cta: String(last?.title || content?.cta || '').trim()
  };
}

function localLayoutErrors(content) {
  const errors = [];
  (content?.slides || []).forEach((slide, slideIndex) => {
    const titleCount = words(slide?.title).length;
    if (!titleCount || titleCount > 12) errors.push(`slide:${slideIndex}: title harus 1–12 kata.`);
    if (!words(slide?.body).length || words(slide?.body).length > 24) errors.push(`slide:${slideIndex}: body harus 1–24 kata.`);
    if ((slide?.points || []).length > 3) errors.push(`slide:${slideIndex}: maksimal 3 point.`);
    (slide?.points || []).forEach((point, pointIndex) => {
      const count = words(point).length;
      if (count < 3 || count > 7) errors.push(`slide:${slideIndex}:point:${pointIndex}: harus 3–7 kata.`);
    });
  });
  return errors;
}

function rawSeedFact(source, sourceIndex) {
  const sourceId = `source-${sourceIndex + 1}`;
  const text = String(source?.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+/).map(value => value.trim()).filter(Boolean);
  const sentence = sentences.find(value => words(value).length >= 3 && !isLowValueEvidence(value));
  const evidence = sentence || words(text).slice(0, 24).join(' ');
  if (!evidence || words(evidence).length < 3) return null;
  return { sourceId, evidence };
}

function emergencySourceOnlyFallback({ generated = {}, sources = [], topic = '', format = 'Fakta singkat' } = {}) {
  const cleanFacts = sourceFacts(sources);
  const perSource = sources.map((source, index) => {
    const sourceId = `source-${index + 1}`;
    const facts = cleanFacts.filter(fact => fact.sourceId === sourceId);
    if (facts.length) return facts;
    const raw = rawSeedFact(source, index);
    return raw ? [raw] : [];
  });
  if (perSource.some(queue => !queue.length)) return null;

  const allFacts = [];
  const maxDepth = Math.max(...perSource.map(queue => queue.length));
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const queue of perSource) if (queue[depth]) allFacts.push(queue[depth]);
  }
  if (!allFacts.length) return null;

  const resolvedTopic = String(topic || generated?.topic || sources?.[0]?.title || 'Ringkasan sumber').trim();
  const sections = targetSections(generated, format, allFacts, sources, resolvedTopic);
  const slideCount = Math.max(4, Math.min(5, sections.length || 4));
  const used = new Set();
  const selected = [];
  for (const fact of allFacts) {
    const key = `${fact.sourceId}::${normalize(fact.evidence)}`;
    if (used.has(key)) continue;
    used.add(key);
    selected.push(fact);
    if (selected.length >= slideCount) break;
  }
  while (selected.length < slideCount) selected.push(allFacts[selected.length % allFacts.length]);

  const slides = selected.map((fact, slideIndex) => {
    const sourceIndex = Number(String(fact.sourceId).match(/^source-(\d+)$/)?.[1]) - 1;
    const source = sources[sourceIndex] || {};
    const bodyEvidence = expandEvidenceForBody(source.text, fact.evidence, 6, 24) || fact.evidence;
    const body = words(bodyEvidence).slice(0, 24).join(' ').trim();
    const title = naturalTitleFromEvidence(fact.evidence) || words(fact.evidence).slice(0, 8).join(' ');
    return {
      section: sections[slideIndex] || defaultSections(format, slideCount)[slideIndex],
      title: words(title).slice(0, 12).join(' '),
      body,
      points: [],
      claims: [
        { field: `slide:${slideIndex}:title`, text: words(title).slice(0, 12).join(' '), sourceId: fact.sourceId, evidence: bodyEvidence },
        { field: `slide:${slideIndex}:body`, text: body, sourceId: fact.sourceId, evidence: bodyEvidence }
      ]
    };
  });

  const covered = new Set(slides.flatMap(slide => slide.claims.map(claim => claim.sourceId)));
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const sourceId = `source-${sourceIndex + 1}`;
    if (covered.has(sourceId)) continue;
    const fact = perSource[sourceIndex][0];
    let point = compactPoint(fact.evidence);
    if (!point) point = words(fact.evidence).slice(0, 7).join(' ');
    if (words(point).length < 3) continue;
    const slide = slides.find(item => item.points.length < 3);
    if (!slide) return null;
    const slideIndex = slides.indexOf(slide);
    const pointIndex = slide.points.length;
    slide.points.push(point);
    slide.claims.push({ field: `slide:${slideIndex}:point:${pointIndex}`, text: point, sourceId, evidence: fact.evidence });
    covered.add(sourceId);
  }

  const result = syncTop({
    ...generated,
    topic: resolvedTopic,
    effectiveContentFormat: generated?.effectiveContentFormat || format,
    verificationStatus: 'source_based',
    unsupportedClaims: [],
    slides,
    __urlSourceFallback: true
  });
  const safetyErrors = [
    ...manualSourceFallback.validateSourceContent(result, sources),
    ...numericGroundingErrors(result),
    ...localLayoutErrors(result)
  ];
  return safetyErrors.length ? null : result;
}

function buildUrlSourceFallback({ generated = {}, sources = [], topic = '', format = 'Fakta singkat' } = {}) {
  try {
    const deterministic = manualSourceFallback.buildDeterministicSourceFallback({
      generated,
      sources,
      topic,
      requestedFormat: format
    });
    const candidate = syncTop({ ...deterministic, verificationStatus: 'source_based', __urlSourceFallback: true });
    const safetyErrors = [
      ...manualSourceFallback.validateSourceContent(candidate, sources),
      ...numericGroundingErrors(candidate),
      ...localLayoutErrors(candidate)
    ];
    if (!safetyErrors.length) return candidate;
  } catch {}
  return emergencySourceOnlyFallback({ generated, sources, topic, format });
}

async function rewriteAllSourcesWithAi({ generated, sources = [], topic = '', format = 'Fakta singkat', mode = 'manual', contentService, client } = {}) {
  if (!sources.length) throw Object.assign(new Error('Tidak ada URL sumber yang dapat dipakai.'), { status: 422 });

  const cleanedFacts = sourceFacts(sources);
  const seedFacts = cleanedFacts.length
    ? cleanedFacts
    : sources.map((source, index) => rawSeedFact(source, index)).filter(Boolean);
  if (!seedFacts.length) throw Object.assign(new Error('URL tidak menghasilkan teks sumber yang dapat dipakai.'), { status: 422 });

  const effectiveFormat = generated?.effectiveContentFormat || format || 'Fakta singkat';
  const resolvedTopic = String(topic || generated?.topic || sources?.[0]?.title || 'Ringkasan sumber').trim();
  const sections = targetSections(generated, effectiveFormat, seedFacts, sources, resolvedTopic);
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let draft = { ...generated, topic: resolvedTopic };
  let lastErrors = [];

  for (let attempt = 0; attempt < FAST_FINALIZE_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          { role: 'system', content: 'Anda editor final carousel source-grounded. Semua URL wajib dipakai. Hasil harus natural seperti tulisan manusia: judul spesifik, body kalimat utuh, bullet fakta utuh. Metadata, headline terkait, fragment, dan fakta di luar evidence dilarang.' },
          { role: 'user', content: finalizerPrompt({ generated: draft, sources, facts: seedFacts, format: effectiveFormat, topic: resolvedTopic, errors: lastErrors }) }
        ],
        response_format: { type: 'json_object' }
      });
      draft = syncTop({ ...draft, slides: parseSlides(response, sections), verificationStatus: 'source_based' });
    } catch (error) {
      lastErrors = [`PROVIDER_OUTPUT_INVALID: provider output invalid: ${error.message}`];
      break;
    }

    const checked = sourceFilter.validateVerifiedContent(draft, { slides: draft.slides }, {
      contentService,
      format: effectiveFormat,
      manualTopic: mode === 'manual' ? resolvedTopic : '',
      sources,
      autoSourceTopic: mode === 'ai'
    });
    const deterministicErrors = [
      ...numericGroundingErrors(draft),
      ...checked.errors,
      ...manualSourceFallback.validateSourceContent(checked.content || draft, sources),
      ...manualSourceDedupe.manualCrossSlideDuplicateErrors(checked.content || draft),
      ...localLayoutErrors(checked.content || draft)
    ];
    if (deterministicErrors.length) {
      lastErrors = [...new Set(deterministicErrors)];
      draft = checked.content || draft;
      break;
    }

    const semanticErrors = await sourceFilter.auditClaimSemantics(openai, checked.content, resolvedTopic, effectiveFormat);
    if (semanticErrors.length) {
      lastErrors = semanticErrors;
      draft = checked.content;
      break;
    }

    // Once the candidate is grounded, return immediately. Richness is a quality
    // target, not a reason to make Pakai URL perform extra AI rewrite rounds.
    return syncTop(checked.content);
  }

  const fallback = buildUrlSourceFallback({
    generated: draft,
    sources,
    topic: resolvedTopic,
    format: effectiveFormat
  });
  if (fallback) return fallback;

  throw Object.assign(new Error(`Final AI rewrite semua URL belum lolos: ${lastErrors[0] || 'URL tidak menyediakan teks yang dapat dipakai dengan aman'}`), {
    status: 422,
    validationErrors: lastErrors
  });
}

module.exports = {
  rewriteAllSourcesWithAi,
  finalizerPrompt,
  parseSlides,
  responseJson,
  numericGroundingErrors,
  targetSections,
  groupedFacts,
  contentShapeGoalErrors,
  densityGoalErrors,
  qualityScore,
  densityScore,
  buildUrlSourceFallback,
  emergencySourceOnlyFallback,
  FAST_FINALIZE_ATTEMPTS,
  MAX_FINALIZE_ATTEMPTS
};