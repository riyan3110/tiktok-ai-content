const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const sourceUrlFinalizer = require('./sourceUrlFinalizer');
const autoSourceValidation = require('./autoSourceValidation');
const baseAutoSourceFinalizer = require('./autoSourceFinalizer');
const manualSourceFallback = require('./manualSourceFallback');

const {
  sourceFacts,
  sourceRichness,
  sourceCoverageErrors,
  naturalCopyErrors,
  duplicateErrors
} = manualSourceFallback;

// TANPA URL / AUTO SOURCE ONLY.
// Pakai URL is intentionally not routed through this module.
const MAX_STRICT_COMPOSE_ATTEMPTS = 2;
const MAX_TARGETED_REPAIR_ATTEMPTS = 1;
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');

function syncTop(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  if (!slides.length) return content;
  const first = slides[0];
  const middle = slides.find((slide, index) => index > 0 && index < slides.length - 1 && (slide.body || slide.points?.length)) || first;
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

function strictDensityProfile(facts = [], slideCount = 4) {
  const base = sourceRichness(facts, slideCount);
  return {
    bodyMin: Math.max(10, base.bodyMin || 10),
    bodyMax: 20,
    targetPoints: Math.min(3, Math.max(0, base.targetPoints || 0)),
    richEnoughForThree: (base.targetPoints || 0) >= 3
  };
}

function strictDensityErrors(content, facts = []) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const profile = strictDensityProfile(facts, slides.length || 4);
  const errors = [];
  slides.forEach((slide, slideIndex) => {
    const bodyCount = words(slide?.body).length;
    const points = Array.isArray(slide?.points) ? slide.points : [];
    if (bodyCount < profile.bodyMin || bodyCount > profile.bodyMax) {
      errors.push(`AUTO_SOURCE_DENSITY: slide:${slideIndex}:body harus ${profile.bodyMin}-${profile.bodyMax} kata agar padat tetapi tetap rapi.`);
    }
    if (points.length < profile.targetPoints) {
      errors.push(`AUTO_SOURCE_DENSITY: slide:${slideIndex}: membutuhkan ${profile.targetPoints} bullet fakta berbeda; baru ada ${points.length}.`);
    }
    if (profile.richEnoughForThree && points.length !== 3) {
      errors.push(`AUTO_SOURCE_DENSITY: slide:${slideIndex}: fact bank kaya; wajib tepat 3 bullet fakta berbeda.`);
    }
  });
  return [...new Set(errors)];
}

function selectedSourceIds(sources = []) {
  return sources.map((_, index) => `source-${index + 1}`);
}

