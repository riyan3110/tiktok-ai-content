const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const manualSourceDedupe = require('./manualSourceDedupe');

const MAX_COMPOSE_ATTEMPTS = 4;
const MAX_BANK_FACTS = 48;
const TOPIC_STOPWORDS = new Set([
  'yang', 'dan', 'atau', 'dari', 'untuk', 'dengan', 'tentang', 'cara', 'adalah', 'pada', 'itu', 'ini',
  'sebagai', 'daftar', 'tips', 'trik', 'yuk', 'mulai', 'rutin', 'cek', 'mengenal'
]);
const SOURCE_NOISE = /(?:baca\s+juga|read\s+more|artikel\s+terkait|recommended|rekomendasi\s+artikel|most\s+popular|be\s+stories|bagikan|komentar|tags?|newsletter|subscribe|ikuti\s+kami|copyright|hak\s+cipta|login|masuk|daftar\s+akun)/i;
const GENERIC_COPY = /^(?:pembuka|kesimpulan|ringkasan|poin penting|fakta utama|mengenal|ketahui|simak|cek selengkapnya|lanjut baca)$/i;

const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '')
  .toLocaleLowerCase('id-ID')
  .replace(/&nbsp;/gi, ' ')
  .replace(/[^a-z0-9%\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function topicTokens(value) {
  return [...new Set(normalize(value).split(' ').filter(token => token.length > 2 && !TOPIC_STOPWORDS.has(token)))];
}

function canonicalEvidenceKey(sourceId, evidence) {
  const normalized = normalize(evidence);
  return sourceId && normalized ? `${sourceId}::${normalized}` : '';
}

function splitLongSentence(sentence) {
  const clean = String(sentence || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (words(clean).length <= 32) return [clean];
  return clean.split(/(?<=[;:])\s+|\s+[—–]\s+|,\s+(?=(?:sedangkan|sementara|tetapi|namun|dan)\s+)/i)
    .map(value => value.trim())
    .filter(value => words(value).length >= 4 && words(value).length <= 32);
}

function evidenceCandidates(text) {
  const lines = String(text || '').replace(/\r/g, '\n').split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const results = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (SOURCE_NOISE.test(line)) continue;
    const lineWords = words(line).length;
    if (lineWords > 0 && lineWords < 4 && lines[index + 1] && !SOURCE_NOISE.test(lines[index + 1])) {
      const merged = `${line} ${lines[index + 1]}`.replace(/\s+/g, ' ').trim();
      if (words(merged).length >= 4 && words(merged).length <= 32) results.push(merged);
    }
    const sentences = line.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      for (const candidate of splitLongSentence(sentence)) {
        if (words(candidate).length < 4 || SOURCE_NOISE.test(candidate)) continue;
        results.push(candidate);
      }
    }
  }
  if (!results.length) {
    for (const sentence of String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/)) {
      for (const candidate of splitLongSentence(sentence)) {
        if (words(candidate).length >= 4 && !SOURCE_NOISE.test(candidate)) results.push(candidate);
      }
    }
  }
  return [...new Map(results.map(value => [normalize(value), value]).filter(([key]) => key)).values()];
}

function sourceMatchesTopic(source, requestedTopic) {
  const wanted = topicTokens(requestedTopic);
  if (!wanted.length) return true;
  const title = new Set(topicTokens(source?.title || ''));
  const titleOverlap = wanted.filter(token => title.has(token)).length;
  const requiredTitle = Math.max(1, Math.ceil(wanted.length * 0.6));
  if (titleOverlap >= requiredTitle) return true;
  const bodyFacts = evidenceCandidates(source?.text || '');
  const relevantFacts = bodyFacts.filter(fact => {
    const factTokens = new Set(topicTokens(fact));
    return wanted.some(token => factTokens.has(token));
  });
  return relevantFacts.length >= 2;
}

