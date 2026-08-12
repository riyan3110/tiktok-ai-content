const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const manualSourceDedupe = require('./manualSourceDedupe');
const manualSourceFallback = require('./manualSourceFallback');
const {
  sourceFacts,
  requestedListicleCount,
  sourceRichness,
  compactPoint,
  naturalTitleFromEvidence,
  isLowValueEvidence
} = manualSourceFallback;

// Pakai URL gets one normal pass plus at most one focused correction. This is
// deliberately bounded: valid content still completes after the first call.
const MAX_FINALIZE_ATTEMPTS = 3;
const FAST_FINALIZE_ATTEMPTS = 2;
const URL_SAFE_WIDTH = 740;
const TOPIC_STOP = new Set([
  'yang','dan','atau','dari','untuk','dengan','pada','dalam','adalah','ini','itu','sebagai','oleh','akan','bisa','dapat','telah','sudah','lebih','juga',
  'cara','ubah','terbaru','baru','update','fakta','tips','tutorial','edukasi','pendidikan','teknologi','artificial','intelligence','ai'
]);
const DANGLING_END = new Set(['yang','dan','atau','di','ke','dari','dengan','oleh','pada','untuk','sebagai','secara','adalah','merupakan','berada','memiliki','menjadi','termasuk','maupun','karena','agar','jika','bila','saat','ketika','dalam']);
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '').trim().toLocaleLowerCase('id-ID').replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
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

function topicTerms(value) {
  return [...new Set(normalize(value).split(' ').filter(token => token.length >= 4 && !TOPIC_STOP.has(token)))];
}

function relevantSourceFacts(sources, facts, topic) {
  const bySource = new Map();
  for (const fact of facts) {
    if (!bySource.has(fact.sourceId)) bySource.set(fact.sourceId, []);
    bySource.get(fact.sourceId).push(fact);
  }
  const selected = [];
  for (const [sourceIndex, source] of (sources || []).entries()) {
    const sourceId = `source-${sourceIndex + 1}`;
    const entries = bySource.get(sourceId) || [];
    if (!entries.length) continue;
    const wanted = topicTerms(`${topic} ${source?.title || ''}`);
    if (!wanted.length) { selected.push(...entries); continue; }

    const documentFrequency = new Map(wanted.map(term => [term, 0]));
    const entryTokens = entries.map(entry => new Set(normalize(entry.evidence).split(' ').filter(Boolean)));
    for (const tokens of entryTokens) for (const term of wanted) if (tokens.has(term)) documentFrequency.set(term, documentFrequency.get(term) + 1);
    const scored = entries.map((entry, index) => {
      let score = 0;
      for (const term of wanted) if (entryTokens[index].has(term)) {
        const df = documentFrequency.get(term) || 0;
        score += 1 + Math.log((entries.length + 1) / (df + 1));
      }
      return { entry, index, score };
    });
    const positive = scored.filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    if (positive.length >= Math.min(4, entries.length)) {
      const keep = new Set(positive.slice(0, Math.min(18, Math.max(6, positive.length))).map(item => item.entry));
      selected.push(...entries.filter(entry => keep.has(entry)));
    } else selected.push(...entries);
  }
  return selected.length >= 4 ? selected : facts;
}

