const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const sourceUrlFinalizer = require('./sourceUrlFinalizer');
const manualSourceFallback = require('./manualSourceFallback');
const qualityLayer = require('./autoSourceQualityLayer');
const resilient = require('./autoSourceResilientFinalizer');
const autoSourceValidation = require('./autoSourceValidation');

// TANPA URL / AUTO SOURCE ONLY.
// This module is loaded only after autoSourcePatch has excluded explicit Pakai URL.
const MAX_PLAN_ATTEMPTS = 2;
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '')
  .toLocaleLowerCase('id-ID')
  .replace(/[^a-z0-9%\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function syncTop(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  if (!slides.length) return content;
  const first = slides[0];
  const middle = slides.find((slide, index) => index > 0 && index < slides.length - 1 && (slide?.body || slide?.points?.length)) || first;
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

function parseJsonResponse(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) return content;
  let raw = content;
  if (Array.isArray(content)) raw = content.map(part => part?.text || '').join('');
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Provider tidak mengembalikan JSON plan-first.');
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}

function sourceIds(sources = []) {
  return sources.map((_, index) => `source-${index + 1}`);
}

function ensureEverySourceHasFacts(sources = [], topic = '') {
  const allFacts = manualSourceFallback.sourceFacts(sources);
  const ranked = sourceFilter.extractFactBank(sources, topic);
  const selected = [...ranked];
  const represented = new Set(selected.map(fact => String(fact?.sourceId || '')).filter(Boolean));

  for (const sourceId of sourceIds(sources)) {
    if (represented.has(sourceId)) continue;
    const fallback = allFacts.filter(fact => fact.sourceId === sourceId).slice(0, 4);
    selected.push(...fallback);
    if (fallback.length) represented.add(sourceId);
  }

  const seen = new Set();
  return selected.filter(fact => {
    const sourceId = String(fact?.sourceId || '').trim();
    const evidence = String(fact?.evidence || '').replace(/\s+/g, ' ').trim();
    const key = `${sourceId}::${normalize(evidence)}`;
    if (!sourceId || !evidence || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function planContext({ sources = [], facts = [], sections = [] }) {
  const profile = qualityLayer.coherentDensityProfile(facts, sections.length || 4);
  const plan = qualityLayer.buildCoherentPlan(sources, facts, sections.length || 4);
  const sourceMap = new Map(sources.map((source, index) => [`source-${index + 1}`, source]));
  return {
    profile,
    slides: plan.map((item, index) => ({
      slideIndex: index,
      section: sections[index],
      primarySourceId: item.primarySourceId,
      sourceTitle: String(sourceMap.get(item.primarySourceId)?.title || '').replace(/\s+/g, ' ').trim(),
      evidence: (item.evidence || []).map(fact => String(fact?.evidence || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    }))
  };
}

function prompt({ topic, format, context, errors = [], previousSlides = [] }) {
  return `AUTO SOURCE PLAN-FIRST FINAL — TANPA URL SAJA.\n\nTOPIK USER: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nERROR ATTEMPT SEBELUMNYA: ${JSON.stringify(errors)}\nDRAFT SEBELUMNYA: ${JSON.stringify(previousSlides)}\n\nPLAN FINAL PER SLIDE:\n${JSON.stringify(context.slides)}\n\nATURAN WAJIB — PLAN MENGALAHKAN SEMUA DRAFT LAMA:\n- Bangun ulang SEMUA slide dari PLAN FINAL PER SLIDE. Jangan mempertahankan field draft yang bertentangan dengan plan.\n- SATU SLIDE = SATU primarySourceId = SATU subtopik. Body, seluruh bullet, dan title faktual pada slide itu WAJIB memakai primarySourceId yang sama.\n- Gunakan HANYA evidence yang tercantum pada slide tersebut. Dilarang mengambil evidence dari slide/source lain dan dilarang memakai pengetahuan luar.\n- Semua primarySourceId yang muncul pada PLAN wajib benar-benar menyumbang copy visible final.\n- Judul 3-10 kata, natural, spesifik, tidak boleh hanya PEMBUKA/FAKTA UTAMA/KONTEKS/KESIMPULAN, dan tidak boleh mengulang judul slide lain.\n- Body target 12-22 kata, hard range 8-28 kata, satu kalimat utuh, faktual, natural Bahasa Indonesia, dan harus membawa informasi nyata.\n- Bullet TIDAK WAJIB berjumlah 3. Gunakan 0-3 bullet sesuai fakta tambahan yang benar-benar berbeda dan didukung evidence slide. Jangan membuat bullet hanya untuk memenuhi jumlah.\n- Jika body sudah padat dan tidak ada fakta tambahan yang unik, lebih baik tanpa bullet daripada mengulang konteks.\n- Bullet ideal 3-8 kata; boleh sampai 10 kata bila diperlukan agar makna fakta tetap utuh. Setiap bullet harus menambah informasi baru yang belum ada pada title, body, atau bullet lain.\n- Untuk body dan SETIAP bullet yang dipakai, sertakan satu claim dengan field yang tepat, sourceId = primarySourceId slide, dan evidence VERBATIM dari daftar evidence slide itu.\n- claim.text harus SAMA PERSIS dengan copy visible final.\n- Jika title menyatakan fakta substantif, sertakan claim title dengan sourceId yang sama dan evidence yang benar-benar mendukung title. Jika title hanya heading editorial netral, claim title boleh tidak ada.\n- Jangan membuat body berupa pertanyaan pada format Fakta singkat. Slide tengah wajib membawa fakta terverifikasi, bukan pengantar/pendapat/filler.\n- Jangan menggabungkan dua evidence menjadi klaim baru yang tidak dinyatakan salah satunya.\n- Jangan menambah sebab-akibat, manfaat, tujuan, strategi, implikasi, rekomendasi, kepastian, angka, persentase, ordinal, lokasi, versi, tanggal, atau outcome yang tidak dinyatakan evidence pilihan.\n- Pertahankan angka/persentase/versi/waktu persis secara makna. 5,89 persen boleh diparafrasekan sebagai 5,89%, tetapi jangan mengubah nilainya.\n- Satu evidence BOLEH mendukung body dan bullet berbeda jika kalimat sumber memang membuktikan keduanya. Yang dilarang adalah copy/fakta visible yang mengulang makna yang sama.\n- Jangan memakai related article, metadata, byline, tanggal publikasi, cookie/privacy, atau headline lain.\n- Hasil harus padat seperti pola editorial: judul -> body fakta inti -> bullet hanya untuk detail tambahan yang benar-benar berguna.\n- Contoh Muse Code adalah contoh KEPADATAN INFORMASI, bukan kewajiban jumlah bullet.\n\nKembalikan HANYA JSON:\n{"slides":[{"section":"...","title":"...","body":"...","points":["..."],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:point:0","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
}

function normalizeSections(slides = [], sections = []) {
  return slides.map((slide, index) => ({
    ...slide,
    section: sections[index] || slide?.section || '',
    points: Array.isArray(slide?.points) ? slide.points : [],
    claims: Array.isArray(slide?.claims) ? slide.claims : []
  }));
}

function copyForField(slide, field) {
  const match = String(field || '').match(/^slide:\d+:(title|body|point:(\d+))$/);
  if (!match) return '';
  if (match[1] === 'title') return String(slide?.title || '').replace(/\s+/g, ' ').trim();
  if (match[1] === 'body') return String(slide?.body || '').replace(/\s+/g, ' ').trim();
  return String(slide?.points?.[Number(match[2])] || '').replace(/\s+/g, ' ').trim();
}

function synchronizeClaims(content = {}) {
  const slides = (content?.slides || []).map((slide, slideIndex) => {
    const points = Array.isArray(slide?.points) ? slide.points.map(value => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
    const claims = [];
    const seen = new Set();
    for (const original of Array.isArray(slide?.claims) ? slide.claims : []) {
      const field = String(original?.field || '').trim();
      if (!new RegExp(`^slide:${slideIndex}:(?:title|body|point:\\d+)$`).test(field) || seen.has(field)) continue;
      const pointMatch = field.match(/:point:(\d+)$/);
      if (pointMatch && Number(pointMatch[1]) >= points.length) continue;
      const copy = copyForField({ ...slide, points }, field);
      if (!copy) continue;
      claims.push({ ...original, field, text: copy });
      seen.add(field);
    }
    return { ...slide, points, claims };
  });
  return syncTop({ ...content, slides });
}

function removeRedundantPoints(content = {}) {
  const slides = (content?.slides || []).map((slide, slideIndex) => {
    const originalPoints = Array.isArray(slide?.points) ? slide.points : [];
    const kept = [];
    const indexMap = new Map();

    originalPoints.forEach((rawPoint, oldIndex) => {
      const point = String(rawPoint || '').replace(/\s+/g, ' ').trim();
      if (!point || kept.length >= 3) return;
      const repeatsTitle = slide?.title
        && autoSourceValidation.nearDuplicateClaimMeaning(slide.title, point, { minShared: 2, ratio: 0.9 })
        && !autoSourceValidation.substantiveExpansion(slide.title, point, 2);
      const repeatsBody = slide?.body
        && autoSourceValidation.nearDuplicateClaimMeaning(slide.body, point, { minShared: 2, ratio: 0.9 })
        && !autoSourceValidation.substantiveExpansion(slide.body, point, 2);
      const repeatsPoint = kept.some(existing => autoSourceValidation.nearDuplicateClaimMeaning(existing, point, { minShared: 2, ratio: 0.88 }));
      if (repeatsTitle || repeatsBody || repeatsPoint) return;
      indexMap.set(oldIndex, kept.length);
      kept.push(point);
    });

    const claims = [];
    for (const claim of Array.isArray(slide?.claims) ? slide.claims : []) {
      const field = String(claim?.field || '').trim();
      const pointMatch = field.match(new RegExp(`^slide:${slideIndex}:point:(\\d+)$`));
      if (!pointMatch) {
        claims.push({ ...claim });
        continue;
      }
      const newIndex = indexMap.get(Number(pointMatch[1]));
      if (newIndex === undefined) continue;
      claims.push({ ...claim, field: `slide:${slideIndex}:point:${newIndex}` });
    }
    return { ...slide, points: kept, claims };
  });
  return synchronizeClaims({ ...content, slides });
}

function informationDensityErrors(content = {}) {
  const errors = [];
  for (const [slideIndex, slide] of (content?.slides || []).entries()) {
    const titleCount = words(slide?.title).length;
    const bodyCount = words(slide?.body).length;
    const points = Array.isArray(slide?.points) ? slide.points : [];
    const totalWords = bodyCount + points.reduce((sum, point) => sum + words(point).length, 0);

    if (!titleCount || titleCount > 12) errors.push(`AUTO_SOURCE_INFO_DENSITY: slide:${slideIndex}: title harus 1-12 kata.`);
    if (bodyCount < 8 || bodyCount > 28) errors.push(`AUTO_SOURCE_INFO_DENSITY: slide:${slideIndex}: body harus 8-28 kata dan tetap berisi.`);
    if (points.length > 3) errors.push(`AUTO_SOURCE_INFO_DENSITY: slide:${slideIndex}: maksimal 3 bullet.`);
    points.forEach((point, pointIndex) => {
      const count = words(point).length;
      if (count < 2 || count > 10) errors.push(`AUTO_SOURCE_INFO_DENSITY: slide:${slideIndex}:point:${pointIndex}: bullet harus 2-10 kata agar natural.`);
    });
    if (bodyCount < 10 && totalWords < 12) errors.push(`AUTO_SOURCE_INFO_DENSITY: slide:${slideIndex}: isi terlalu tipis; perkaya body atau tambahkan fakta unik.`);
  }
  return [...new Set(errors)];
}

function filterLegacyPlanErrors(errors = []) {
  return errors.filter(error => {
    const text = String(error || '');
    if (/^AUTO_SOURCE_DENSITY:/i.test(text)) return false;
    if (/^AUTO_SOURCE_LAYOUT:.*point harus 3[–-]7 kata/i.test(text)) return false;
    if (/\bpoint \d+ maksimal 7 kata\b/i.test(text)) return false;
    return true;
  });
}

function planOwnershipErrors(content = {}, context = {}) {
  const errors = [];
  for (const planSlide of context?.slides || []) {
    const slide = content?.slides?.[planSlide.slideIndex];
    if (!slide) {
      errors.push(`AUTO_SOURCE_PLAN: slide:${planSlide.slideIndex}: slide tidak ada.`);
      continue;
    }
    const expected = planSlide.primarySourceId;
    const allowedEvidence = new Set((planSlide.evidence || []).map(normalize).filter(Boolean));
    const claims = (slide.claims || []).filter(claim => /^slide:\d+:(?:title|body|point:\d+)$/.test(String(claim?.field || '')));
    const substantive = claims.filter(claim => !String(claim?.field || '').endsWith(':title'));
    if (!substantive.length) errors.push(`AUTO_SOURCE_PLAN: slide:${planSlide.slideIndex}: belum memiliki claim substantif.`);

    for (const claim of claims) {
      const field = String(claim?.field || '');
      if (String(claim?.sourceId || '') !== expected) {
        errors.push(`AUTO_SOURCE_PLAN: ${field}: wajib ${expected}, bukan ${claim?.sourceId || 'tanpa sourceId'}.`);
      }
      const evidenceKey = normalize(claim?.evidence);
      if (evidenceKey && !allowedEvidence.has(evidenceKey)) {
        errors.push(`AUTO_SOURCE_PLAN: ${field}: evidence harus berasal dari paket evidence slide ${planSlide.slideIndex + 1}.`);
      }
    }
  }
  return errors;
}

function validatePlanCandidate({ draft, sources, topic, format, contentService, facts, context }) {
  let candidate = removeRedundantPoints(synchronizeClaims(draft));
  const validation = resilient.validateCandidate({
    draft: candidate,
    sources,
    topic,
    format,
    contentService,
    facts
  });
  candidate = removeRedundantPoints(synchronizeClaims(validation.candidate));
  const errors = [
    ...filterLegacyPlanErrors(validation.errors),
    ...informationDensityErrors(candidate),
    ...autoSourceValidation.autoSourceDuplicateErrors(candidate),
    ...planOwnershipErrors(candidate, context)
  ];
  return { candidate, errors: [...new Set(errors)] };
}

// Information density is validated inside plan-first using visible factual copy.
// Do not let autoSourceComposer re-derive a bullet-count target after finalizer passes.
function postHandoffRichnessErrors() {
  return [];
}

async function rewriteAllSourcesWithAi({ generated, sources = [], topic = '', format = 'Fakta singkat', contentService, client } = {}) {
  if (!sources.length) throw Object.assign(new Error('Auto Source tidak memiliki sumber yang dapat dipakai.'), { status: 422 });
  const resolvedTopic = String(topic || generated?.topic || sources?.[0]?.title || 'Topik sumber').trim();
  const effectiveFormat = generated?.effectiveContentFormat || format || 'Fakta singkat';
  const facts = ensureEverySourceHasFacts(sources, resolvedTopic);
  if (!facts.length) throw Object.assign(new Error('Auto Source tidak menemukan fact bank yang dapat dipakai.'), { status: 422 });

  const sections = sourceUrlFinalizer.targetSections(generated, effectiveFormat, facts, sources, resolvedTopic);
  const context = planContext({ sources, facts, sections });
  if (context.slides.length !== sections.length || context.slides.some(slide => !slide.primarySourceId || !slide.evidence.length)) {
    throw Object.assign(new Error('Auto Source belum memiliki evidence per-source yang cukup untuk membentuk semua slide.'), { status: 422 });
  }

  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let errors = [];
  let previousSlides = generated?.slides || [];

  for (let attempt = 0; attempt < MAX_PLAN_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          {
            role: 'system',
            content: 'Anda editor final Auto Source AI Ads Lab. Ikuti source plan per slide secara literal. Tulis carousel Indonesia yang faktual, padat informasi, natural, dan jangan pernah mencampur sumber atau mengulang konteks dalam satu slide.'
          },
          { role: 'user', content: prompt({ topic: resolvedTopic, format: effectiveFormat, context, errors, previousSlides }) }
        ],
        response_format: { type: 'json_object' }
      });
    } catch (error) {
      errors = [`AUTO_SOURCE_PROVIDER_OUTPUT: ${error.message}`];
      continue;
    }

    let parsed;
    try { parsed = parseJsonResponse(response); }
    catch (error) {
      errors = [`AUTO_SOURCE_PROVIDER_OUTPUT: ${error.message}`];
      continue;
    }

    const rawSlides = Array.isArray(parsed?.slides) ? parsed.slides : [];
    let candidate = syncTop({
      ...generated,
      topic: resolvedTopic,
      slides: normalizeSections(rawSlides, sections),
      verificationStatus: 'source_based'
    });

    const validation = validatePlanCandidate({
      draft: candidate,
      sources,
      topic: resolvedTopic,
      format: effectiveFormat,
      contentService,
      facts,
      context
    });
    candidate = validation.candidate;
    errors = validation.errors;

    if (!errors.length) {
      const semanticErrors = await sourceFilter.auditClaimSemantics(openai, candidate, resolvedTopic, effectiveFormat);
      errors = semanticErrors;
    }

    if (!errors.length) return syncTop(candidate);
    previousSlides = candidate?.slides || rawSlides;
  }

  throw Object.assign(new Error(`Auto Source plan-first belum lolos: ${errors[0] || 'validasi gagal'}`), {
    status: 422,
    validationErrors: errors
  });
}

module.exports = {
  rewriteAllSourcesWithAi,
  ensureEverySourceHasFacts,
  planContext,
  planOwnershipErrors,
  prompt,
  synchronizeClaims,
  removeRedundantPoints,
  informationDensityErrors,
  filterLegacyPlanErrors,
  validatePlanCandidate,
  richnessErrors: postHandoffRichnessErrors,
  filterFalsePositiveMetadataErrors: resilient.filterFalsePositiveMetadataErrors,
  MAX_PLAN_ATTEMPTS
};