function extractManualFactBank(sources = [], requestedTopic = '') {
  const compatible = sources.map((source, index) => ({
    source,
    sourceId: `source-${index + 1}`,
    matches: sourceMatchesTopic(source, requestedTopic)
  }));
  if (!compatible.some(item => item.matches)) {
    throw Object.assign(new Error('URL sumber tidak cukup relevan dengan topik manual; konten tidak akan dibuat dari fakta yang tidak sesuai.'), { status: 422 });
  }

  const wanted = topicTokens(requestedTopic);
  const bank = [];
  const seen = new Set();
  for (const item of compatible) {
    if (!item.matches) continue;
    const titleTokens = new Set(topicTokens(item.source?.title || ''));
    const titleMatch = wanted.length === 0 || wanted.filter(token => titleTokens.has(token)).length >= Math.max(1, Math.ceil(wanted.length * 0.6));
    const candidates = evidenceCandidates(item.source?.text || '');
    for (let order = 0; order < candidates.length; order += 1) {
      const evidence = candidates[order];
      const key = canonicalEvidenceKey(item.sourceId, evidence);
      if (!key || seen.has(key)) continue;
      const evidenceSet = new Set(topicTokens(evidence));
      const overlap = wanted.filter(token => evidenceSet.has(token)).length;
      // When the article title matches the manual topic, item paragraphs belong to that cleaned article
      // even if every individual item does not repeat the title keywords.
      if (!titleMatch && wanted.length && overlap === 0) continue;
      seen.add(key);
      bank.push({ sourceId: item.sourceId, evidence, order, overlap });
      if (bank.length >= MAX_BANK_FACTS) break;
    }
    if (bank.length >= MAX_BANK_FACTS) break;
  }

  const sorted = bank.sort((a, b) => b.overlap - a.overlap || a.order - b.order)
    .map(({ sourceId, evidence }) => ({ sourceId, evidence }));
  if (sorted.length < 3) {
    throw Object.assign(new Error('Sumber belum menyediakan cukup fakta bersih untuk membuat carousel yang padat dan akurat.'), { status: 422 });
  }
  return sorted;
}

function expectedListCount(sources = [], bank = []) {
  for (const source of sources) {
    const title = String(source?.title || '').trim();
    const match = title.match(/^\s*(\d{1,2})\b/);
    if (!match) continue;
    const count = Number(match[1]);
    if (count >= 3 && count <= 20) return Math.min(5, Math.max(4, count));
  }
  return bank.length >= 8 ? 5 : 4;
}

function normalizedFormat(value) {
  return String(value || '').trim().toLocaleLowerCase('id-ID');
}

function desiredSlideCount(format, sources, bank) {
  if (normalizedFormat(format) === 'listicle') return expectedListCount(sources, bank);
  return bank.length >= 7 ? 5 : 4;
}

function formatRule(format, slideCount) {
  const normalized = normalizedFormat(format);
  if (normalized === 'listicle') {
    return `LISTICLE KETAT: buat tepat ${slideCount} slide dan SEMUANYA adalah item substantif dengan section ITEM 1 sampai ITEM ${slideCount}. Jangan buang slot untuk intro atau penutup generik. Setiap slide membahas SATU item berbeda dari sumber; title, body, points, dan evidence dalam slide yang sama harus membahas item yang sama.`;
  }
  if (normalized === 'fakta singkat') {
    return `FAKTA SINGKAT: buat tepat ${slideCount} slide fakta/penjelasan berbeda. Jangan gunakan LANGKAH, tutorial, atau saran yang tidak dinyatakan sumber.`;
  }
  if (normalized === 'tutorial langkah') {
    return `TUTORIAL: buat tepat ${slideCount} slide dengan pembuka singkat, minimal dua LANGKAH pengguna yang benar-benar didukung sumber, dan penutup/outcome hanya jika didukung sumber.`;
  }
  if (normalized === 'masalah dan solusi') {
    return `MASALAH DAN SOLUSI: buat tepat ${slideCount} slide; satu MASALAH yang didukung sumber, minimal dua SOLUSI berupa tindakan pengguna yang didukung sumber, lalu HASIL/PENUTUP hanya jika evidence mendukung.`;
  }
  if (normalized === 'tips cepat') {
    return `TIPS CEPAT: buat tepat ${slideCount} slide; tiap tips adalah tindakan berbeda yang benar-benar disebut/didukung sumber. Jangan mengubah fakta deskriptif menjadi saran.`;
  }
  if (normalized === 'before-after') {
    return `BEFORE-AFTER: buat tepat ${slideCount} slide dan hanya gunakan hubungan kondisi sebelum/sesudah yang benar-benar dinyatakan sumber. Jika hubungan itu tidak tersedia, jangan mengarang.`;
  }
  return `Gunakan tepat ${slideCount} slide sesuai format ${format}; setiap slide harus punya fungsi jelas dan tetap source-backed.`;
}

