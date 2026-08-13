const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const { sourceFacts } = require('./manualSourceFallback');

// TANPA URL / AUTO SOURCE ONLY.
// Simple production path:
// discovery -> clean facts -> writer -> fact-check/editor -> deterministic factual gate -> output.
const SLIDE_COUNT = 4;
const MAX_POINTS = 3;
const MAX_FACTS_PER_SOURCE = 8;
const STRICT_FACT_SIMILARITY = 0.58;
const RELAXED_FACT_SIMILARITY = 0.76;

const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '')
  .toLocaleLowerCase('id-ID')
  .replace(/[^a-z0-9%\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const STOPWORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','dalam','ini','itu','adalah','merupakan','akan','bisa','dapat',
  'di','ke','oleh','sebagai','lebih','juga','telah','sudah','sebuah','para','the','and','or','to','of','in','on','for','with',
  'from','is','are','was','were','will','can','could','has','have','had','a','an'
]);

const QUESTION_START = /^(?:faq\s*[:.-]?\s*)?(?:apa(?:kah)?|siapa|kapan|mengapa|kenapa|bagaimana|bisakah|dapatkah|benarkah|what|who|when|why|how)\b/i;
const ANNOUNCEMENT = /\b(?:announce(?:d|s|ment|ments|ing)?|plan(?:ned|s|ning)?|start(?:ed|s|ing)?|begin(?:s|ning)?|introduc(?:e|ed|es|ing)|launch(?:ed|es|ing)?|roll(?:ed|s|ing)?\s+out|mengumumkan|diumumkan|berencana|rencana|akan\s+mulai|mulai|memperkenalkan|diperkenalkan|meluncurkan|diluncurkan)\b/i;
const DANGLING_END = new Set([
  'yang','dan','atau','dengan','untuk','dari','di','ke','pada','dalam','oleh','sebagai','karena','agar','jika','bila','saat','ketika',
  'bahwa','namun','tetapi','serta','hingga','hanya','menurut','menunjukkan','menyatakan','mengatakan','menjelaskan','mencakup','termasuk',
  'that','which','who','and','or','with','for','from','to','in','on','by','because','if','when','while','although','including','shows','showed',
  'says','said','states','stated','explains','explained','according'
]);

const SEMANTIC_ALIASES = new Map([
  ['announced','announce'],['announces','announce'],['announcement','announce'],['mengumumkan','announce'],['diumumkan','announce'],
  ['plans','announce'],['planned','announce'],['planning','announce'],['rencana','announce'],['berencana','announce'],
  ['started','start'],['starts','start'],['starting','start'],['mulai','start'],
  ['introduced','introduce'],['introduces','introduce'],['memperkenalkan','introduce'],['diperkenalkan','introduce'],
  ['launched','release'],['launches','release'],['released','release'],['releases','release'],['meluncurkan','release'],['diluncurkan','release'],['dirilis','release'],
  ['embed','apply'],['embedded','apply'],['embedding','apply'],['insert','apply'],['inserting','apply'],['include','apply'],['including','apply'],
  ['incorporate','apply'],['incorporating','apply'],['menyisipkan','apply'],['menambahkan','apply'],['menerapkan','apply'],['menanamkan','apply'],['memasukkan','apply'],
  ['mark','watermark'],['marks','watermark'],['marked','watermark'],['marking','watermark'],['watermarks','watermark'],['watermarking','watermark'],
  ['menandai','watermark'],['ditandai','watermark'],['penandaan','watermark'],
  ['generated','generate'],['generates','generate'],['generating','generate'],['dihasilkan','generate'],['menghasilkan','generate'],
  ['contents','content'],['konten','content'],['texts','text'],['teks','text'],['images','image'],['gambar','image'],
  ['models','model'],['produk','product'],['products','product'],['services','service'],['layanan','service'],
  ['available','availability'],['tersedia','availability'],['ketersediaan','availability'],
  ['detecting','detect'],['detected','detect'],['detection','detect'],['mendeteksi','detect'],['terdeteksi','detect'],['deteksi','detect']
]);

function meaningfulTokens(value) {
  return [...new Set(normalize(value).split(' ').filter(token => token && !STOPWORDS.has(token) && (token.length > 2 || token === 'ai')))];
}