function strictPrompt({ generated, sources, facts, format, topic, errors = [] }) {
  const sections = sourceUrlFinalizer.targetSections(generated, format, facts, sources, topic);
  const groups = sourceUrlFinalizer.groupedFacts(sources, facts);
  const plan = sourceUrlFinalizer.buildFactPlan(sources, facts, sections.length);
  const profile = strictDensityProfile(facts, sections.length);
  const sourceIds = selectedSourceIds(sources);
  const bulletRule = profile.richEnoughForThree
    ? 'SETIAP slide WAJIB memiliki tepat 3 bullet fakta berbeda.'
    : `SETIAP slide WAJIB memakai minimal ${profile.targetPoints} bullet fakta berbeda yang benar-benar tersedia; jangan mengarang jika fact bank memang lebih tipis.`;

  return `AUTO SOURCE STRICT FINAL — TANPA URL SAJA.\n\nTOPIK USER: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nSECTION WAJIB: ${JSON.stringify(sections)}\nSOURCE ID WAJIB TERPAKAI: ${JSON.stringify(sourceIds)}\nERROR SEBELUMNYA: ${JSON.stringify(errors)}\n\nSUMBER TERPILIH + FACT BANK:\n${JSON.stringify(groups)}\n\nFACT PLAN PER SLIDE:\n${JSON.stringify(plan)}\n\nATURAN KERAS:\n- Buat konten hanya dari sumber terpilih di atas. Tidak boleh memakai pengetahuan luar.\n- SEMUA sourceId pada SOURCE ID WAJIB TERPAKAI harus menyumbang minimal satu fakta visible pada body atau bullet final. Tidak boleh diam-diam membuang sumber terpilih.\n- Gunakan FACT PLAN sebagai prioritas pembagian fakta agar sumber dan fakta tersebar rapi; boleh memilih fakta lain dari FACT BANK hanya jika lebih cocok dan belum dipakai.\n- Setiap slide harus menjelaskan satu ide yang jelas dengan pola: judul natural + body faktual + bullet fakta berbeda.\n- Judul 3-10 kata, natural dan spesifik. Boleh berupa pertanyaan natural bila cocok, tetapi jangan membuat semua slide menjadi pertanyaan dan jangan memakai judul template seperti Fakta Utama/Konteks/Kesimpulan sebagai judul visible.\n- Body WAJIB ${profile.bodyMin}-${profile.bodyMax} kata, satu kalimat utuh, natural, tidak berupa potongan kutipan atau metadata.\n- ${bulletRule}\n- Bullet 3-7 kata, maksimal 3, utuh, natural, dan menambah informasi baru.\n- Body dan setiap bullet WAJIB mempunyai claim field/text yang sama persis, sourceId yang benar, dan evidence dari sourceId yang sama.\n- Satu field hanya boleh menyatakan makna yang benar-benar dibuktikan satu evidence. Jangan menggabungkan dua evidence menjadi kesimpulan baru.\n- Jangan mengulang evidence canonical atau fakta yang sama pada body/bullet lain, baik dalam satu slide maupun antar-slide.\n- Copy visible wajib Bahasa Indonesia natural. Evidence Inggris boleh diparafrasekan secara konservatif tanpa mengubah makna.\n- Dilarang menambahkan tujuan, sebab-akibat, manfaat, strategi, implikasi, risiko, aplikasi, outcome, kepastian, atau rekomendasi yang tidak dinyatakan sumber.\n- Pertahankan entity type, scope, daftar, modalitas, negasi, uncertainty, kondisi, waktu, tanggal, dan urutan rollout sesuai evidence.\n- Angka, persentase, ordinal, tanggal, model, atau versi hanya boleh tampil jika benar-benar didukung evidence/konteks sumber yang sama. Jangan membuat shorthand baru seperti 24/7 dari everyday.\n- Jangan masukkan byline, dateline, tanggal publikasi sebagai filler, Baca Juga, related article, headline lain, cookie/privacy policy, newsletter, URL, atau metadata situs.\n- Jangan memakai placeholder seperti Fakta utama tentang..., Fakta berikutnya..., Sumber membahas..., Lanjut baca..., atau kalimat generik yang tidak membawa fakta.\n- Jika format pilihan user tidak benar-benar didukung sebagai tutorial/tips/masalah-solusi, tetap prioritaskan fakta sumber dan jangan mengarang instruksi.\n\nKembalikan HANYA JSON:\n{"slides":[{"section":"...","title":"...","body":"...","points":["...","...","..."],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:point:0","text":"...","sourceId":"source-2","evidence":"..."}]}]}`;
}

function validateStrictCandidate({ draft, sources, topic, format, contentService, facts }) {
  const checked = sourceFilter.validateVerifiedContent(draft, { slides: draft.slides }, {
    contentService,
    format,
    manualTopic: topic,
    sources,
    autoSourceTopic: false
  });
  const candidate = baseAutoSourceFinalizer.repairKnownNumericShorthand(
    baseAutoSourceFinalizer.compactOverlongPoints(checked.content || draft),
    sources
  );
  let checkedErrors = baseAutoSourceFinalizer.filterFalsePositiveMetadataErrors(checked.errors, candidate);
  checkedErrors = autoSourceValidation.filterFalsePositives(checkedErrors, candidate);
  const errors = [
    ...autoSourceValidation.numericGroundingErrors(candidate, sources),
    ...checkedErrors,
    ...sourceCoverageErrors(candidate, sources),
    ...naturalCopyErrors(candidate),
    ...duplicateErrors(candidate),
    ...autoSourceValidation.autoSourceStructureErrors(candidate),
    ...strictDensityErrors(candidate, facts)
  ];
  return { candidate, errors: [...new Set(errors)] };
}