async function resolveEffectiveFormat(openai, requestedFormat, bank) {
  const normalized = normalizedFormat(requestedFormat);
  if (!['tutorial langkah', 'masalah dan solusi', 'tips cepat', 'before-after'].includes(normalized)) return requestedFormat;
  try {
    const response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        { role: 'system', content: 'Anda menilai kecocokan format carousel terhadap fakta sumber. Jangan menulis konten.' },
        { role: 'user', content: `FORMAT: ${requestedFormat}\nFACT_BANK: ${JSON.stringify(bank)}\nNilai apakah FACT_BANK benar-benar cukup untuk format tersebut TANPA mengarang. Tutorial perlu minimal dua tindakan pengguna berurutan; Masalah dan solusi perlu masalah + minimal dua tindakan solusi; Tips cepat perlu minimal tiga tips/tindakan; Before-after perlu kondisi sebelum dan sesudah yang benar-benar didukung. Kembalikan HANYA JSON {"fit":true}.` }
      ],
      response_format: { type: 'json_object' }
    });
    const raw = response?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(raw || '{}');
    return parsed?.fit === true ? requestedFormat : 'Fakta singkat';
  } catch {
    return 'Fakta singkat';
  }
}

function promptForComposition({ requestedTopic, requestedFormat, effectiveFormat, slideCount, bank, errors = [], current = null }) {
  const repair = current ? `\nHASIL SEBELUMNYA:\n${JSON.stringify(current)}\nERROR YANG WAJIB DIPERBAIKI:\n${errors.join('\n')}` : '';
  const rich = bank.length >= Math.max(8, slideCount * 2 - 1);
  const density = rich
    ? 'Setiap slide wajib terasa penuh tetapi tetap enak dibaca: body 14–24 kata DAN 1–2 points, masing-masing 3–7 kata. Total body+points minimal 20 kata substantif per slide. Gunakan fakta tambahan, bukan filler.'
    : 'Setiap slide wajib informatif: body 12–24 kata dan tambahkan point hanya bila ada fakta pendukung berbeda. Jangan mengarang demi panjang.';
  return `KOMPOSISI FINAL MANUAL + URL — SOURCE ONLY.\n\nTOPIK MANUAL: ${JSON.stringify(requestedTopic)}\nFORMAT DIMINTA: ${JSON.stringify(requestedFormat)}\nFORMAT EFEKTIF YANG DITETAPKAN SISTEM: ${JSON.stringify(effectiveFormat)}\n${formatRule(effectiveFormat, slideCount)}\n${density}\n\nATURAN ABSOLUT:\n- Gunakan HANYA FACT_BANK di bawah. Dilarang memakai pengetahuan internal, artikel lain, link terkait, rekomendasi halaman, atau tebakan.\n- Semua fakta yang tampil harus langsung relevan dengan TOPIK MANUAL. Jangan mengambil side-note yang tidak menjawab topik.\n- Jangan menulis fakta tentang asam urat, lemak perut, waktu makan, atau topik kesehatan lain kecuali itu memang fokus TOPIK MANUAL dan tersedia di FACT_BANK.\n- Setiap body dan setiap point WAJIB mempunyai claim dengan field persis slide:X:body atau slide:X:point:Y. Title yang menyebut item/fakta spesifik juga WAJIB punya claim slide:X:title.\n- claim.text harus PERSIS sama dengan copy field. sourceId dan evidence harus disalin PERSIS dari SATU entri FACT_BANK yang mendukung claim tersebut.\n- Evidence jangan diterjemahkan atau diparafrasekan. Copy tampil harus Bahasa Indonesia natural.\n- Satu slide = satu ide/item. Title, body, points, dan evidence harus saling nyambung.\n- Jangan memakai fakta canonical yang sama untuk mengisi dua slide berbeda.\n- Jangan membuat pembuka/penutup kosong atau generik selama fakta sumber masih tersedia.\n- Jangan memperkuat dapat/bisa/mungkin menjadi pasti/selalu/menjamin.\n- Title maksimal 12 kata; body maksimal 24 kata; maksimal 3 points, masing-masing 3–7 kata.\n- Topik output harus persis TOPIK MANUAL.\n- effectiveContentFormat TIDAK BOLEH dibuat atau diubah oleh model; sistem yang menetapkannya.\n\nFACT_BANK:\n${JSON.stringify(bank)}\n${repair}\n\nKembalikan HANYA JSON lengkap:\n{"focus":{"masalah":"...","penyebab":"...","solusi":"...","hasil":"..."},"topic":"${String(requestedTopic).replace(/"/g, '\\"')}","hook":"...","body":"...","caption":"...","hashtags":[],"cta":"...","trendKeywordsUsed":[],"content_angle":"...","primary_tool":"tanpa tool","hook_pattern":"...","verificationStatus":"source_based","unsupportedClaims":[],"slides":[{"section":"ITEM 1","title":"...","body":"...","points":["..."],"claims":[{"field":"slide:0:title","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}.`;
}