function similarity(left, right) {
  const a = meaningfulTokens(left);
  const b = meaningfulTokens(right);
  if (!a.length || !b.length) return 0;
  const shared = a.filter(token => b.includes(token)).length;
  return shared / Math.min(a.length, b.length);
}

function cleanEvidence(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function questionOnlyEvidence(value) {
  const text = cleanEvidence(value);
  if (!text) return false;
  return /\?\s*$/.test(text) || /^(?:faq|faqs|frequently\s+asked\s+questions?)\b/i.test(text) || QUESTION_START.test(text);
}

function endsWithDanglingFragment(value) {
  const raw = cleanEvidence(value);
  if (!raw || /[,;:\-–—]\s*$/.test(raw)) return true;
  const last = normalize(raw).split(' ').filter(Boolean).at(-1);
  return Boolean(last && DANGLING_END.has(last));
}

function semanticBase(value) {
  return normalize(value)
    .replace(/\b(?:tanda\s+air)\b/g, ' watermark ')
    .replace(/\b(?:tak|tidak)\s+terlihat\b/g, ' invisible ')
    .replace(/\bmachine\s+readable\b/g, ' machinereadable ')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticTokens(value, topic = '') {
  const topicTokens = new Set(semanticBase(topic).split(' ').map(token => SEMANTIC_ALIASES.get(token) || token).filter(Boolean));
  return [...new Set(semanticBase(value).split(' ').map(token => SEMANTIC_ALIASES.get(token) || token).filter(token =>
    token && !STOPWORDS.has(token) && !topicTokens.has(token) && (token.length > 2 || token === 'ai' || /^\d/.test(token))
  ))];
}

function semanticSimilarity(left, right, topic = '') {
  const a = semanticTokens(left, topic);
  const b = semanticTokens(right, topic);
  if (!a.length || !b.length) return 0;
  const shared = a.filter(token => b.includes(token)).length;
  return shared / Math.min(a.length, b.length);
}

function sameFactContext(left, right, topic = '') {
  if (normalize(left) === normalize(right)) return true;
  const score = Math.max(semanticSimilarity(left, right, topic), semanticSimilarity(left, right));
  if (score >= 0.68) return true;
  return ANNOUNCEMENT.test(left) && ANNOUNCEMENT.test(right) && score >= 0.42;
}

function sectionsForFormat(format = 'Fakta singkat') {
  const structures = {
    'Tutorial langkah': ['PEMBUKA', 'LANGKAH 1', 'LANGKAH 2', 'HASIL/PENUTUP'],
    'Masalah dan solusi': ['MASALAH', 'SOLUSI', 'SOLUSI', 'PENUTUP'],
    'Fakta singkat': ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'],
    Listicle: ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4'],
    'Tips cepat': ['PEMBUKA', 'TIPS 1', 'TIPS 2', 'PENUTUP'],
    'Before-after': ['BEFORE', 'PERUBAHAN', 'AFTER', 'PENUTUP']
  };
  return structures[format] || structures['Fakta singkat'];
}

function sourceIdForIndex(index) { return `source-${index + 1}`; }
function sourceIndexFromId(sourceId) {
  const match = String(sourceId || '').match(/^source-(\d+)$/);
  return match ? Number(match[1]) - 1 : -1;
}
function sourceForId(sources, sourceId) {
  const index = sourceIndexFromId(sourceId);
  return index >= 0 ? sources?.[index] || null : null;
}

function collectFactGroups(sources = [], topic = '') {
  const ranked = sourceFilter.extractFactBank(sources, topic);
  const fallback = sourceFacts(sources);
  const groups = new Map(sources.map((_, index) => [sourceIdForIndex(index), []]));
  const seen = new Map([...groups.keys()].map(id => [id, new Set()]));

  for (const fact of [...ranked, ...fallback]) {
    const sourceId = String(fact?.sourceId || '').trim();
    const evidence = String(fact?.evidence || '').replace(/\s+/g, ' ').trim();
    if (!groups.has(sourceId) || !evidence || questionOnlyEvidence(evidence) || endsWithDanglingFragment(evidence)) continue;
    const key = normalize(evidence);
    if (!key || seen.get(sourceId).has(key) || groups.get(sourceId).length >= MAX_FACTS_PER_SOURCE) continue;
    seen.get(sourceId).add(key);
    groups.get(sourceId).push(evidence);
  }
  return groups;
}

function buildFactCandidates(sources = [], topic = '') {
  const groups = collectFactGroups(sources, topic);
  const rows = [];
  const maxDepth = Math.max(0, ...[...groups.values()].map(evidence => evidence.length));
  let order = 0;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const [sourceId, evidence] of groups.entries()) {
      const value = evidence[depth];
      if (!value) continue;
      const source = sourceForId(sources, sourceId) || {};
      const detail = semanticTokens(value, topic).length;
      rows.push({
        sourceId,
        evidence: value,
        sourceTitle: cleanEvidence(source.title),
        publishedAt: source.publishedAt || source.discovery?.publishedAt || null,
        order,
        score: Math.max(0, 8 - depth * 0.45 - order * 0.015) + Math.min(detail, 12) * 0.04 + (ANNOUNCEMENT.test(value) ? 0.35 : 0)
      });
      order += 1;
    }
  }
  return rows.sort((a, b) => b.score - a.score || a.order - b.order);
}