function recoveryFields(errors = [], content = {}) {
  const fields = sourceFilter.recoveryFieldKeys(errors);
  for (const error of errors) {
    const numeric = String(error || '').match(/^AUTO_SOURCE_NUMERIC:\s+slide:(\d+):claim:(\d+)\b/i);
    if (numeric) {
      const claim = content?.slides?.[Number(numeric[1])]?.claims?.[Number(numeric[2])];
      const field = String(claim?.field || '').trim();
      if (/^slide:\d+:(?:title|body|point:\d+)$/.test(field)) fields.add(field);
    }
  }
  return fields;
}

function repairPrompt({ content, fields, bank, topic, format, errors }) {
  return `AUTO SOURCE STRICT TARGETED REPAIR.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nTARGET FIELD: ${JSON.stringify([...fields])}\nERROR: ${JSON.stringify(errors)}\nFACT BANK: ${JSON.stringify(bank)}\nCURRENT SLIDES: ${JSON.stringify(content?.slides || [])}\n\nATURAN:\n- Perbaiki HANYA target field. Field lain harus tetap.\n- Jangan menghapus bullet target. Ganti dengan fakta lain dari fact bank bila copy lama tidak bisa diselamatkan.\n- Gunakan satu evidence yang benar-benar mendukung seluruh makna field.\n- Jangan menambah tujuan, manfaat, strategi, sebab-akibat, aplikasi, implikasi, outcome, angka, atau kepastian yang tidak ada di evidence.\n- Body hasil 10-20 kata. Bullet hasil 3-7 kata.\n- Copy wajib Bahasa Indonesia natural dan claim.text harus sama persis dengan copy.\n- sourceId/evidence boleh diganti hanya ke pasangan dari FACT BANK yang memang relevan dan belum dipakai field lain.\n- Jangan mengubah jumlah slide, section, atau metadata di luar target.\n\nKembalikan HANYA JSON: {"repairs":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}`;
}

function parseJsonResponse(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) return content;
  let raw = content;
  if (Array.isArray(content)) raw = content.map(part => part?.text || '').join('');
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Provider tidak mengembalikan JSON.');
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}

function applyRepairs(content, repairs = [], allowedFields = new Set()) {
  if (!content?.slides || !Array.isArray(repairs)) return content;
  const slides = content.slides.map(slide => ({
    ...slide,
    points: Array.isArray(slide?.points) ? [...slide.points] : [],
    claims: Array.isArray(slide?.claims) ? slide.claims.map(claim => ({ ...claim })) : []
  }));

  for (const item of repairs) {
    const field = String(item?.field || '').trim();
    if (!allowedFields.has(field)) continue;
    const match = field.match(/^slide:(\d+):(title|body|point:(\d+))$/);
    if (!match) continue;
    const slide = slides[Number(match[1])];
    if (!slide) continue;
    const text = String(item?.text || '').replace(/\s+/g, ' ').trim();
    const sourceId = String(item?.sourceId || '').trim();
    const evidence = String(item?.evidence || '').replace(/\s+/g, ' ').trim();
    if (!text || !sourceId || !evidence) continue;
    if (match[2] === 'title') slide.title = text;
    else if (match[2] === 'body') slide.body = text;
    else {
      const pointIndex = Number(match[3]);
      if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= slide.points.length) continue;
      slide.points[pointIndex] = text;
    }
    slide.claims = slide.claims.filter(claim => String(claim?.field || '') !== field);
    slide.claims.push({ field, text, sourceId, evidence });
  }
  return syncTop({ ...content, slides });
}

async function targetedRepair({ openai, content, errors, sources, facts, topic, format, contentService }) {
  const fields = recoveryFields(errors, content);
  if (!fields.size) return { candidate: content, errors, changed: false };
  const bank = sourceFilter.extractFactBank(sources, topic);
  if (!bank.length) return { candidate: content, errors, changed: false };

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        { role: 'system', content: 'Anda editor koreksi Auto Source. Ubah hanya field yang gagal dan pertahankan grounding sumber secara ketat.' },
        { role: 'user', content: repairPrompt({ content, fields, bank, topic, format, errors }) }
      ],
      response_format: { type: 'json_object' }
    });
  } catch {
    return { candidate: content, errors, changed: false };
  }

  let parsed;
  try { parsed = parseJsonResponse(response); }
  catch { return { candidate: content, errors, changed: false }; }
  const repaired = applyRepairs(content, Array.isArray(parsed?.repairs) ? parsed.repairs : [], fields);
  const changed = normalize(JSON.stringify(repaired?.slides || [])) !== normalize(JSON.stringify(content?.slides || []));
  if (!changed) return { candidate: content, errors, changed: false };

  const validation = validateStrictCandidate({ draft: repaired, sources, topic, format, contentService, facts });
  if (validation.errors.length) return { candidate: validation.candidate, errors: validation.errors, changed: true };
  const semantic = await sourceFilter.auditClaimSemantics(openai, validation.candidate, topic, format);
  return { candidate: validation.candidate, errors: semantic, changed: true };
}

