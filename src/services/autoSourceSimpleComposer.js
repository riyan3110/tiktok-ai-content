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
    if (!groups.has(sourceId) || !evidence) continue;
    const key = normalize(evidence);
    if (!key || seen.get(sourceId).has(key) || groups.get(sourceId).length >= MAX_FACTS_PER_SOURCE) continue;
    seen.get(sourceId).add(key);
    groups.get(sourceId).push(evidence);
  }
  return groups;
}

function buildSlidePackets(sources = [], topic = '', format = 'Fakta singkat') {
  const groups = collectFactGroups(sources, topic);
  const sourceIds = [...groups.entries()].filter(([, evidence]) => evidence.length).map(([sourceId]) => sourceId);
  if (!sourceIds.length) return [];

  const owners = sourceIds.slice(0, SLIDE_COUNT);
  const useCount = new Map(sourceIds.map(id => [id, owners.filter(owner => owner === id).length]));
  while (owners.length < SLIDE_COUNT) {
    const ranked = [...sourceIds].sort((a, b) => {
      const aUses = useCount.get(a) || 0;
      const bUses = useCount.get(b) || 0;
      const aCapacity = groups.get(a).length / (aUses + 1);
      const bCapacity = groups.get(b).length / (bUses + 1);
      return bCapacity - aCapacity || aUses - bUses;
    });
    const owner = ranked[0] || sourceIds[owners.length % sourceIds.length];
    owners.push(owner);
    useCount.set(owner, (useCount.get(owner) || 0) + 1);
  }

  const sections = sectionsForFormat(format);
  const slideIndexesBySource = new Map(sourceIds.map(id => [id, []]));
  owners.forEach((owner, slideIndex) => slideIndexesBySource.get(owner)?.push(slideIndex));
  const packets = new Array(SLIDE_COUNT);

  for (const sourceId of sourceIds) {
    const slideIndexes = slideIndexesBySource.get(sourceId) || [];
    const evidence = groups.get(sourceId) || [];
    const chunkSize = Math.max(1, Math.ceil(evidence.length / Math.max(1, slideIndexes.length)));
    slideIndexes.forEach((slideIndex, localIndex) => {
      let chunk = evidence.slice(localIndex * chunkSize, (localIndex + 1) * chunkSize).slice(0, 6);
      if (!chunk.length) chunk = evidence.slice(0, Math.min(3, evidence.length));
      const source = sourceForId(sources, sourceId) || {};
      packets[slideIndex] = {
        slideIndex,
        section: sections[slideIndex],
        primarySourceId: sourceId,
        sourceTitle: String(source.title || '').replace(/\s+/g, ' ').trim(),
        publishedAt: source.publishedAt || source.discovery?.publishedAt || null,
        evidence: chunk
      };
    });
  }
  return packets.filter(Boolean);
}

function writerPrompt({ topic, format, packets }) {
  return `AUTO SOURCE SEDERHANA — TANPA URL.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nPAKET FAKTA PER SLIDE:\n${JSON.stringify(packets)}\n\nTUGAS:\nTulis carousel Bahasa Indonesia 4 slide langsung dari paket fakta di atas.\n\nATURAN:\n- Satu slide hanya membahas satu subtopik dari satu primarySourceId milik slide tersebut. Jangan mencampur konteks artikel lain.\n- Gunakan hanya evidence yang ada pada paket slide. Jangan memakai pengetahuan luar.\n- Judul harus natural, spesifik, ringkas, dan Bahasa Indonesia; nama produk, model, perusahaan, singkatan, atau istilah teknis boleh tetap dalam bentuk aslinya.\n- Body harus padat dan informatif, biasanya sekitar 10-24 kata. Jangan membuat body filler atau pertanyaan kosong.\n- Bullet TIDAK wajib. Gunakan 0-3 bullet hanya jika ada fakta tambahan yang benar-benar berbeda dari judul/body.\n- Jangan mengulang ide/konteks yang sama di body, bullet, atau slide lain.\n- Jangan menambahkan sebab-akibat, manfaat, tujuan, strategi, implikasi, angka, versi, tanggal, lokasi, atau kepastian yang tidak dinyatakan evidence.\n- Untuk body dan setiap bullet, WAJIB sertakan claim dengan field yang tepat, text sama persis dengan copy visible, sourceId sama dengan primarySourceId slide, dan evidence VERBATIM dari paket slide.\n- Title tidak perlu claim jika hanya merangkum body secara editorial. Title tidak boleh menambahkan fakta baru yang tidak ada di body/evidence.\n- Semua sumber yang sudah mendapat paket slide wajib benar-benar menyumbang isi.\n\nKembalikan HANYA JSON:\n{"slides":[{"title":"...","body":"...","points":["..."],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
}

function checkerPrompt({ topic, format, packets, candidate }) {
  return `FACT CHECK + EDITOR FINAL AUTO SOURCE.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nPAKET FAKTA TERPERCAYA:\n${JSON.stringify(packets)}\n\nDRAFT:\n${JSON.stringify(candidate?.slides || [])}\n\nPERIKSA DAN PERBAIKI LANGSUNG:\n- Setiap body/bullet harus benar-benar dibuktikan satu evidence pada paket slide yang sama.\n- Jika satu body salah/terlalu luas, tulis ulang secara konservatif dari evidence slide itu.\n- Jika satu bullet salah, meragukan, atau mengulang konteks, perbaiki atau HAPUS bullet tersebut. Jangan menggagalkan seluruh carousel.\n- Jangan memaksa jumlah bullet; 0-3 bullet boleh.\n- Jangan mencampur primarySourceId antar-slide.\n- Jangan menambah fakta baru. Pertahankan angka, persentase, model, versi, nama, tanggal, lokasi, modalitas, dan ketidakpastian sesuai evidence.\n- Judul harus natural Bahasa Indonesia, tetapi nama produk/model/istilah teknis boleh tetap asli. Judul hanya merangkum isi slide dan tidak boleh menambah klaim baru.\n- Untuk body dan bullet final, claim.text harus sama persis dengan copy; sourceId harus primarySourceId slide; evidence harus VERBATIM dari paket slide.\n- Hasil akhir harus padat, natural, tidak double context, dan tetap 4 slide.\n\nKembalikan HANYA JSON final dengan schema yang sama: {"slides":[...]}`;
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
    if (!point || keptPoints.length >= MAX_POINTS) continue;
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

    const substantive = [slide.body, ...(slide.points || [])].filter(Boolean);
    for (const value of substantive) {
      if (previousFacts.some(previous => similarity(previous, value) >= 0.9)) {
        errors.push(`slide:${slideIndex}: konteks/fakta mengulang slide sebelumnya.`);
        break;
      }
      previousFacts.push(value);
    }
  });
  return [...new Set(errors)];
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
    caption: String(middle.body || first.body || topic).trim(),
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
  buildSlidePackets,
  normalizeCandidate,
  factualErrors,
  numbersSupported,
  evidenceLiteralInSource,
  repairClaimMetadata,
  dropInvalidPoints,
  finalizeVisibleCopy,
  similarity,
  SLIDE_COUNT,
  MAX_POINTS
};