function fieldRecords(content) {
  const records = [];
  for (let slideIndex = 0; slideIndex < (content?.slides || []).length; slideIndex += 1) {
    const slide = content.slides[slideIndex];
    records.push({ key: `slide:${slideIndex}:title`, value: String(slide?.title || '').trim(), kind: 'title', slideIndex });
    records.push({ key: `slide:${slideIndex}:body`, value: String(slide?.body || '').trim(), kind: 'body', slideIndex });
    (slide?.points || []).forEach((point, pointIndex) => records.push({ key: `slide:${slideIndex}:point:${pointIndex}`, value: String(point || '').trim(), kind: 'point', slideIndex }));
  }
  return records.filter(record => record.value);
}

function normalizeCandidate(raw, requestedTopic, effectiveFormat, slideCount) {
  if (!raw || !Array.isArray(raw.slides)) return null;
  const slides = raw.slides.slice(0, slideCount).map((slide, slideIndex) => ({
    section: String(slide?.section || '').trim(),
    title: String(slide?.title || '').replace(/\s+/g, ' ').trim(),
    body: String(slide?.body || '').replace(/\s+/g, ' ').trim(),
    points: Array.isArray(slide?.points) ? slide.points.map(point => String(point || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3) : [],
    claims: Array.isArray(slide?.claims) ? slide.claims.map(claim => ({
      field: String(claim?.field || '').trim(),
      text: String(claim?.text || '').replace(/\s+/g, ' ').trim(),
      sourceId: String(claim?.sourceId || '').trim(),
      evidence: String(claim?.evidence || '').replace(/\s+/g, ' ').trim()
    })).filter(claim => claim.field || claim.text || claim.sourceId || claim.evidence) : []
  }));
  if (normalizedFormat(effectiveFormat) === 'listicle') {
    slides.forEach((slide, index) => { slide.section = `ITEM ${index + 1}`; });
  }
  const first = slides[0] || {};
  const informative = slides.find(slide => slide.body || slide.points.length) || first;
  const last = slides.at(-1) || first;
  return {
    focus: {
      masalah: `Memahami ${requestedTopic}`,
      penyebab: 'Fakta berasal dari artikel utama',
      solusi: 'Susun fakta yang paling relevan',
      hasil: `Rangkuman berbasis sumber tentang ${requestedTopic}`
    },
    topic: requestedTopic,
    hook: String(first?.title || requestedTopic).trim(),
    body: String(informative?.body || informative?.points?.join(' ') || '').trim(),
    caption: String(informative?.body || informative?.points?.join(' ') || '').replace(/\s+/g, ' ').trim(),
    hashtags: Array.isArray(raw?.hashtags) ? raw.hashtags.map(String).filter(Boolean).slice(0, 6) : [],
    cta: String(last?.title || requestedTopic).trim(),
    trendKeywordsUsed: [],
    content_angle: String(raw?.content_angle || requestedTopic).trim(),
    primary_tool: String(raw?.primary_tool || 'tanpa tool').trim(),
    hook_pattern: String(raw?.hook_pattern || 'source-backed').trim(),
    verificationStatus: 'source_based',
    unsupportedClaims: [],
    slides
  };
}

function claimErrors(content, sources, format, bank) {
  const errors = [];
  const sourceMap = new Map(sources.map((source, index) => [`source-${index + 1}`, normalize(source?.text || '')]));
  const bankKeys = new Set(bank.map(fact => canonicalEvidenceKey(fact.sourceId, fact.evidence)));
  const claims = new Map();
  for (const slide of content?.slides || []) {
    for (const claim of slide?.claims || []) {
      if (!claim.field || !claim.text || !claim.sourceId || !claim.evidence) {
        errors.push('claim tidak lengkap.');
        continue;
      }
      if (claims.has(claim.field)) errors.push(`${claim.field}: claim ganda.`);
      claims.set(claim.field, claim);
      const sourceText = sourceMap.get(claim.sourceId);
      if (!sourceText) errors.push(`${claim.field}: sourceId tidak tersedia.`);
      if (!sourceText?.includes(normalize(claim.evidence))) errors.push(`${claim.field}: evidence tidak ditemukan di sumber utama.`);
      if (!bankKeys.has(canonicalEvidenceKey(claim.sourceId, claim.evidence))) errors.push(`${claim.field}: evidence bukan bagian FACT_BANK bersih.`);
    }
  }

  for (const record of fieldRecords(content)) {
    const claim = claims.get(record.key);
    const requireTitle = normalizedFormat(format) === 'listicle' || /\d|%/.test(record.value);
    const required = record.kind !== 'title' || requireTitle;
    if (!required) continue;
    if (!claim) {
      errors.push(`${record.key}: field substantif wajib punya claim/evidence.`);
      continue;
    }
    if (normalize(claim.text) !== normalize(record.value)) errors.push(`${record.key}: claim.text tidak sama dengan copy field.`);
  }
  return [...new Set(errors)];
}

function densityErrors(content, bank) {
  const errors = [];
  const slides = content?.slides || [];
  const rich = bank.length >= Math.max(8, slides.length * 2 - 1);
  slides.forEach((slide, index) => {
    const total = words(slide?.body).length + (slide?.points || []).reduce((sum, point) => sum + words(point).length, 0);
    const minimum = rich ? 20 : 14;
    if (total < minimum) errors.push(`slide:${index}:density: hanya ${total} kata substantif; minimal ${minimum} kata berdasarkan fakta sumber.`);
    if (words(slide?.body).length > 24) errors.push(`slide:${index}:body: maksimal 24 kata.`);
    if ((slide?.points || []).length > 3) errors.push(`slide:${index}:points: maksimal 3 item.`);
    (slide?.points || []).forEach((point, pointIndex) => {
      const count = words(point).length;
      if (count < 3 || count > 7) errors.push(`slide:${index}:point:${pointIndex}: harus 3–7 kata.`);
    });
    if (GENERIC_COPY.test(String(slide?.title || '').trim()) && total < minimum + 4) errors.push(`slide:${index}:title: terlalu generik untuk sumber yang masih memiliki fakta.`);
  });
  return errors;
}

function listicleErrors(content, expectedCount) {
  const slides = content?.slides || [];
  const errors = [];
  if (slides.length !== expectedCount) errors.push(`listicle: harus tepat ${expectedCount} slide untuk sumber ini.`);
  slides.forEach((slide, index) => {
    if (String(slide?.section || '').trim() !== `ITEM ${index + 1}`) errors.push(`slide:${index}:section: Listicle harus memakai ITEM ${index + 1}.`);
  });
  return errors;
}

function coverageErrors(content, bank) {
  const used = new Set();
  for (const slide of content?.slides || []) {
    for (const claim of slide?.claims || []) {
      const key = canonicalEvidenceKey(claim?.sourceId, claim?.evidence);
      if (key) used.add(key);
    }
  }
  const slides = content?.slides?.length || 0;
  const rich = bank.length >= Math.max(8, slides * 2 - 1);
  const required = rich ? Math.min(bank.length, slides + Math.floor(slides / 2)) : Math.min(bank.length, slides);
  return used.size < required ? [`coverage: hanya ${used.size} fakta canonical dipakai; minimal ${required} fakta berbeda harus digunakan.`] : [];
}

async function coherenceErrors(openai, content, bank, requestedTopic, format) {
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [
      { role: 'system', content: 'Anda auditor final carousel berbasis sumber. Audit secara ketat dan jangan memperbaiki.' },
      { role: 'user', content: `TOPIK: ${requestedTopic}\nFORMAT: ${format}\nFACT_BANK: ${JSON.stringify(bank)}\nSLIDES: ${JSON.stringify(content.slides)}\nPeriksa: (1) setiap slide langsung relevan dengan topik; (2) title-body-points dalam satu slide membahas satu item/ide yang sama; (3) tidak ada fakta artikel lain/side-note; (4) Listicle memakai satu item berbeda per slide, bukan intro/penutup generik; (5) tidak ada klaim yang lebih kuat dari evidence; (6) tidak ada dua slide yang membahas item/fakta sama. Kembalikan HANYA JSON {"invalid":[{"field":"slide:1:body","reason":"..."}]}. Field invalid wajib array.` }
    ],
    response_format: { type: 'json_object' }
  });
  const parsed = JSON.parse(response?.choices?.[0]?.message?.content || '{}');
  if (!Array.isArray(parsed?.invalid)) throw new Error('Audit final tidak memiliki invalid array.');
  return parsed.invalid.map(item => `${String(item?.field || 'carousel')}: ${String(item?.reason || 'tidak sesuai sumber/topik')}`);
}

