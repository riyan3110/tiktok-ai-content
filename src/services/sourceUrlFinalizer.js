const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const manualSourceDedupe = require('./manualSourceDedupe');
const manualSourceFallback = require('./manualSourceFallback');
const {
  sourceFacts,
  requestedListicleCount,
  sourceRichness,
  naturalTitleFromEvidence,
  isLowValueEvidence
} = manualSourceFallback;

// PAKAI URL ONLY.
// Keep the historical public constant for contract compatibility, while the
// production path intentionally uses at most two AI calls: one compose + one
// clean rebuild. No deterministic raw-copy fallback is returned to users.
const MAX_FINALIZE_ATTEMPTS = 3;
const FAST_FINALIZE_ATTEMPTS = 2;
const URL_SAFE_WIDTH = 740;
const TOPIC_STOP = new Set([
  'yang','dan','atau','dari','untuk','dengan','pada','dalam','adalah','ini','itu','sebagai','oleh','akan','bisa','dapat','telah','sudah','lebih','juga',
  'cara','ubah','terbaru','baru','update','fakta','tips','tutorial','edukasi','pendidikan','teknologi','artificial','intelligence'
]);
const CONTEXT_STOP = new Set([
  ...TOPIC_STOP, 'ai','indonesia','perusahaan','orang','tahun','persen','sumber','survei','data','menurut','menyebut','mengatakan','menilai','disebut'
]);
const DANGLING_END = new Set([
  'yang','dan','atau','di','ke','dari','dengan','oleh','pada','untuk','sebagai','secara','adalah','merupakan','berada','memiliki','menjadi','termasuk','maupun','karena','agar','jika','bila','saat','ketika','dalam'
]);
const BAD_BULLET_START = /^(?:hingga|bahkan|namun|sementara|sedangkan|dan|atau|untuk|dengan|karena|katanya|ujarnya|jelasnya|tuturnya|ungkapnya|ia\b|dia\b|mereka\b|di sisi lain\b)/i;
const BYLINE_PREFIX = /^(?:jakarta|bandung|surabaya|semarang|yogyakarta|medan|makassar|denpasar|beijing|london|new york|san francisco)\s*:\s*/i;
const ATTRIBUTION_FRAGMENT = /["”']\s*,?\s*(?:kata|ujar|jelas|tutur|ungkap|menurut)\b/i;
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
  const count = facts.length >= 12 ? 5 : 4;
  return defaultSections(format, count);
}

function topicTerms(value) {
  const tokens = [...new Set(normalize(value).split(' ').filter(token => (token.length >= 3 || token === 'ai') && !TOPIC_STOP.has(token)))];
  const specific = tokens.filter(token => token !== 'ai');
  return specific.length ? specific : tokens;
}

function contextTerms(value) {
  return new Set(normalize(value).split(' ').filter(token => token.length >= 4 && !CONTEXT_STOP.has(token)));
}

function overlapScore(left, right) {
  const a = new Set(normalize(left).split(' ').filter(token => token.length > 2 || token === 'ai'));
  const b = new Set(normalize(right).split(' ').filter(token => token.length > 2 || token === 'ai'));
  let score = 0;
  for (const token of a) if (b.has(token)) score += 1;
  return score;
}

function continuityScore(left, right) {
  const a = contextTerms(left);
  const b = contextTerms(right);
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared;
}

function endsDangling(value) {
  const text = String(value || '').trim();
  if (!text || /[,;:\-–—]$/.test(text)) return true;
  return DANGLING_END.has(normalize(text).split(' ').filter(Boolean).at(-1));
}

function cleanEvidence(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();
  if (!text || isLowValueEvidence(text) || endsDangling(text) || ATTRIBUTION_FRAGMENT.test(text)) return '';
  if (/^[a-zà-ÿ]/u.test(text)) return '';
  return text;
}

function scoredFacts(entries, wanted) {
  return entries.map((entry, index) => {
    const tokenSet = new Set(normalize(entry.evidence).split(' ').filter(Boolean));
    const overlap = wanted.filter(term => tokenSet.has(term)).length;
    return { entry, index, overlap };
  });
}

