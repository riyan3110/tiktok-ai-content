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

// PAKAI URL ONLY.
// One normal AI pass + at most one clean source-only regeneration pass.
// Do not raise this into the old long retry loop.
const MAX_FINALIZE_ATTEMPTS = 3;
const FAST_FINALIZE_ATTEMPTS = 2;
const URL_SAFE_WIDTH = 740;
const TOPIC_STOP = new Set([
  'yang','dan','atau','dari','untuk','dengan','pada','dalam','adalah','ini','itu','sebagai','oleh','akan','bisa','dapat','telah','sudah','lebih','juga',
  'cara','ubah','terbaru','baru','update','fakta','tips','tutorial','edukasi','pendidikan','teknologi','artificial','intelligence','ai'
]);
const DANGLING_END = new Set([
  'yang','dan','atau','di','ke','dari','dengan','oleh','pada','untuk','sebagai','secara','adalah','merupakan','berada','memiliki','menjadi','termasuk','maupun','karena','agar','jika','bila','saat','ketika','dalam'
]);
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

// Rank independently inside every supplied URL. This preserves ALL sourceIds,
// while preferring facts that actually match the manual topic / article title.
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

    const scored = entries.map((entry, index) => {
      const tokenSet = new Set(normalize(entry.evidence).split(' ').filter(Boolean));
      const overlap = wanted.filter(term => tokenSet.has(term)).length;
      return { entry, index, overlap };
    }).sort((a, b) => b.overlap - a.overlap || a.index - b.index);

    const positive = scored.filter(item => item.overlap > 0);
    // Keep a meaningful pool for density, but never delete the whole URL.
    const pool = positive.length >= Math.min(3, entries.length)
      ? positive.slice(0, Math.min(20, Math.max(8, positive.length))).map(item => item.entry)
      : entries;
    selected.push(...pool);
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

function textFitsCanvas(text, { startSize, minSize, maxLines, maxHeight, lineHeight, bold = false }) {
  for (let fontSize = startSize; fontSize >= minSize; fontSize -= 1) {
    const lines = wrappedLines(text, fontSize, bold);
    if (lines.length <= maxLines && lines.length * fontSize * lineHeight <= maxHeight) return true;
  }
  return false;
}