function measureTextWidth(text, fontSize, bold = false) {
  let em = 0;
  for (const character of String(text)) {
    if (/\s/.test(character)) em += 0.28;
    else if (/[ilI1.,'`:;!|]/.test(character)) em += 0.27;
    else if (/[MW@%&mw]/.test(character)) em += 0.88;
    else if (/[A-Z0-9]/.test(character)) em += 0.64;
    else em += 0.54;
  }
  return em * fontSize * (bold ? 1.04 : 1);
}

function wrappedLines(text, fontSize, bold = false) {
  const lines = [];
  for (const paragraph of String(text || '').trim().split(/\n+/)) {
    const tokens = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (let token of tokens) {
      const candidate = line ? `${line} ${token}` : token;
      if (measureTextWidth(candidate, fontSize, bold) <= URL_SAFE_WIDTH) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      while (measureTextWidth(token, fontSize, bold) > URL_SAFE_WIDTH) {
        let end = 1;
        while (end < token.length && measureTextWidth(token.slice(0, end + 1), fontSize, bold) <= URL_SAFE_WIDTH) end += 1;
        lines.push(token.slice(0, end));
        token = token.slice(end);
      }
      line = token;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function textFitsCanvas(text, { startSize, minSize, maxLines, maxHeight, lineHeight }) {
  for (let fontSize = startSize; fontSize >= minSize; fontSize -= 1) {
    const lines = wrappedLines(text, fontSize, true);
    if (lines.length <= maxLines && lines.length * fontSize * lineHeight <= maxHeight) return true;
  }
  return false;
}

function urlVisualFitErrors(content) {
  const errors = [];
  for (const [slideIndex, slide] of (content?.slides || []).entries()) {
    if (slide?.title && !textFitsCanvas(slide.title, { startSize: 76, minSize: 46, maxLines: 3, maxHeight: 250, lineHeight: 1.08 })) {
      errors.push(`slide:${slideIndex}:url-layout: judul tidak muat maksimal tiga baris native canvas.`);
    }
    if (slide?.body && !textFitsCanvas(slide.body, { startSize: 42, minSize: 34, maxLines: 4, maxHeight: 220, lineHeight: 1.24 })) {
      errors.push(`slide:${slideIndex}:url-layout: body tidak muat maksimal empat baris native canvas.`);
    }
  }
  return errors;
}

function endsDangling(value) {
  const text = String(value || '').trim();
  if (!text || /[,;:\-–—]$/.test(text)) return true;
  return DANGLING_END.has(normalize(text).split(' ').filter(Boolean).at(-1));
}

function sourceDisplayCandidates(sourceText) {
  const candidates = [];
  const seen = new Set();
  const push = value => {
    const text = String(value || '').replace(/\s+/g, ' ').trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
    const count = words(text).length;
    const key = normalize(text);
    if (!key || seen.has(key) || count < 6 || count > 24 || isLowValueEvidence(text) || endsDangling(text)) return;
    if (/^[^.!?]{0,90},?["”']\s*(?:jelas|kata|ujar|tutur|ungkap)\b/i.test(text)) return;
    if (/^[a-zà-ÿ]/u.test(text)) return;
    if (!textFitsCanvas(text, { startSize: 42, minSize: 34, maxLines: 4, maxHeight: 220, lineHeight: 1.24 })) return;
    seen.add(key);
    candidates.push(text);
  };
  for (const sentence of String(sourceText || '').replace(/\r/g, '\n').split(/(?<=[.!?])\s+|\n+/).map(value => value.trim()).filter(Boolean)) {
    push(sentence);
    for (const clause of sentence.split(/;\s+|:\s+|,\s+(?=[A-ZÀ-Ý])/u)) push(clause);
  }
  return candidates;
}

function overlapScore(left, right) {
  const a = new Set(normalize(left).split(' ').filter(token => token.length > 2));
  const b = new Set(normalize(right).split(' ').filter(token => token.length > 2));
  let score = 0;
  for (const token of a) if (b.has(token)) score += 1;
  return score;
}

function completeEvidenceForFact(source, fact) {
  const candidates = sourceDisplayCandidates(source?.text);
  if (!candidates.length) return '';
  const ranked = candidates.map((candidate, index) => ({ candidate, index, score: overlapScore(candidate, fact?.evidence) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0]?.score > 0 ? ranked[0].candidate : candidates[0];
}

function groupedFacts(sources, facts) {
  return (sources || []).map((source, index) => {
    const sourceId = `source-${index + 1}`;
    const sourceFactsForId = facts.filter(fact => fact.sourceId === sourceId).slice(0, 24);
    const seenBodies = new Set();
    const bodyFacts = [];
    for (const fact of sourceFactsForId) {
      const evidence = completeEvidenceForFact(source, fact);
      const key = normalize(evidence);
      if (words(evidence).length < 6 || !key || seenBodies.has(key)) continue;
      seenBodies.add(key);
      bodyFacts.push(evidence);
      if (bodyFacts.length >= 18) break;
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
    if (bodyCount < profile.bodyMin) errors.push(`slide:${index}:shape-goal: body baru ${bodyCount} kata; wajib minimal ${profile.bodyMin} kata.`);
    if (points.length < profile.targetPoints) errors.push(`slide:${index}:shape-goal: baru ${points.length} bullet; target ${profile.targetPoints} bullet fakta berbeda.`);
    if (count < profile.visibleGoal) errors.push(`slide:${index}:shape-goal: baru ${count} kata visible; perkaya tanpa filler.`);
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
  return `FINAL AI REWRITE — PAKAI URL MANUAL, WAJIB ON-TOPIC DAN SIAP RENDER.\n\nTOPIK PENGGUNA: ${JSON.stringify(topic)}\nFORMAT EFEKTIF: ${JSON.stringify(format)}\nSECTION WAJIB: ${JSON.stringify(sections)}\nTARGET: judul spesifik 3–8 kata + body ${profile.bodyMin}–16 kata + bullet fakta seperlunya\nERROR SEBELUMNYA: ${JSON.stringify(errors || [])}\n\nSUMBER DAN FACT BANK YANG SUDAH DIFILTER RELEVAN:\n${JSON.stringify(sourceGroups)}\n\nDRAF SAAT INI:\n${JSON.stringify(generated?.slides || [])}\n\nATURAN KERAS:\n- TOPIK PENGGUNA adalah pagar utama. Jangan pindah ke produk, program, orang, sekolah, artikel, atau subtopik lain hanya karena muncul di halaman URL.\n- Tulis Bahasa Indonesia natural. Dilarang copy patah, kutipan setengah, byline, tanggal publikasi, headline artikel terkait, atau potongan yang mulai/berakhir di tengah kalimat.\n- HANYA gunakan BODY FACT BANK dan FACT BANK di atas. Jangan memakai pengetahuan luar.\n- SETIAP sourceId wajib menyumbang minimal satu fakta jika ada beberapa URL.\n- JUDUL maksimal 8 kata, spesifik, natural, tidak boleh generik, dan harus aman untuk maksimal 3 baris canvas.\n- BODY maksimal 16 kata, satu kalimat utuh, aman untuk maksimal 4 baris canvas. Jangan memotong kalimat demi batas kata.\n- Bullet 3–7 kata, utuh, tidak boleh berakhir pada kata gantung. Maksimal 3 bullet.\n- Setiap body dan bullet wajib mempunyai claim field/text yang PERSIS sama dengan copy visible, sourceId benar, dan evidence yang benar-benar ada pada source tersebut.\n- Evidence body wajib PERSIS salah satu bodyFacts. Evidence bullet wajib berasal dari facts sourceId yang sama.\n- Evidence Inggris boleh diterjemahkan/parafrase ke Indonesia tanpa mengubah makna, angka, modalitas, subjek, hubungan sebab-akibat, atau tingkat kepastian.\n- Angka/ordinal visible wajib berasal dari evidence claim yang sama dan tidak boleh diubah bentuk maknanya. Jangan ubah “lebih dari 10.000” menjadi “10 ribuan”.\n- Jangan mengulang evidence canonical yang sama lintas body/bullet.\n- Untuk LANGKAH/SOLUSI/TIPS, hanya tulis tindakan pengguna bila evidence memang mendukung tindakan itu.\n- Untuk BEFORE/AFTER/HASIL, hubungan outcome harus dinyatakan sumber.\n- Jika draft lama memuat Smart PAI atau isi lain yang tidak relevan dengan TOPIK PENGGUNA, buang total walaupun muncul di halaman yang sama.\n\nKembalikan HANYA JSON:\n{"slides":[{"section":"...","title":"judul natural","body":"kalimat utuh","points":["bullet utuh"],"claims":[{"field":"slide:0:title","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:point:0","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
}

function responseJson(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) return content;
  let raw = content;
  if (Array.isArray(content)) {
    if (!content.length || content.some(part => part?.type !== 'text' || typeof part?.text !== 'string')) throw new Error('content array tidak berisi textual JSON yang didukung.');
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

const ORDINAL_WORDS = new Set(['pertama','kedua','ketiga','keempat','kelima','keenam','ketujuh','kedelapan','kesembilan','kesepuluh']);
function ordinalTokens(value) {
  const text = String(value || '').toLocaleLowerCase('id-ID');
  const found = text.match(/\bke-?\d+\b/g) || [];
  for (const word of text.match(/[a-z]+/g) || []) if (ORDINAL_WORDS.has(word)) found.push(word);
  return found;
}
function numberTokens(value) { return String(value || '').match(/\b\d+(?:[.,]\d+)?%?\b/g) || []; }
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
      if (unsupportedNumbers.length || unsupportedOrdinals.length) errors.push(`NUMERIC_GROUNDING: angka/ordinal pada claim tidak didukung evidence yang sama: ${text}. Evidence: ${evidence}`);
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
  return { ...content, hook: String(first?.title || content?.hook || '').trim(), body: main(middle), caption: main(middle), cta: String(last?.title || content?.cta || '').trim() };
}

function localLayoutErrors(content) {
  const errors = [];
  (content?.slides || []).forEach((slide, slideIndex) => {
    const titleCount = words(slide?.title).length;
    if (!titleCount || titleCount > 10) errors.push(`slide:${slideIndex}: title harus 1–10 kata.`);
    if (!words(slide?.body).length || words(slide?.body).length > 18) errors.push(`slide:${slideIndex}: body harus 1–18 kata untuk Pakai URL.`);
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
  const candidate = sourceDisplayCandidates(source?.text)[0];
  if (!candidate) return null;
  return { sourceId, evidence: candidate };
}

function emergencySourceOnlyFallback({ generated = {}, sources = [], topic = '', format = 'Fakta singkat', facts = [] } = {}) {
  const cleanFacts = facts.length ? facts : sourceFacts(sources);
  const usable = [];
  const usedEvidence = new Set();
  for (const fact of cleanFacts) {
    const sourceIndex = Number(String(fact.sourceId).match(/^source-(\d+)$/)?.[1]) - 1;
    const source = sources[sourceIndex];
    if (!source) continue;
    const evidence = completeEvidenceForFact(source, fact);
    const key = `${fact.sourceId}::${normalize(evidence)}`;
    if (!evidence || usedEvidence.has(key)) continue;
    usedEvidence.add(key);
    usable.push({ sourceId: fact.sourceId, evidence });
  }
  for (const [sourceIndex, source] of sources.entries()) {
    const sourceId = `source-${sourceIndex + 1}`;
    if (!usable.some(item => item.sourceId === sourceId)) {
      const raw = rawSeedFact(source, sourceIndex);
      if (raw) usable.push(raw);
    }
  }
  if (usable.length < 4) return null;

  const resolvedTopic = String(topic || generated?.topic || sources?.[0]?.title || 'Ringkasan sumber').trim();
  const sections = targetSections(generated, format, usable, sources, resolvedTopic);
  const slideCount = Math.max(4, Math.min(5, sections.length || 4));
  const selected = usable.slice(0, slideCount);
  if (selected.length < slideCount) return null;
  const remaining = usable.slice(slideCount);
  const slides = selected.map((fact, slideIndex) => {
    const title = naturalTitleFromEvidence(fact.evidence);
    if (!title || !textFitsCanvas(title, { startSize: 76, minSize: 46, maxLines: 3, maxHeight: 250, lineHeight: 1.08 })) return null;
    return {
      section: sections[slideIndex] || defaultSections(format, slideCount)[slideIndex],
      title,
      body: fact.evidence,
      points: [],
      claims: [
        { field: `slide:${slideIndex}:title`, text: title, sourceId: fact.sourceId, evidence: fact.evidence },
        { field: `slide:${slideIndex}:body`, text: fact.evidence, sourceId: fact.sourceId, evidence: fact.evidence }
      ]
    };
  });
  if (slides.some(slide => !slide)) return null;

  const profile = sourceRichness(cleanFacts, slides.length);
  const covered = new Set(slides.flatMap(slide => slide.claims.map(claim => claim.sourceId)));
  for (const [slideIndex, slide] of slides.entries()) {
    while (slide.points.length < profile.targetPoints && remaining.length) {
      let detailIndex = remaining.findIndex(detail => !covered.has(detail.sourceId));
      if (detailIndex < 0) detailIndex = 0;
      const [detail] = remaining.splice(detailIndex, 1);
      const point = compactPoint(detail.evidence);
      if (!point || endsDangling(point) || slide.points.some(existing => normalize(existing) === normalize(point))) continue;
      const pointIndex = slide.points.length;
      slide.points.push(point);
      slide.claims.push({ field: `slide:${slideIndex}:point:${pointIndex}`, text: point, sourceId: detail.sourceId, evidence: detail.evidence });
      covered.add(detail.sourceId);
    }
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
    ...manualSourceFallback.validateSourceContent(result, sources).filter(error => !/:richness:/.test(error)),
    ...numericGroundingErrors(result),
    ...localLayoutErrors(result),
    ...urlVisualFitErrors(result)
  ];
  return safetyErrors.length ? null : result;
}

function buildUrlSourceFallback({ generated = {}, sources = [], topic = '', format = 'Fakta singkat', facts = [] } = {}) {
  return emergencySourceOnlyFallback({ generated, sources, topic, format, facts });
}

async function rewriteAllSourcesWithAi({ generated, sources = [], topic = '', format = 'Fakta singkat', mode = 'manual', contentService, client } = {}) {
  if (!sources.length) throw Object.assign(new Error('Tidak ada URL sumber yang dapat dipakai.'), { status: 422 });
  const allFacts = sourceFacts(sources);
  const rawSeeds = sources.map((source, index) => rawSeedFact(source, index)).filter(Boolean);
  const seedFacts = relevantSourceFacts(sources, allFacts.length ? allFacts : rawSeeds, topic);
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
          { role: 'system', content: 'Anda editor final khusus Pakai URL. Tetap pada topik pengguna, hanya gunakan evidence URL, dan hasil harus langsung muat canvas tanpa renderer memotong teks.' },
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
    const candidate = checked.content || draft;
    const deterministicErrors = [
      ...numericGroundingErrors(candidate),
      ...checked.errors,
      ...manualSourceFallback.validateSourceContent(candidate, sources),
      ...manualSourceDedupe.manualCrossSlideDuplicateErrors(candidate),
      ...localLayoutErrors(candidate),
      ...urlVisualFitErrors(candidate)
    ];
    if (deterministicErrors.length) {
      lastErrors = [...new Set(deterministicErrors)];
      draft = candidate;
      if (attempt < FAST_FINALIZE_ATTEMPTS - 1) continue;
      break;
    }

    const semanticErrors = await sourceFilter.auditClaimSemantics(openai, candidate, resolvedTopic, effectiveFormat);
    if (semanticErrors.length) {
      lastErrors = semanticErrors;
      draft = candidate;
      if (attempt < FAST_FINALIZE_ATTEMPTS - 1) continue;
      break;
    }
    return syncTop(candidate);
  }

  const fallback = buildUrlSourceFallback({ generated: draft, sources, topic: resolvedTopic, format: effectiveFormat, facts: seedFacts });
  if (fallback) return fallback;
  throw Object.assign(new Error(`Final Pakai URL belum lolos tanpa memotong atau keluar topik: ${lastErrors[0] || 'URL tidak menyediakan teks yang dapat dipakai dengan aman'}`), {
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
  relevantSourceFacts,
  urlVisualFitErrors,
  sourceDisplayCandidates,
  FAST_FINALIZE_ATTEMPTS,
  MAX_FINALIZE_ATTEMPTS
};