// Keep the contiguous main-topic segment of every supplied URL. Direct topic
// matches are anchors. Nearby context is admitted only when it has lexical
// continuity with an accepted fact; once continuity breaks, unrelated related-
// article/recommendation blocks cannot enter merely because the same page also
// contains generic words such as "AI" or "Indonesia".
function relevantSourceFacts(sources, facts, topic) {
  const bySource = new Map();
  for (const fact of facts) {
    const evidence = cleanEvidence(fact?.evidence);
    if (!evidence) continue;
    const clean = { ...fact, evidence };
    if (!bySource.has(clean.sourceId)) bySource.set(clean.sourceId, []);
    bySource.get(clean.sourceId).push(clean);
  }

  const selected = [];
  for (const [sourceIndex, source] of (sources || []).entries()) {
    const sourceId = `source-${sourceIndex + 1}`;
    const entries = bySource.get(sourceId) || [];
    if (!entries.length) continue;

    let wanted = topicTerms(topic);
    let scored = scoredFacts(entries, wanted);
    let anchors = scored.filter(item => item.overlap > 0);
    if (!anchors.length) {
      wanted = topicTerms(source?.title || '');
      scored = scoredFacts(entries, wanted);
      anchors = scored.filter(item => item.overlap > 0);
    }

    // If neither manual topic nor article title has a lexical anchor, keep a
    // bounded early article block so a supplemental URL is still represented.
    if (!anchors.length) {
      selected.push(...entries.slice(0, 12));
      continue;
    }

    const accepted = new Set(anchors.map(item => item.index));
    // Two bounded continuity expansions are enough to keep explanatory context
    // without walking through a whole page into recommendation sections.
    for (let pass = 0; pass < 2; pass += 1) {
      const add = [];
      for (let index = 0; index < entries.length; index += 1) {
        if (accepted.has(index)) continue;
        const neighbors = [index - 1, index + 1].filter(value => accepted.has(value));
        if (!neighbors.length) continue;
        if (neighbors.some(value => continuityScore(entries[index].evidence, entries[value].evidence) > 0)) add.push(index);
      }
      if (!add.length) break;
      add.forEach(index => accepted.add(index));
    }

    const pool = [...accepted].sort((a, b) => a - b).map(index => entries[index]).filter(Boolean).slice(0, 28);
    selected.push(...pool);
  }
  return selected.length ? selected : facts.map(fact => ({ ...fact, evidence: cleanEvidence(fact?.evidence) })).filter(fact => fact.evidence);
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
      errors.push(`slide:${slideIndex}:title:url-layout: judul tidak muat maksimal tiga baris native canvas.`);
    }
    if (slide?.body && !textFitsCanvas(slide.body, { startSize: 42, minSize: 34, maxLines: 4, maxHeight: 220, lineHeight: 1.24, bold: false })) {
      errors.push(`slide:${slideIndex}:body:url-layout: body tidak muat maksimal empat baris native canvas.`);
    }
  }
  return errors;
}