async function rewriteAllSourcesWithAi({ generated, sources = [], topic = '', format = 'Fakta singkat', contentService, client } = {}) {
  const facts = sourceFacts(sources);
  if (!sources.length || !facts.length) {
    throw Object.assign(new Error('Auto Source tidak memiliki sumber/fakta yang dapat dipakai.'), { status: 422 });
  }
  const resolvedTopic = String(topic || generated?.topic || sources?.[0]?.title || 'Topik sumber').trim();
  const effectiveFormat = generated?.effectiveContentFormat || format || 'Fakta singkat';
  const sections = sourceUrlFinalizer.targetSections(generated, effectiveFormat, facts, sources, resolvedTopic);
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let draft = { ...generated, topic: resolvedTopic };
  let lastErrors = [];
  let repairAttempts = 0;

  for (let attempt = 0; attempt < MAX_STRICT_COMPOSE_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          { role: 'system', content: 'Anda editor final Tanpa URL/Auto Source AI Ads Lab. Hasil wajib faktual, padat, natural, memakai semua sumber terpilih, dan tidak boleh mengarang.' },
          { role: 'user', content: strictPrompt({ generated: draft, sources, facts, format: effectiveFormat, topic: resolvedTopic, errors: lastErrors }) }
        ],
        response_format: { type: 'json_object' }
      });
      draft = syncTop({
        ...draft,
        slides: sourceUrlFinalizer.parseSlides(response, sections),
        verificationStatus: 'source_based'
      });
    } catch (error) {
      lastErrors = [`AUTO_SOURCE_PROVIDER_OUTPUT: ${error.message}`];
      continue;
    }

    const validation = validateStrictCandidate({
      draft,
      sources,
      topic: resolvedTopic,
      format: effectiveFormat,
      contentService,
      facts
    });
    if (validation.errors.length) {
      lastErrors = validation.errors;
      draft = validation.candidate;
      continue;
    }

    const semanticErrors = await sourceFilter.auditClaimSemantics(openai, validation.candidate, resolvedTopic, effectiveFormat);
    if (!semanticErrors.length) return syncTop(validation.candidate);

    lastErrors = semanticErrors;
    draft = validation.candidate;
    if (repairAttempts < MAX_TARGETED_REPAIR_ATTEMPTS) {
      repairAttempts += 1;
      const repaired = await targetedRepair({
        openai,
        content: draft,
        errors: semanticErrors,
        sources,
        facts,
        topic: resolvedTopic,
        format: effectiveFormat,
        contentService
      });
      if (repaired.changed && !repaired.errors.length) return syncTop(repaired.candidate);
      if (repaired.changed) {
        draft = repaired.candidate;
        lastErrors = repaired.errors;
      }
    }
  }

  throw Object.assign(new Error(`Auto Source strict final belum lolos: ${lastErrors[0] || 'validasi gagal'}`), {
    status: 422,
    validationErrors: lastErrors
  });
}

module.exports = {
  rewriteAllSourcesWithAi,
  strictDensityProfile,
  strictDensityErrors,
  strictPrompt,
  validateStrictCandidate,
  recoveryFields,
  applyRepairs,
  targetedRepair,
  richnessErrors: strictDensityErrors,
  filterFalsePositiveMetadataErrors: baseAutoSourceFinalizer.filterFalsePositiveMetadataErrors,
  MAX_STRICT_COMPOSE_ATTEMPTS,
  MAX_TARGETED_REPAIR_ATTEMPTS
};