function selectDistinctFacts(sources = [], topic = '', count = SLIDE_COUNT) {
  const candidates = buildFactCandidates(sources, topic);
  if (!candidates.length) return [];
  const selected = [];
  const sourceUses = new Map();
  const overview = candidates.find(candidate => ANNOUNCEMENT.test(candidate.evidence));
  const first = overview || candidates[0];
  selected.push(first);
  sourceUses.set(first.sourceId, 1);

  for (const threshold of [STRICT_FACT_SIMILARITY, RELAXED_FACT_SIMILARITY, 0.88]) {
    while (selected.length < count) {
      let best = null;
      for (const candidate of candidates) {
        if (selected.includes(candidate)) continue;
        if (selected.some(existing => sameFactContext(existing.evidence, candidate.evidence, topic))) continue;
        const maxSimilarity = Math.max(0, ...selected.map(existing => semanticSimilarity(existing.evidence, candidate.evidence, topic)));
        if (maxSimilarity >= threshold) continue;
        const uses = sourceUses.get(candidate.sourceId) || 0;
        const adjusted = candidate.score + (uses === 0 ? 0.55 : 0) - uses * 0.12 + (1 - maxSimilarity) * 0.3;
        if (!best || adjusted > best.adjusted) best = { candidate, adjusted };
      }
      if (!best) break;
      selected.push(best.candidate);
      sourceUses.set(best.candidate.sourceId, (sourceUses.get(best.candidate.sourceId) || 0) + 1);
    }
    if (selected.length >= count) break;
  }

  // Search-snippet fallback can legitimately expose fewer than four unique
  // sentences even though the topic itself is valid. Keep the universal topic
  // acceptance contract by filling only after every strict diversity pass has
  // been exhausted. Rich articles never enter this branch.
  if (selected.length < count) {
    const remaining = candidates
      .filter(candidate => !selected.includes(candidate))
      .map(candidate => ({
        candidate,
        similarity: Math.max(0, ...selected.map(existing => semanticSimilarity(existing.evidence, candidate.evidence, topic)))
      }))
      .sort((a, b) => a.similarity - b.similarity || b.candidate.score - a.candidate.score);
    for (const row of remaining) {
      if (selected.length >= count) break;
      selected.push({ ...row.candidate, sparseFallback: true });
    }
  }
  for (let index = 0; selected.length < count && candidates.length; index += 1) {
    selected.push({ ...candidates[index % candidates.length], sparseFallback: true });
  }
  return selected.slice(0, count);
}

function buildSlidePackets(sources = [], topic = '', format = 'Fakta singkat') {
  const selected = selectDistinctFacts(sources, topic, SLIDE_COUNT);
  const sections = sectionsForFormat(format);
  return selected.map((fact, slideIndex) => ({
    slideIndex,
    section: sections[slideIndex],
    primarySourceId: fact.sourceId,
    sourceTitle: fact.sourceTitle,
    publishedAt: fact.publishedAt,
    topic,
    mainEvidence: fact.evidence,
    sparseFallback: fact.sparseFallback === true,
    evidence: [fact.evidence]
  }));
}