function urlVisualFitErrors(content) {
  const errors = [];
  for (const [slideIndex, slide] of (content?.slides || []).entries()) {
    if (slide?.title && !textFitsCanvas(slide.title, { startSize: 76, minSize: 46, maxLines: 3, maxHeight: 250, lineHeight: 1.08, bold: true })) {
      errors.push(`slide:${slideIndex}:url-layout: judul tidak muat maksimal tiga baris native canvas.`);
    }
    if (slide?.body && !textFitsCanvas(slide.body, { startSize: 42, minSize: 34, maxLines: 4, maxHeight: 220, lineHeight: 1.24, bold: false })) {
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
    if (!textFitsCanvas(text, { startSize: 42, minSize: 34, maxLines: 4, maxHeight: 220, lineHeight: 1.24, bold: false })) return;
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
    const sourceFactsForId = facts.filter(fact => fact.sourceId === sourceId).slice(0, 28);
    const seenBodies = new Set();
    const bodyFacts = [];
    for (const fact of sourceFactsForId) {
      const evidence = completeEvidenceForFact(source, fact);
      const key = normalize(evidence);
      if (words(evidence).length < 6 || !key || seenBodies.has(key)) continue;
      seenBodies.add(key);
      bodyFacts.push(evidence);
      if (bodyFacts.length >= 20) break;
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

function densityInstruction(facts, slideCount) {
  const profile = sourceRichness(facts, slideCount);
  const targetPoints = Math.min(3, profile.targetPoints);
  if (targetPoints >= 3) return 'Setiap slide WAJIB berisi body + 3 bullet fakta berbeda.';
  if (targetPoints === 2) return 'Setiap slide WAJIB berisi body + 2 bullet fakta berbeda jika tersedia.';
  if (targetPoints === 1) return 'Setiap slide WAJIB berisi body + minimal 1 bullet fakta.';
  return 'Setiap slide wajib memiliki body faktual; tambahkan bullet bila ada fakta berbeda.';
}

function finalizerPrompt({ generated, sources, facts, format, topic, errors, recovery = false }) {
  const sections = targetSections(generated, format, facts, sources, topic);
  const sourceGroups = groupedFacts(sources, facts);
  const profile = sourceRichness(facts, sections.length);
  const draft = recovery ? 'DIBUANG — tulis ulang dari nol.' : JSON.stringify(generated?.slides || []);
  return `${recovery ? 'RECOVERY FINAL' : 'FINAL'} PAKAI URL — HASIL WAJIB FAKTUAL, PADAT, NATURAL, DAN SIAP RENDER.\n\nTOPIK PENGGUNA: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nSECTION WAJIB: ${JSON.stringify(sections)}\n${densityInstruction(facts, sections.length)}\nTARGET BODY: ${Math.max(8, profile.bodyMin)}–18 kata, satu kalimat utuh.\nERROR YANG HARUS DIHILANGKAN: ${JSON.stringify(errors || [])}\n\nSEMUA SUMBER/URL DAN FACT BANK:\n${JSON.stringify(sourceGroups)}\n\nDRAF: ${draft}\n\nATURAN WAJIB:\n- Gunakan SEMUA URL yang diberikan: setiap sourceId harus menyumbang minimal satu fakta visible pada carousel.\n- Tetap pada konteks TOPIK PENGGUNA. Jangan mengambil related article, rekomendasi, byline, tanggal publikasi, metadata, caption, atau bagian halaman yang membahas topik lain.\n- HANYA gunakan evidence dari fact bank di atas. Dilarang menambah pengetahuan luar, asumsi, angka, tanggal, ranking, hasil, sebab-akibat, atau kemampuan yang tidak dinyatakan evidence.\n- Bahasa Indonesia harus natural seperti editor manusia, bukan terjemahan kaku dan bukan potongan kalimat.\n- Untuk format Fakta singkat, JUDUL sebaiknya berupa pertanyaan/heading struktural yang tidak membuat klaim baru, misalnya pola “Apa itu …?”, “Apa yang bisa dilakukan?”, “Bagaimana cara kerjanya?”, “Apa yang perlu diketahui?”. Jangan menambahkan claim title jika judul hanya pertanyaan struktural.\n- Jangan memakai contoh nama/topik tertentu sebagai aturan. Semua aturan harus diterapkan generik ke topik apa pun.\n- BODY harus 8–18 kata, kalimat utuh, natural, dan muat maksimal 4 baris.\n- Bullet harus 3–7 kata, utuh, natural, maksimal 3, dan masing-masing menyampaikan fakta berbeda dari body/bullet lain.\n- Setiap BODY dan setiap BULLET WAJIB punya tepat satu claim dengan field/text yang sama persis, sourceId benar, dan evidence dari sourceId yang sama.\n- Evidence BODY wajib persis salah satu bodyFacts. Evidence BULLET wajib persis salah satu facts.\n- Jika evidence berbahasa Inggris, parafrase/terjemahkan ke Bahasa Indonesia tanpa mengubah makna atau tingkat kepastian.\n- Jika memakai angka/ordinal/tanggal, token angkanya WAJIB sama persis dengan evidence claim itu. Jika ragu, HAPUS angka dari copy dan tulis fakta tanpa angka; jangan mengarang pengganti.\n- Jangan membuat title/body/bullet factual yang tidak punya evidence. Satu field bermasalah harus diperbaiki, bukan menggagalkan seluruh carousel.\n- Jangan mengulang evidence canonical yang sama untuk dua body/bullet.\n- Judul maksimal 9 kata dan 3 baris; body maksimal 4 baris; jangan memotong copy di renderer.\n- Jika source kaya, prioritaskan pola padat: judul + satu body + 3 bullet seperti contoh struktur pengguna.\n- Untuk tutorial/tips/solusi, tindakan hanya boleh ditulis jika evidence memang menyatakan tindakan tersebut.\n- Untuk before-after/hasil, outcome hanya boleh ditulis bila evidence mendukung hubungan itu.\n${recovery ? '- ABAIKAN TOTAL copy draft sebelumnya. Bangun ulang seluruh carousel langsung dari fact bank bersih dan pastikan semua error sebelumnya hilang.\n' : ''}\nKembalikan HANYA JSON:\n{"slides":[{"section":"...","title":"judul/pertanyaan natural","body":"kalimat faktual natural","points":["fakta pendek","fakta pendek","fakta pendek"],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:point:0","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
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
      if (unsupportedNumbers.length || unsupportedOrdinals.length) {
        errors.push(`NUMERIC_GROUNDING: ${String(claim?.field || 'unknown-field')}: angka/ordinal tidak didukung evidence yang sama: ${text}. Evidence: ${evidence}`);
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
  return { ...content, hook: String(first?.title || content?.hook || '').trim(), body: main(middle), caption: main(middle), cta: String(last?.title || content?.cta || '').trim() };
}

function localLayoutErrors(content) {
  const errors = [];
  (content?.slides || []).forEach((slide, slideIndex) => {
    const titleCount = words(slide?.title).length;
    if (!titleCount || titleCount > 10) errors.push(`slide:${slideIndex}: title harus 1–10 kata.`);
    const bodyCount = words(slide?.body).length;
    if (!bodyCount || bodyCount > 20) errors.push(`slide:${slideIndex}: body harus 1–20 kata untuk Pakai URL.`);
    if ((slide?.points || []).length > 3) errors.push(`slide:${slideIndex}: maksimal 3 point.`);
    (slide?.points || []).forEach((point, pointIndex) => {
      const count = words(point).length;
      if (count < 3 || count > 7) errors.push(`slide:${slideIndex}:point:${pointIndex}: harus 3–7 kata.`);
    });
  });
  return errors;
}

function shortTopicSubject(topic) {
  const raw = String(topic || '').replace(/[?!.]+$/g, '').trim();
  const filtered = words(raw).filter(token => !/^\d/.test(token));
  return filtered.slice(0, 4).join(' ') || 'topik ini';
}

function structuralTitle(section, topic, slideIndex) {
  const label = String(section || '').toLocaleUpperCase('id-ID');
  if (slideIndex === 0) return `Apa itu ${shortTopicSubject(topic)}?`;
  if (/FAKTA UTAMA/.test(label)) return 'Apa fakta utamanya?';
  if (/PENJELASAN/.test(label)) return 'Apa yang bisa diketahui?';
  if (/KONTEKS/.test(label)) return 'Apa konteks pentingnya?';
  if (/KESIMPULAN|PENUTUP|HASIL/.test(label)) return 'Apa yang perlu diingat?';
  return `Apa poin penting ${slideIndex + 1}?`;
}

function titleErrorIndexes(errors = []) {
  const indexes = new Set();
  for (const error of errors) {
    const text = String(error || '');
    let match = text.match(/slide:(\d+):title\b/i);
    if (!match) match = text.match(/Field\s+slide:(\d+):title\b/i);
    if (match) indexes.add(Number(match[1]));
  }
  return indexes;
}

// A factual title should never be allowed to kill an otherwise valid carousel.
// For Fakta singkat only, turn ONLY the offending title into a non-factual
// structural question and remove its title claim. Body/bullets remain unchanged.
function repairProblematicTitles(content, errors, topic, format) {
  if (String(format || '').toLocaleLowerCase('id-ID') !== 'fakta singkat') return { content, changed: false };
  const indexes = titleErrorIndexes(errors);
  if (!indexes.size || !content?.slides) return { content, changed: false };
  const slides = content.slides.map((slide, index) => {
    if (!indexes.has(index)) return slide;
    return {
      ...slide,
      title: structuralTitle(slide.section, topic, index),
      claims: (slide.claims || []).filter(claim => String(claim?.field || '') !== `slide:${index}:title`)
    };
  });
  return { content: syncTop({ ...content, slides }), changed: true };
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
  const isFacts = String(format || '').toLocaleLowerCase('id-ID') === 'fakta singkat';

  const slides = selected.map((fact, slideIndex) => {
    const title = isFacts ? structuralTitle(sections[slideIndex], resolvedTopic, slideIndex) : naturalTitleFromEvidence(fact.evidence);
    if (!title || !textFitsCanvas(title, { startSize: 76, minSize: 46, maxLines: 3, maxHeight: 250, lineHeight: 1.08, bold: true })) return null;
    return {
      section: sections[slideIndex] || defaultSections(format, slideCount)[slideIndex],
      title,
      body: fact.evidence,
      points: [],
      claims: [
        ...(isFacts ? [] : [{ field: `slide:${slideIndex}:title`, text: title, sourceId: fact.sourceId, evidence: fact.evidence }]),
        { field: `slide:${slideIndex}:body`, text: fact.evidence, sourceId: fact.sourceId, evidence: fact.evidence }
      ]
    };
  });
  if (slides.some(slide => !slide)) return null;

  const profile = sourceRichness(cleanFacts, slides.length);
  const targetPoints = Math.min(3, profile.targetPoints);
  const covered = new Set(slides.flatMap(slide => slide.claims.map(claim => claim.sourceId)));
  for (const [slideIndex, slide] of slides.entries()) {
    while (slide.points.length < targetPoints && remaining.length) {
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

function validateCandidate(base, candidate, { contentService, format, topic, sources, mode }) {
  const checked = sourceFilter.validateVerifiedContent(base, { slides: candidate.slides }, {
    contentService,
    format,
    manualTopic: mode === 'manual' ? topic : '',
    sources,
    autoSourceTopic: mode === 'ai'
  });
  const content = checked.content || candidate;
  const errors = [
    ...numericGroundingErrors(content),
    ...checked.errors,
    ...manualSourceFallback.validateSourceContent(content, sources),
    ...manualSourceDedupe.manualCrossSlideDuplicateErrors(content),
    ...localLayoutErrors(content),
    ...urlVisualFitErrors(content)
  ];
  return { content, errors: [...new Set(errors)] };
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
    const recovery = attempt > 0;
    let response;
    try {
      response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          { role: 'system', content: recovery
            ? 'Anda recovery editor Pakai URL. Bangun ulang carousel dari fact bank bersih. Semua sourceId harus dipakai, copy harus Bahasa Indonesia natural, dan tidak boleh ada klaim tanpa evidence.'
            : 'Anda editor final khusus Pakai URL. Gunakan semua URL, tetap pada konteks sumber, buat carousel padat dan natural, dan jangan menambah klaim di luar evidence.' },
          { role: 'user', content: finalizerPrompt({ generated: draft, sources, facts: seedFacts, format: effectiveFormat, topic: resolvedTopic, errors: lastErrors, recovery }) }
        ],
        response_format: { type: 'json_object' }
      });
      draft = syncTop({ ...draft, slides: parseSlides(response, sections), verificationStatus: 'source_based' });
    } catch (error) {
      lastErrors = [`PROVIDER_OUTPUT_INVALID: provider output invalid: ${error.message}`];
      // Invalid provider JSON is not worth repeating; fall through to source fallback.
      break;
    }

    let validated = validateCandidate(draft, draft, {
      contentService,
      format: effectiveFormat,
      topic: resolvedTopic,
      sources,
      mode
    });

    // Fix title-only grounding mistakes locally without another model call.
    const titleRepair = repairProblematicTitles(validated.content, validated.errors, resolvedTopic, effectiveFormat);
    if (titleRepair.changed) {
      draft = titleRepair.content;
      validated = validateCandidate(draft, draft, {
        contentService,
        format: effectiveFormat,
        topic: resolvedTopic,
        sources,
        mode
      });
    }

    if (validated.errors.length) {
      lastErrors = validated.errors;
      draft = validated.content;
      if (attempt < FAST_FINALIZE_ATTEMPTS - 1) continue;
      break;
    }

    const semanticErrors = await sourceFilter.auditClaimSemantics(openai, validated.content, resolvedTopic, effectiveFormat);
    if (semanticErrors.length) {
      lastErrors = semanticErrors;
      draft = validated.content;
      if (attempt < FAST_FINALIZE_ATTEMPTS - 1) continue;
      break;
    }
    return syncTop(validated.content);
  }

  const fallback = buildUrlSourceFallback({ generated: draft, sources, topic: resolvedTopic, format: effectiveFormat, facts: seedFacts });
  if (fallback) return fallback;
  throw Object.assign(new Error(`Final Pakai URL belum dapat dibentuk dari evidence yang tersedia: ${lastErrors[0] || 'URL tidak menyediakan teks faktual yang cukup'}`), {
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
  repairProblematicTitles,
  structuralTitle,
  FAST_FINALIZE_ATTEMPTS,
  MAX_FINALIZE_ATTEMPTS
};