async function validateCandidate({ contentService, candidate, sources, bank, requestedTopic, effectiveFormat, expectedSlides, openai }) {
  let errors = [];
  if (!candidate || !Array.isArray(candidate.slides)) return { content: candidate, errors: ['response tidak memiliki slides.'] };
  if (candidate.slides.length !== expectedSlides) errors.push(`carousel: jumlah slide ${candidate.slides.length}; harus ${expectedSlides}.`);
  errors.push(...claimErrors(candidate, sources, effectiveFormat, bank));
  errors.push(...densityErrors(candidate, bank));
  errors.push(...coverageErrors(candidate, bank));
  errors.push(...manualSourceDedupe.manualCrossSlideDuplicateErrors(candidate));
  if (normalizedFormat(effectiveFormat) === 'listicle') errors.push(...listicleErrors(candidate, expectedSlides));
  if (typeof contentService?.validateContent === 'function') {
    errors.push(...contentService.validateContent(candidate, { format: effectiveFormat, manualTopic: requestedTopic, validateCopy: true }));
  }
  if (errors.length) return { content: candidate, errors: [...new Set(errors)] };

  const base = { ...candidate, slides: candidate.slides.map(slide => ({ ...slide, points: [...slide.points], claims: slide.claims.map(claim => ({ ...claim })) })) };
  const checked = sourceFilter.validateVerifiedContent(base, { slides: base.slides }, {
    contentService,
    format: effectiveFormat,
    manualTopic: requestedTopic,
    sources,
    autoSourceTopic: false
  });
  if (checked.errors.length) return { content: checked.content || candidate, errors: checked.errors };

  const semanticErrors = await sourceFilter.auditClaimSemantics(openai, checked.content, requestedTopic, effectiveFormat);
  if (semanticErrors.length) return { content: checked.content, errors: semanticErrors };
  try {
    const coherence = await coherenceErrors(openai, checked.content, bank, requestedTopic, effectiveFormat);
    if (coherence.length) return { content: checked.content, errors: coherence };
  } catch (error) {
    return { content: checked.content, errors: [`audit final gagal: ${error.message}`] };
  }
  return { content: checked.content, errors: [] };
}