function writerPrompt({ topic, format, packets }) {
  return `AUTO SOURCE SEDERHANA — TANPA URL.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nEMPAT FAKTA UNIK PER SLIDE:\n${JSON.stringify(packets)}\n\nTUGAS:\nTulis carousel Bahasa Indonesia 4 slide langsung dari fakta unik di atas.\n\nATURAN:\n- Slide N WAJIB menjelaskan mainEvidence slide N. Jangan menggantinya dengan headline umum atau fakta slide lain.\n- Empat mainEvidence sudah dideduplikasi lintas sumber. Pertahankan empat sudut berbeda; jangan mengulang pengumuman yang sama dengan wording lain.\n- Gunakan hanya evidence yang ada pada paket slide. Jangan memakai pengetahuan luar.\n- Jangan menjadikan heading FAQ atau kalimat pertanyaan sebagai isi fakta. Body wajib pernyataan lengkap yang menjawab pembaca.\n- Judul harus natural, spesifik, ringkas, dan Bahasa Indonesia; nama produk, model, perusahaan, singkatan, atau istilah teknis boleh tetap dalam bentuk aslinya.\n- Body harus padat dan informatif, biasanya sekitar 10-24 kata. Jangan membuat body filler atau pertanyaan kosong.\n- Bullet TIDAK wajib. Gunakan 0-3 bullet hanya jika mainEvidence memuat detail tambahan yang benar-benar berbeda dari judul/body. Setiap bullet harus utuh dan dapat dipahami sendiri.\n- Jangan mengulang ide/konteks yang sama di body, bullet, atau slide lain.\n- Jangan menambahkan sebab-akibat, manfaat, tujuan, strategi, implikasi, angka, versi, tanggal, lokasi, atau kepastian yang tidak dinyatakan evidence.\n- Untuk body dan setiap bullet, WAJIB sertakan claim dengan field yang tepat, text sama persis dengan copy visible, sourceId sama dengan primarySourceId slide, dan evidence VERBATIM dari paket slide.\n- Title tidak perlu claim jika hanya merangkum body secara editorial. Title tidak boleh menambahkan fakta baru yang tidak ada di body/evidence.\n\nKembalikan HANYA JSON:\n{"slides":[{"title":"...","body":"...","points":["..."],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
}

function checkerPrompt({ topic, format, packets, candidate }) {
  return `FACT CHECK + EDITOR FINAL AUTO SOURCE.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nPAKET FAKTA TERPERCAYA:\n${JSON.stringify(packets)}\n\nDRAFT:\n${JSON.stringify(candidate?.slides || [])}\n\nPERIKSA DAN PERBAIKI LANGSUNG:\n- Slide N harus tetap menjelaskan mainEvidence slide N; jangan mengubah semua slide menjadi pengumuman umum yang sama.\n- Setiap body/bullet harus benar-benar dibuktikan satu evidence pada paket slide yang sama.\n- Jika satu body salah/terlalu luas, tulis ulang secara konservatif dari evidence slide itu. Body harus berupa pernyataan lengkap, bukan FAQ/pertanyaan.\n- Jika satu bullet salah, meragukan, terpotong, bergantung pada lanjutan kalimat, atau mengulang konteks, perbaiki atau HAPUS bullet tersebut. Jangan menggagalkan seluruh carousel.\n- Jangan memaksa jumlah bullet; 0-3 bullet boleh.\n- Jangan mencampur primarySourceId antar-slide.\n- Jangan menambah fakta baru. Pertahankan angka, persentase, model, versi, nama, tanggal, lokasi, modalitas, dan ketidakpastian sesuai evidence.\n- Judul harus natural Bahasa Indonesia, tetapi nama produk/model/istilah teknis boleh tetap asli. Judul hanya merangkum isi slide dan tidak boleh menambah klaim baru.\n- Untuk body dan bullet final, claim.text harus sama persis dengan copy; sourceId harus primarySourceId slide; evidence harus VERBATIM dari paket slide.\n- Hasil akhir harus padat, natural, tidak double context, dan tetap 4 slide.\n\nKembalikan HANYA JSON final dengan schema yang sama: {"slides":[...]}`;
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

function copyForField(slide, field) {
  const match = String(field || '').match(/^slide:\d+:(body|point:(\d+))$/);
  if (!match) return '';
  if (match[1] === 'body') return String(slide?.body || '').replace(/\s+/g, ' ').trim();
  return String(slide?.points?.[Number(match[2])] || '').replace(/\s+/g, ' ').trim();
}

function cleanupSlide(slide = {}, slideIndex = 0, packet = {}) {
  const title = String(slide.title || '').replace(/\s+/g, ' ').trim();
  const body = String(slide.body || '').replace(/\s+/g, ' ').trim();
  const keptPoints = [];
  const pointMap = new Map();
  for (const [oldIndex, raw] of (Array.isArray(slide.points) ? slide.points : []).entries()) {
    const point = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!point || keptPoints.length >= MAX_POINTS || questionOnlyEvidence(point) || endsWithDanglingFragment(point)) continue;
    if (similarity(point, body) >= 0.88 || similarity(point, title) >= 0.92) continue;
    if (keptPoints.some(existing => similarity(existing, point) >= 0.88)) continue;
    pointMap.set(oldIndex, keptPoints.length);
    keptPoints.push(point);
  }

  const claims = [];
  const seenFields = new Set();
  for (const original of Array.isArray(slide.claims) ? slide.claims : []) {
    let field = String(original?.field || '').trim();
    const pointMatch = field.match(new RegExp(`^slide:${slideIndex}:point:(\\d+)$`));
    if (pointMatch) {
      const newIndex = pointMap.get(Number(pointMatch[1]));
      if (newIndex === undefined) continue;
      field = `slide:${slideIndex}:point:${newIndex}`;
    }
    if (field !== `slide:${slideIndex}:body` && !new RegExp(`^slide:${slideIndex}:point:\\d+$`).test(field)) continue;
    if (seenFields.has(field)) continue;
    const copy = copyForField({ body, points: keptPoints }, field);
    if (!copy) continue;
    claims.push({
      field,
      text: copy,
      sourceId: String(original?.sourceId || '').trim(),
      evidence: String(original?.evidence || '').replace(/\s+/g, ' ').trim()
    });
    seenFields.add(field);
  }

  return {
    section: packet.section,
    title,
    body,
    points: keptPoints,
    claims
  };
}

function normalizeCandidate(parsed = {}, packets = []) {
  const rawSlides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  return {
    slides: packets.map((packet, index) => cleanupSlide(rawSlides[index] || {}, index, packet))
  };
}

function canonicalNumbers(value) {
  const out = [];
  const pattern = /\b(\d+(?:[.,]\d+)?)(?:\s*(%|persen|percent|per\s+cent))?/gi;
  for (const match of String(value || '').matchAll(pattern)) {
    let number = String(match[1]).replace(',', '.');
    if (/^\d+\.\d+$/.test(number)) number = number.replace(/0+$/, '').replace(/\.$/, '');
    out.push(`${number}${match[2] ? '%' : ''}`);
  }
  return out;
}

function numbersSupported(copy, evidence) {
  const wanted = canonicalNumbers(copy);
  if (!wanted.length) return true;
  const available = new Set(canonicalNumbers(evidence));
  return wanted.every(value => available.has(value));
}

function evidenceLiteralInSource(evidence, source) {
  const needle = normalize(evidence);
  if (!needle) return false;
  return normalize(`${source?.title || ''} ${source?.text || ''}`).includes(needle);
}

function evidenceAllowedByPacket(evidence, packet) {
  const key = normalize(evidence);
  return Boolean(key) && (packet?.evidence || []).some(value => normalize(value) === key);
}

function claimMap(slide = {}) {
  return new Map((Array.isArray(slide.claims) ? slide.claims : []).map(claim => [String(claim?.field || '').trim(), claim]));
}

function bestEvidenceForCopy(copy, packet = {}) {
  const copyTokens = meaningfulTokens(copy);
  const ranked = (packet.evidence || []).map(evidence => {
    const evidenceTokens = new Set(meaningfulTokens(evidence));
    const shared = copyTokens.filter(token => evidenceTokens.has(token)).length;
    const score = copyTokens.length ? shared / copyTokens.length : 0;
    return { evidence, score, numeric: numbersSupported(copy, evidence) };
  }).filter(item => item.numeric).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return null;
  if (best.score >= 0.2 || canonicalNumbers(copy).length) return best.evidence;
  return null;
}

function repairClaimMetadata(candidate, packets, sources) {
  const slides = candidate.slides.map((slide, slideIndex) => {
    const packet = packets[slideIndex];
    const map = claimMap(slide);
    const repaired = [];
    const fields = [
      [`slide:${slideIndex}:body`, slide.body],
      ...slide.points.map((point, pointIndex) => [`slide:${slideIndex}:point:${pointIndex}`, point])
    ];
    for (const [field, copy] of fields) {
      if (!copy) continue;
      const current = map.get(field);
      const currentSource = sourceForId(sources, current?.sourceId);
      const currentValid = current
        && current.sourceId === packet.primarySourceId
        && evidenceAllowedByPacket(current.evidence, packet)
        && evidenceLiteralInSource(current.evidence, currentSource)
        && numbersSupported(copy, current.evidence);
      if (currentValid) {
        repaired.push({ ...current, field, text: copy });
        continue;
      }
      const evidence = bestEvidenceForCopy(copy, packet);
      if (evidence) repaired.push({ field, text: copy, sourceId: packet.primarySourceId, evidence });
    }
    return { ...slide, claims: repaired };
  });
  return { ...candidate, slides };
}

function factualErrors(candidate, packets, sources) {
  const errors = [];
  if (!Array.isArray(candidate?.slides) || candidate.slides.length !== SLIDE_COUNT) {
    errors.push(`slides: wajib tepat ${SLIDE_COUNT} slide.`);
    return errors;
  }

  const previousFacts = [];
  candidate.slides.forEach((slide, slideIndex) => {
    const packet = packets[slideIndex];
    if (!packet) { errors.push(`slide:${slideIndex}: paket fakta tidak tersedia.`); return; }
    if (!String(slide.title || '').trim()) errors.push(`slide:${slideIndex}:title kosong.`);
    if (!String(slide.body || '').trim()) errors.push(`slide:${slideIndex}:body kosong.`);
    if (questionOnlyEvidence(slide.body)) errors.push(`slide:${slideIndex}:body berupa FAQ/pertanyaan tanpa jawaban.`);
    if (endsWithDanglingFragment(slide.body)) errors.push(`slide:${slideIndex}:body terpotong atau berakhir pada kata gantung.`);
    if ((slide.points || []).length > MAX_POINTS) errors.push(`slide:${slideIndex}: terlalu banyak bullet.`);

    const map = claimMap(slide);
    const fields = [
      [`slide:${slideIndex}:body`, String(slide.body || '').trim()],
      ...(slide.points || []).map((point, pointIndex) => [`slide:${slideIndex}:point:${pointIndex}`, String(point || '').trim()])
    ];
    for (const [field, copy] of fields) {
      if (!copy) continue;
      const claim = map.get(field);
      if (!claim) { errors.push(`${field}: claim/evidence tidak ada.`); continue; }
      if (normalize(claim.text) !== normalize(copy)) errors.push(`${field}: claim.text tidak sama dengan copy.`);
      if (claim.sourceId !== packet.primarySourceId) errors.push(`${field}: sourceId tidak sesuai sumber slide.`);
      if (!evidenceAllowedByPacket(claim.evidence, packet)) errors.push(`${field}: evidence tidak berasal dari paket fakta slide.`);
      const source = sourceForId(sources, claim.sourceId);
      if (!evidenceLiteralInSource(claim.evidence, source)) errors.push(`${field}: evidence tidak ditemukan pada sumber.`);
      if (!numbersSupported(copy, claim.evidence)) errors.push(`${field}: angka/persentase tidak didukung evidence.`);
    }

    const substantive = [
      { field: `slide:${slideIndex}:body`, value: slide.body },
      ...(slide.points || []).map((value, pointIndex) => ({ field: `slide:${slideIndex}:point:${pointIndex}`, value }))
    ].filter(item => item.value);
    for (const item of substantive) {
      const duplicate = previousFacts.find(previous => sameFactContext(previous.value, item.value, packet?.topic || ''));
      if (duplicate) {
        errors.push(item.field.includes(':point:')
          ? `${item.field}: konteks/fakta mengulang copy sebelumnya.`
          : `slide:${slideIndex}: konteks/fakta mengulang slide sebelumnya.`);
        break;
      }
      previousFacts.push({ ...item, slideIndex });
    }
  });
  return [...new Set(errors)];
}

function sentence(value) {
  const text = cleanEvidence(value).replace(/[\s,;:]+$/g, '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function buildCaption(slides = [], fallback = '', topic = '') {
  const selected = [];
  for (const slide of slides) {
    const body = cleanEvidence(slide?.body);
    if (!body || questionOnlyEvidence(body) || endsWithDanglingFragment(body)) continue;
    if (selected.some(existing => sameFactContext(existing, body, topic))) continue;
    selected.push(body);
    if (selected.length >= 2) break;
  }
  if (!selected.length && cleanEvidence(fallback)) selected.push(cleanEvidence(fallback));
  return selected.map(sentence).filter(Boolean).join(' ');
}

function invalidPointCoordinates(errors = []) {
  const coordinates = new Set();
  errors.forEach(error => {
    const match = String(error || '').match(/^slide:(\d+):point:(\d+):/);
    if (match) coordinates.add(`${Number(match[1])}:${Number(match[2])}`);
  });
  return coordinates;
}

function dropInvalidPoints(candidate, errors = [], packets = []) {
  const invalid = invalidPointCoordinates(errors);
  if (!invalid.size) return candidate;
  const slides = candidate.slides.map((slide, slideIndex) => {
    const kept = [];
    const indexMap = new Map();
    slide.points.forEach((point, oldIndex) => {
      if (invalid.has(`${slideIndex}:${oldIndex}`)) return;
      indexMap.set(oldIndex, kept.length);
      kept.push(point);
    });
    const claims = [];
    for (const claim of slide.claims || []) {
      const pointMatch = String(claim.field || '').match(new RegExp(`^slide:${slideIndex}:point:(\\d+)$`));
      if (!pointMatch) { claims.push(claim); continue; }
      const next = indexMap.get(Number(pointMatch[1]));
      if (next === undefined) continue;
      claims.push({ ...claim, field: `slide:${slideIndex}:point:${next}`, text: kept[next] });
    }
    return cleanupSlide({ ...slide, points: kept, claims }, slideIndex, packets[slideIndex]);
  });
  return { ...candidate, slides };
}

function deriveSafeTitle(slide = {}) {
  const title = String(slide.title || '').trim();
  const body = String(slide.body || '').trim();
  if (title && !canonicalNumbers(title).some(value => !canonicalNumbers(body).includes(value)) && similarity(title, body) >= 0.15) return title;
  const tokens = words(body.replace(/[.!?]+$/g, ''));
  const fallback = tokens.slice(0, Math.min(7, tokens.length)).join(' ').replace(/[,;:\-–—]+$/g, '').trim();
  return fallback ? fallback.charAt(0).toLocaleUpperCase('id-ID') + fallback.slice(1) : (title || 'Fakta utama');
}

function finalizeVisibleCopy(candidate, packets, sources) {
  let result = {
    ...candidate,
    slides: candidate.slides.map((slide, index) => ({ ...slide, title: deriveSafeTitle(slide), section: packets[index]?.section || slide.section }))
  };
  result = repairClaimMetadata(result, packets, sources);
  let errors = factualErrors(result, packets, sources);
  result = dropInvalidPoints(result, errors, packets);
  result = repairClaimMetadata(result, packets, sources);
  errors = factualErrors(result, packets, sources);
  return { candidate: result, errors };
}

function syncTop(candidate, topic, format, discovery) {
  const slides = candidate.slides || [];
  const first = slides[0] || {};
  const middle = slides.find((slide, index) => index > 0 && index < slides.length - 1 && slide.body) || first;
  const last = slides.at(-1) || first;
  return {
    topic,
    hook: String(first.title || topic).trim(),
    body: String(middle.body || first.body || topic).trim(),
    caption: buildCaption(slides, middle.body || first.body || topic, topic),
    hashtags: [],
    cta: String(last.title || 'Ringkasan').trim(),
    trendKeywordsUsed: [],
    content_angle: `ringkasan faktual terbaru tentang ${topic}`,
    primary_tool: 'tanpa tool',
    hook_pattern: 'auto-source-simple',
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

async function callJson(openai, system, user) {
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' }
  });
  return parseJsonResponse(response);
}

async function compose({ options = {}, sources = [], discovery = null, client } = {}) {
  if (!sources.length) throw Object.assign(new Error('Auto Source tidak menemukan sumber yang dapat dibaca.'), { status: 422 });
  const topic = String(options.requestedTopic || discovery?.topic || sources[0]?.title || 'Topik sumber').trim();
  const format = options.contentFormat || 'Fakta singkat';
  const packets = buildSlidePackets(sources, topic, format);
  if (packets.length !== SLIDE_COUNT) {
    throw Object.assign(new Error('Auto Source belum menemukan fakta yang cukup untuk membentuk 4 slide.'), { status: 422 });
  }

  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let writerRaw;
  try {
    writerRaw = await callJson(
      openai,
      'Anda penulis carousel AI Ads Lab. Tulis hanya dari paket fakta yang diberikan; jangan mengarang dan jangan mencampur konteks.',
      writerPrompt({ topic, format, packets })
    );
  } catch (error) {
    throw Object.assign(new Error(`Auto Source gagal menulis draft: ${error.message}`), { status: 502 });
  }

  const writerCandidate = normalizeCandidate(writerRaw, packets);
  let checkerRaw;
  try {
    checkerRaw = await callJson(
      openai,
      'Anda fact-checker sekaligus editor final. Perbaiki bagian yang tidak didukung dan hapus bullet yang meragukan; jangan menggagalkan seluruh carousel.',
      checkerPrompt({ topic, format, packets, candidate: writerCandidate })
    );
  } catch {
    checkerRaw = writerRaw;
  }

  const checkedCandidate = normalizeCandidate(checkerRaw, packets);
  let finalized = finalizeVisibleCopy(checkedCandidate, packets, sources);

  // If the checker damaged a body/claim, prefer the writer version for that slide
  // when the original is factually cleaner. This keeps one bad correction from
  // destroying an otherwise usable carousel.
  if (finalized.errors.some(error => /:body:|body kosong/.test(error))) {
    const original = finalizeVisibleCopy(writerCandidate, packets, sources);
    const mergedSlides = finalized.candidate.slides.map((slide, index) => {
      const currentBodyErrors = finalized.errors.filter(error => error.startsWith(`slide:${index}:body`) || error === `slide:${index}:body kosong.`).length;
      const originalBodyErrors = original.errors.filter(error => error.startsWith(`slide:${index}:body`) || error === `slide:${index}:body kosong.`).length;
      return originalBodyErrors < currentBodyErrors ? original.candidate.slides[index] : slide;
    });
    finalized = finalizeVisibleCopy({ slides: mergedSlides }, packets, sources);
  }

  const blocking = finalized.errors.filter(error => !/:point:\d+:/.test(error));
  if (blocking.length) {
    throw Object.assign(new Error(`Auto Source belum bisa membuktikan isi utama: ${blocking[0]}`), {
      status: 422,
      validationErrors: blocking
    });
  }

  return syncTop(finalized.candidate, topic, format, discovery);
}

module.exports = {
  compose,
  sectionsForFormat,
  collectFactGroups,
  buildFactCandidates,
  selectDistinctFacts,
  buildSlidePackets,
  normalizeCandidate,
  factualErrors,
  numbersSupported,
  evidenceLiteralInSource,
  repairClaimMetadata,
  dropInvalidPoints,
  finalizeVisibleCopy,
  similarity,
  semanticSimilarity,
  sameFactContext,
  questionOnlyEvidence,
  endsWithDanglingFragment,
  buildCaption,
  SLIDE_COUNT,
  MAX_POINTS,
  STRICT_FACT_SIMILARITY,
  RELAXED_FACT_SIMILARITY
};