function sourceDisplayCandidates(sourceText) {
  const candidates = [];
  const seen = new Set();
  const push = value => {
    const text = cleanEvidence(value);
    const count = words(text).length;
    const key = normalize(text);
    if (!key || seen.has(key) || count < 8 || count > 40) return;
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

function completeEvidenceForFact(source, fact) {
  const candidates = sourceDisplayCandidates(source?.text);
  if (!candidates.length) return cleanEvidence(fact?.evidence);
  const ranked = candidates.map((candidate, index) => ({ candidate, index, score: overlapScore(candidate, fact?.evidence) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return ranked[0]?.score > 0 ? ranked[0].candidate : cleanEvidence(fact?.evidence);
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
      if (words(evidence).length < 10 || !key || seenBodies.has(key)) continue;
      seenBodies.add(key);
      bodyFacts.push(evidence);
      if (bodyFacts.length >= 20) break;
    }
    const pointFacts = sourceFactsForId.map(fact => cleanEvidence(fact.evidence)).filter(Boolean);
    return {
      sourceId,
      title: String(source?.title || '').trim(),
      url: String(source?.finalUrl || source?.url || '').trim(),
      bodyFacts,
      facts: pointFacts
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
    if (count < profile.visibleGoal) errors.push(`slide:${index}:shape-goal: baru ${count} kata visible; perkaya menuju ${profile.visibleGoal} tanpa filler.`);
    return errors;
  });
}
const densityGoalErrors = contentShapeGoalErrors;

function qualityScore(content) {
  return (content?.slides || []).reduce((sum, slide) => sum + visibleCount(slide) + ((slide?.points || []).length * 8), 0);
}
const densityScore = qualityScore;

function densityInstruction(facts, slideCount) {
  const profile = sourceRichness(facts, slideCount);
  const targetPoints = Math.min(3, profile.targetPoints);
  if (targetPoints >= 3) return 'Setiap slide WAJIB berisi body + 3 bullet fakta berbeda.';
  if (targetPoints === 2) return 'Setiap slide WAJIB berisi body + 2 bullet fakta berbeda jika FACT BANK mendukung.';
  if (targetPoints === 1) return 'Setiap slide WAJIB berisi body + minimal 1 bullet fakta.';
  return 'Setiap slide wajib memiliki body faktual dan bullet sebanyak fakta berbeda yang tersedia.';
}

function urlDensityErrors(content, facts = []) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  if (!slides.length) return [];
  const targetPoints = Math.min(3, sourceRichness(facts, slides.length).targetPoints);
  return slides.flatMap((slide, index) => {
    const count = Array.isArray(slide?.points) ? slide.points.length : 0;
    return count < targetPoints ? [`slide:${index}:url-density: source relevan cukup kaya untuk ${targetPoints} bullet fakta berbeda; baru ada ${count}.`] : [];
  });
}

function buildFactPlan(sources, facts, slideCount) {
  const clean = [];
  const seen = new Set();
  for (const fact of facts) {
    const evidence = cleanEvidence(fact?.evidence);
    const key = `${fact?.sourceId || ''}::${normalize(evidence)}`;
    if (!evidence || seen.has(key)) continue;
    seen.add(key);
    clean.push({ sourceId: fact.sourceId, evidence });
  }
  const plan = Array.from({ length: slideCount }, () => []);
  const queues = new Map();
  for (const fact of clean) {
    if (!queues.has(fact.sourceId)) queues.set(fact.sourceId, []);
    queues.get(fact.sourceId).push(fact);
  }
  const ids = (sources || []).map((_, index) => `source-${index + 1}`).filter(id => queues.has(id));
  let cursor = 0;
  let remaining = clean.length;
  while (remaining > 0 && plan.some(slot => slot.length < 4)) {
    let progressed = false;
    for (const id of ids) {
      const queue = queues.get(id) || [];
      if (!queue.length) continue;
      let target = cursor % slideCount;
      let guard = 0;
      while (plan[target].length >= 4 && guard < slideCount) { target = (target + 1) % slideCount; guard += 1; }
      if (guard >= slideCount) break;
      plan[target].push(queue.shift());
      remaining -= 1;
      cursor = target + 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  return plan;
}

function finalizerPrompt({ generated, sources, facts, format, topic, errors, recovery = false }) {
  const sections = targetSections(generated, format, facts, sources, topic);
  const sourceGroups = groupedFacts(sources, facts);
  const profile = sourceRichness(facts, sections.length);
  const plan = buildFactPlan(sources, facts, sections.length);
  return `${recovery ? 'RECOVERY FINAL' : 'FINAL'} PAKAI URL — TULIS CAROUSEL DARI FACT BANK BERSIH.\n\nTOPIK PENGGUNA: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nSECTION WAJIB: ${JSON.stringify(sections)}\n${densityInstruction(facts, sections.length)}\nBODY WAJIB minimal 10 kata; target ${Math.max(10, profile.bodyMin)}–20 kata.\nERROR YANG HARUS DIHILANGKAN: ${JSON.stringify(errors || [])}\n\nSEMUA SUMBER/URL DAN BODY FACT BANK:\n${JSON.stringify(sourceGroups)}\n\nFACT PLAN UNIK PER SLIDE (panduan evidence; jangan mengulang evidence canonical):\n${JSON.stringify(plan)}\n\nATURAN WAJIB:\n- Gunakan SEMUA URL yang diberikan: SETIAP sourceId yang tercantum WAJIB menyumbang minimal satu fakta visible pada body atau bullet final.\n- DRAF LAMA DILARANG disalin. Tulis copy baru hanya dari FACT BANK di atas.\n- Tetap pada konteks TOPIK PENGGUNA. Jangan memakai related article, rekomendasi, headline lain, byline, lokasi dateline, metadata, caption, promosi, atau artikel lain pada halaman yang sama.\n- HANYA gunakan evidence yang tercantum pada BODY FACT BANK/FACT PLAN. Evidence dari bagian halaman lain dianggap tidak valid meskipun URL-nya sama.\n- Bahasa Indonesia harus natural, utuh, dan enak dibaca; jangan menyalin potongan kutipan, anak kalimat, atau attribution seperti “katanya/ujarnya”.\n- Judul harus natural dan spesifik terhadap isi slide. Jangan memakai pola berulang “<topik>: Fakta Utama / Konteks / Kesimpulan”. Jangan membuat semua judul berupa pertanyaan.\n- BODY 10–20 kata, satu kalimat utuh, maksimal 4 baris.\n- Jika source kaya, setiap slide harus punya 3 bullet fakta berbeda. Bullet 3–7 kata, maksimal 3, berupa frasa/kalimat utuh yang bisa dipahami tanpa konteks kalimat sebelumnya.\n- Bullet DILARANG dimulai dengan kata sambung/pronomina gantung seperti “hingga”, “bahkan”, “namun”, “ia”, “mereka”, “katanya”, atau “di sisi lain”.\n- Setiap BODY dan BULLET WAJIB punya claim field/text yang sama persis, sourceId benar, dan evidence persis dari bank sourceId yang sama. Judul faktual juga wajib punya claim title.\n- Jika evidence berbahasa Inggris, parafrase/terjemahkan natural ke Bahasa Indonesia tanpa mengubah makna atau tingkat kepastian.\n- Jika memakai angka/ordinal/tanggal, token angkanya WAJIB sama persis dengan evidence claim itu. Jika tidak perlu, hilangkan angkanya; jangan menebak pengganti.\n- JANGAN memakai evidence canonical yang sama dua kali, baik dalam satu slide maupun antar-slide.\n- Jangan mengulang fakta yang sama dengan wording berbeda.\n- Judul maksimal 10 kata dan 3 baris. Jangan memotong copy di renderer.\n- Jika jumlah fakta bersih memang tidak cukup untuk 3 bullet di semua slide, gunakan sebanyak mungkin fakta unik yang benar-benar didukung; jangan filler dan jangan mengarang.\n- Untuk tutorial/tips/solusi, tindakan hanya boleh ditulis bila evidence menyatakan tindakan itu. Untuk before-after/hasil, outcome hanya boleh ditulis bila evidence mendukung hubungan tersebut.\n${recovery ? '- Ini pass terakhir: ABAIKAN TOTAL output pass sebelumnya dan bangun ulang dari bank unik di atas.\n' : ''}\nKembalikan HANYA JSON:\n{"slides":[{"section":"...","title":"judul natural","body":"kalimat faktual natural","points":["fakta pendek","fakta pendek","fakta pendek"],"claims":[{"field":"slide:0:title","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:point:0","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
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
    const title = String(slide?.title || '').trim();
    const titleCount = words(title).length;
    if (!titleCount || titleCount > 10) errors.push(`slide:${slideIndex}:title: title harus 1–10 kata.`);
    const bodyCount = words(slide?.body).length;
    if (bodyCount < 8 || bodyCount > 20) errors.push(`slide:${slideIndex}:body: body harus 8–20 kata untuk Pakai URL.`);
    if (BYLINE_PREFIX.test(String(slide?.body || ''))) errors.push(`slide:${slideIndex}:body:natural: dateline/lokasi berita tidak boleh menjadi awal body.`);
    if ((slide?.points || []).length > 3) errors.push(`slide:${slideIndex}: maksimal 3 point.`);
    (slide?.points || []).forEach((point, pointIndex) => {
      const count = words(point).length;
      if (count < 3 || count > 7) errors.push(`slide:${slideIndex}:point:${pointIndex}: harus 3–7 kata.`);
      if (BAD_BULLET_START.test(point) || endsDangling(point) || ATTRIBUTION_FRAGMENT.test(point)) {
        errors.push(`slide:${slideIndex}:point:${pointIndex}: bullet berupa fragmen/kutipan gantung dan harus ditulis ulang utuh.`);
      }
    });
  });
  return errors;
}

function shortTopicSubject(topic) {
  const raw = String(topic || '').replace(/[?!.]+$/g, '').trim();
  return words(raw).filter(token => !/^\d/.test(token)).slice(0, 5).join(' ') || 'Topik Utama';
}

// Kept only as a compatibility helper for tests/other callers. Production no
// longer uses these repeated structural titles as the final user-facing result.
function structuralTitle(section, topic, slideIndex) {
  const subject = shortTopicSubject(topic);
  const label = String(section || '').toLocaleUpperCase('id-ID');
  if (slideIndex === 0) return `${subject}: Gambaran Utama`;
  if (/FAKTA UTAMA/.test(label)) return `${subject}: Fakta Utama`;
  if (/PENJELASAN/.test(label)) return `${subject}: Penjelasan`;
  if (/KONTEKS/.test(label)) return `${subject}: Konteks Penting`;
  if (/KESIMPULAN|PENUTUP|HASIL/.test(label)) return `${subject}: Kesimpulan`;
  return `${subject}: Poin ${slideIndex + 1}`;
}

function titleErrorIndexes(errors = []) {
  const indexes = new Set();
  for (const error of errors) {
    const text = String(error || '');
    const match = text.match(/(?:Field\s+)?slide:(\d+):title\b/i);
    if (match) indexes.add(Number(match[1]));
  }
  return indexes;
}

function naturalRepairTitle(slide, slideIndex) {
  const bodyClaim = (slide?.claims || []).find(claim => String(claim?.field || '') === `slide:${slideIndex}:body`);
  const evidence = String(bodyClaim?.evidence || slide?.body || '').trim();
  let title = naturalTitleFromEvidence(evidence || slide?.body || '');
  title = String(title || '').replace(/\?+$/g, '').trim();
  if (!title || words(title).length > 10) title = words(String(slide?.body || '')).slice(0, 7).join(' ').replace(/[,:;.!?]+$/g, '').trim();
  return { title, evidence: bodyClaim?.evidence || evidence, sourceId: bodyClaim?.sourceId || '' };
}

// Repair title-only grounding/layout mistakes locally using the slide's own
// body evidence, never a repeated "<topic>: section" template.
function repairProblematicTitles(content, errors) {
  const indexes = titleErrorIndexes(errors);
  if (!indexes.size || !content?.slides) return { content, changed: false };
  const slides = content.slides.map((slide, index) => {
    if (!indexes.has(index)) return slide;
    const repaired = naturalRepairTitle(slide, index);
    if (!repaired.title) return slide;
    const claims = (slide.claims || []).filter(claim => String(claim?.field || '') !== `slide:${index}:title`);
    if (repaired.sourceId && repaired.evidence) claims.push({
      field: `slide:${index}:title`, text: repaired.title, sourceId: repaired.sourceId, evidence: repaired.evidence
    });
    return { ...slide, title: repaired.title, claims };
  });
  return { content: syncTop({ ...content, slides }), changed: true };
}

function repeatedTemplateTitleErrors(content, topic) {
  const subject = normalize(shortTopicSubject(topic));
  if (!subject) return [];
  const hits = (content?.slides || []).map((slide, index) => ({ index, title: normalize(slide?.title) }))
    .filter(item => item.title.startsWith(`${subject} `) && /\s(?:gambaran utama|fakta utama|penjelasan|konteks penting|kesimpulan)$/.test(item.title));
  return hits.length >= 2 ? hits.map(item => `slide:${item.index}:title:natural: judul template berulang dilarang.`) : [];
}

function allowedEvidenceSet(sources, facts) {
  const allowed = new Set();
  for (const fact of facts) {
    const sourceId = String(fact?.sourceId || '').trim();
    const direct = cleanEvidence(fact?.evidence);
    if (sourceId && direct) allowed.add(`${sourceId}::${normalize(direct)}`);
    const sourceIndex = Number(sourceId.match(/^source-(\d+)$/)?.[1]) - 1;
    const source = sources[sourceIndex];
    if (source) {
      const body = completeEvidenceForFact(source, fact);
      if (body) allowed.add(`${sourceId}::${normalize(body)}`);
    }
  }
  return allowed;
}

function evidenceBankErrors(content, sources, facts) {
  const allowed = allowedEvidenceSet(sources, facts);
  const errors = [];
  for (const [slideIndex, slide] of (content?.slides || []).entries()) {
    for (const claim of (slide?.claims || [])) {
      const field = String(claim?.field || '').trim();
      if (!field.startsWith(`slide:${slideIndex}:`)) continue;
      const key = `${String(claim?.sourceId || '').trim()}::${normalize(claim?.evidence)}`;
      if (!allowed.has(key)) errors.push(`${field}:url-bank: evidence berada di luar fact bank relevan/topik dan tidak boleh dipakai.`);
    }
  }
  return [...new Set(errors)];
}

function sourceValidationErrors(content, sources, facts, strict) {
  const errors = [
    ...manualSourceFallback.sourceCoverageErrors(content, sources),
    ...manualSourceFallback.presentationErrors(content, facts),
    ...manualSourceFallback.naturalCopyErrors(content)
  ];
  return strict ? errors : errors.filter(error => !/:richness:/.test(error));
}

function validateCandidate(base, candidate, { contentService, format, topic, sources, mode, facts = [], strict = true }) {
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
    ...sourceValidationErrors(content, sources, facts, strict),
    ...evidenceBankErrors(content, sources, facts),
    ...(strict ? urlDensityErrors(content, facts) : []),
    ...(strict ? manualSourceDedupe.manualCrossSlideDuplicateErrors(content) : []),
    ...localLayoutErrors(content),
    ...urlVisualFitErrors(content),
    ...repeatedTemplateTitleErrors(content, topic)
  ];
  return { content, errors: [...new Set(errors)] };
}

function pointErrorTargets(errors = []) {
  const targets = new Map();
  for (const error of errors) {
    const match = String(error || '').match(/slide:(\d+):point:(\d+)/i);
    if (!match) continue;
    const slideIndex = Number(match[1]);
    const pointIndex = Number(match[2]);
    if (!targets.has(slideIndex)) targets.set(slideIndex, new Set());
    targets.get(slideIndex).add(pointIndex);
  }
  return targets;
}

function dropProblematicPoints(content, errors) {
  const targets = pointErrorTargets(errors);
  if (!targets.size || !content?.slides) return { content, changed: false };
  const slides = content.slides.map((slide, slideIndex) => {
    const remove = targets.get(slideIndex);
    if (!remove?.size) return slide;
    const oldPoints = Array.isArray(slide.points) ? slide.points : [];
    const kept = oldPoints.map((point, oldIndex) => ({ point, oldIndex })).filter(item => !remove.has(item.oldIndex));
    const nonPointClaims = (slide.claims || []).filter(claim => !String(claim?.field || '').startsWith(`slide:${slideIndex}:point:`));
    const oldClaimMap = new Map((slide.claims || []).map(claim => [String(claim?.field || ''), claim]));
    const claims = [...nonPointClaims];
    const points = kept.map((item, newIndex) => {
      const oldClaim = oldClaimMap.get(`slide:${slideIndex}:point:${item.oldIndex}`);
      if (oldClaim) claims.push({ ...oldClaim, field: `slide:${slideIndex}:point:${newIndex}`, text: String(item.point || '').trim() });
      return String(item.point || '').trim();
    });
    return { ...slide, points, claims };
  });
  return { content: syncTop({ ...content, slides }), changed: true };
}

function bodyCriticalErrors(errors = []) {
  return errors.filter(error => /slide:\d+:body|NUMERIC_GROUNDING|SEMANTIC_SUPPORT|url-bank|coverage:source|evidence tidak ditemukan|copy substantif tidak memiliki claim/i.test(String(error)));
}

// Deprecated compatibility export. Production rewriteAllSourcesWithAi never
// returns raw deterministic evidence anymore because that was the source of
// broken fragments and repeated template titles in user-facing slides.
function emergencySourceOnlyFallback() { return null; }
function buildUrlSourceFallback() { return null; }

async function rewriteAllSourcesWithAi({ generated, sources = [], topic = '', format = 'Fakta singkat', mode = 'manual', contentService, client } = {}) {
  if (!sources.length) throw Object.assign(new Error('Tidak ada URL sumber yang dapat dipakai.'), { status: 422 });
  const allFacts = sourceFacts(sources);
  const seedFacts = relevantSourceFacts(sources, allFacts, topic);
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
            ? 'Anda recovery editor Pakai URL. Buang output lama dan bangun ulang carousel dari fact bank bersih. Semua URL harus dipakai. Copy harus faktual, natural, padat, unik, dan tidak boleh memakai related content atau fragmen kutipan.'
            : 'Anda editor final khusus Pakai URL. Susun carousel baru hanya dari fact bank URL yang relevan. Gunakan semua URL, tulis natural dan padat, dan jangan menambah fakta di luar evidence.' },
          { role: 'user', content: finalizerPrompt({ generated: draft, sources, facts: seedFacts, format: effectiveFormat, topic: resolvedTopic, errors: lastErrors, recovery }) }
        ],
        response_format: { type: 'json_object' }
      });
      draft = syncTop({ ...draft, slides: parseSlides(response, sections), verificationStatus: 'source_based' });
    } catch (error) {
      lastErrors = [`PROVIDER_OUTPUT_INVALID: provider output invalid: ${error.message}`];
      if (attempt < FAST_FINALIZE_ATTEMPTS - 1) continue;
      break;
    }

    let validated = validateCandidate(draft, draft, {
      contentService, format: effectiveFormat, topic: resolvedTopic, sources, mode, facts: seedFacts, strict: true
    });

    const titleRepair = repairProblematicTitles(validated.content, validated.errors, resolvedTopic, effectiveFormat);
    if (titleRepair.changed) {
      draft = titleRepair.content;
      validated = validateCandidate(draft, draft, {
        contentService, format: effectiveFormat, topic: resolvedTopic, sources, mode, facts: seedFacts, strict: true
      });
    }

    if (validated.errors.length) {
      lastErrors = validated.errors;
      draft = validated.content;
      if (attempt < FAST_FINALIZE_ATTEMPTS - 1) continue;

      // Last bounded salvage: remove only point fields that validators identify
      // as broken/duplicate/out-of-bank. Never rewrite or invent body facts.
      const pruned = dropProblematicPoints(draft, lastErrors);
      if (pruned.changed) {
        draft = pruned.content;
        validated = validateCandidate(draft, draft, {
          contentService, format: effectiveFormat, topic: resolvedTopic, sources, mode, facts: seedFacts, strict: false
        });
        if (!bodyCriticalErrors(validated.errors).length && !validated.errors.length) {
          const semantic = await sourceFilter.auditClaimSemantics(openai, validated.content, resolvedTopic, effectiveFormat);
          if (!semantic.length) return syncTop(validated.content);
          lastErrors = semantic;
        } else {
          lastErrors = validated.errors;
        }
      }
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

  throw Object.assign(new Error(`Final Pakai URL belum dapat dibentuk secara faktual dan natural: ${lastErrors[0] || 'provider tidak menghasilkan carousel valid dari fact bank'}`), {
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
  urlDensityErrors,
  evidenceBankErrors,
  dropProblematicPoints,
  buildFactPlan,
  FAST_FINALIZE_ATTEMPTS,
  MAX_FINALIZE_ATTEMPTS
};