async function composeManualSourceContent({ contentService, previousTopics = [], options = {}, sources = [], client }) {
  const requestedTopic = String(options.requestedTopic || '').trim();
  if (!requestedTopic) throw Object.assign(new Error('Topik manual wajib diisi'), { status: 400 });
  const bank = extractManualFactBank(sources, requestedTopic);
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const requestedFormat = options.contentFormat || 'Fakta singkat';
  const effectiveFormat = await resolveEffectiveFormat(openai, requestedFormat, bank);
  const slideCount = desiredSlideCount(effectiveFormat, sources, bank);
  let current = null;
  let errors = [];

  for (let attempt = 1; attempt <= MAX_COMPOSE_ATTEMPTS; attempt += 1) {
    const response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        { role: 'system', content: 'Anda editor final carousel Indonesia yang hanya boleh memakai FACT_BANK bersih dari artikel utama.' },
        { role: 'user', content: promptForComposition({ requestedTopic, requestedFormat, effectiveFormat, slideCount, bank, errors, current }) }
      ],
      response_format: { type: 'json_object' }
    });
    let parsed;
    try { parsed = JSON.parse(response?.choices?.[0]?.message?.content || ''); }
    catch (error) { errors = [`JSON composer tidak valid: ${error.message}`]; continue; }
    const candidate = normalizeCandidate(parsed, requestedTopic, effectiveFormat, slideCount);
    if (!candidate) { errors = ['Composer tidak mengembalikan slides.']; continue; }
    const validated = await validateCandidate({
      contentService, candidate, sources, bank, requestedTopic, effectiveFormat,
      expectedSlides: slideCount, openai
    });
    current = validated.content || candidate;
    errors = validated.errors;
    if (!errors.length) {
      const result = { ...current };
      delete result.effectiveContentFormat;
      if (normalizedFormat(effectiveFormat) !== normalizedFormat(requestedFormat)) result.effectiveContentFormat = effectiveFormat;
      result.topic = requestedTopic;
      result.verificationStatus = 'source_based';
      result.unsupportedClaims = [];
      return result;
    }
  }

  throw Object.assign(new Error(`Topik manual + URL tidak lolos final source composer: ${errors[0] || 'hasil belum akurat'}`), {
    status: 422,
    validationErrors: errors
  });
}

module.exports = {
  composeManualSourceContent,
  extractManualFactBank,
  evidenceCandidates,
  sourceMatchesTopic,
  desiredSlideCount,
  normalizeCandidate,
  claimErrors,
  densityErrors,
  coverageErrors,
  MAX_COMPOSE_ATTEMPTS
};
