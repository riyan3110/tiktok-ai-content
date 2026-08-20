const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const manualSourceFallback = require('./manualSourceFallback');
const sourceUrlFinalizer = require('./sourceUrlFinalizer');
const autoSourceValidation = require('./autoSourceValidation');

const {
  sourceFacts,
  sourceRichness,
  sourceCoverageErrors,
  naturalCopyErrors,
  compactPoint
} = manualSourceFallback;
const MAX_AUTO_FINALIZE_ATTEMPTS = 2;
const MAX_AUTO_RECOVERY_ATTEMPTS = Math.min(3, sourceFilter.MAX_SAFE_RECOVERY_ATTEMPTS || 3);
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
const numberTokens = value => String(value || '').match(/\b\d+(?:[.,]\d+)?%?\b/g) || [];

const ACTUAL_BOILERPLATE = /(?:\bbaca\s+juga\b|\bread\s+also\b|\bcookie\s+(?:policy|preferences?)\b|\b(?:accept|manage)\s+cookies\b|\bprivacy\s+(?:policy|notice|statement)\b|\bkebijakan\s+privasi\b|\bterms\s+of\s+use\b|\bsyarat\s+dan\s+ketentuan\b|\bcopyright\b|\bhak\s+cipta\b|\bnewsletter\b|\bsubscribe\b|\bfollow\s+(?:me|us)\b|\bikuti\s+kami\b|\bcontact\s+us\b|\bhubungi\s+kami\b|^(?:sign\s+in|login)$|^(?:by|oleh|written by|ditulis oleh|edited by|disunting oleh)\s+[\p{L}.' -]{3,80}[.!]?$)/iu;

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

function fieldValue(content, field) {
  const match = String(field || '').match(/^slide:(\d+):(title|body|point:(\d+))$/);
  if (!match) return '';
  const slide = content?.slides?.[Number(match[1])];
  if (!slide) return '';
  if (match[2] === 'title' || match[2] === 'body') return String(slide[match[2]] || '').trim();
  return String(slide?.points?.[Number(match[3])] || '').trim();
}

function setFieldValue(content, field, value) {
  const match = String(field || '').match(/^slide:(\d+):(title|body|point:(\d+))$/);
  if (!match) return false;
  const slide = content?.slides?.[Number(match[1])];
  if (!slide) return false;
  if (match[2] === 'title' || match[2] === 'body') slide[match[2]] = value;
  else if (Array.isArray(slide.points) && Number(match[3]) < slide.points.length) slide.points[Number(match[3])] = value;
  else return false;
  return true;
}

function filterFalsePositiveMetadataErrors(errors = [], content = {}) {
  return errors.filter(error => {
    const text = String(error || '');
    if (!/metadata\/boilerplate website masuk ke konten/i.test(text)) return true;
    const match = text.match(/^(slide:\d+:(?:title|body|point:\d+)):/i);
    if (!match) return true;
    return ACTUAL_BOILERPLATE.test(fieldValue(content, match[1]));
  });
}

function repairKnownNumericShorthand(content, sources = []) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  slides.forEach(slide => {
    (Array.isArray(slide?.claims) ? slide.claims : []).forEach(claim => {
      const text = String(claim?.text || '').trim();
      const evidence = String(claim?.evidence || '').trim();
      if (!text || !evidence) return;

      const evidenceNumbers = new Set(numberTokens(evidence));
      const hasUnsupported247 = /\b24\s*\/\s*7\b/i.test(text)
        && (!evidenceNumbers.has('24') || !evidenceNumbers.has('7'));
      const evidenceMeansDaily = /\b(?:everyday|every\s+day|daily|setiap\s+hari|harian)\b/i.test(evidence);
      if (!hasUnsupported247 || !evidenceMeansDaily) return;

      const repaired = text.replace(/\b24\s*\/\s*7\b/gi, 'setiap hari').replace(/\s+/g, ' ').trim();
      if (!repaired || !setFieldValue(content, claim.field, repaired)) return;
      claim.text = repaired;
    });
  });
  return autoSourceValidation.repairNearbyNumericEvidence(content, sources);
}

function compactOverlongPoints(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  slides.forEach((slide, slideIndex) => {
    if (!Array.isArray(slide.points)) return;
    const claims = Array.isArray(slide.claims) ? slide.claims : [];
    slide.points = slide.points.map((point, pointIndex) => {
      const raw = String(point || '').trim();
      if (words(raw).length <= 7) return raw;
      const shortened = compactPoint(raw);
      if (!shortened || words(shortened).length < 3 || words(shortened).length > 7) return raw;
      const field = `slide:${slideIndex}:point:${pointIndex}`;
      const claim = claims.find(item => String(item?.field || '').trim() === field)
        || claims.find(item => normalize(item?.text) === normalize(raw));
      if (claim) {
        claim.field = field;
        claim.text = shortened;
      }
      return shortened;
    });
  });
  return content;
}

function richnessErrors(content, facts) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  slides.forEach((slide, index) => {
    const bodyCount = words(slide?.body).length;
    if (bodyCount < 8) errors.push(`AUTO_SOURCE_RICHNESS: slide ${index + 1} body terlalu tipis (${bodyCount} kata).`);
  });
  return [...new Set(errors)];
}

function autoSourceCoverageErrors(content, sources = []) {
  return sourceCoverageErrors(content, sources)
    .filter(error => !/^coverage:source:/i.test(String(error || '').trim()));
}

function autoPrompt({ generated, sources, facts, format, topic, errors }) {
  const sections = sourceUrlFinalizer.targetSections(generated, format, facts, sources, topic);
  const sourceGroups = sourceUrlFinalizer.groupedFacts(sources, facts);
  const profile = sourceRichness(facts, sections.length);
  return `AUTO SOURCE FINAL REWRITE — BUAT CAROUSEL FAKTUAL, PADAT, NATURAL.\n\nTOPIK USER: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nSECTION WAJIB: ${JSON.stringify(sections)}\nERROR SEBELUMNYA: ${JSON.stringify(errors || [])}\n\nSUMBER TERPILIH + FACT BANK:\n${JSON.stringify(sourceGroups)}\n\nDRAF SAAT INI:\n${JSON.stringify(generated?.slides || [])}\n\nATURAN WAJIB:\n- Tulis Bahasa Indonesia natural seperti editor manusia, bukan template/fallback.\n- HANYA gunakan fakta dari FACT BANK. Tidak boleh menambah pengetahuan luar, asumsi, angka, ranking, sebab-akibat, atau kepastian yang tidak ada pada evidence.\n- Setiap slide harus punya SATU ide utama yang spesifik, bukan judul generik.\n- Judul 3–10 kata, spesifik terhadap fakta slide.\n- Target body 10–20 kata; 8–24 masih boleh jika kalimat utuh dan faktual.\n- Usahakan ${profile.targetPoints} bullet fakta berbeda pada tiap slide bila evidence memang cukup. Maksimal 3 bullet. Target bullet bukan hard gate: 0–2 bullet yang benar lebih baik daripada menambah fakta yang tidak didukung.\n- Setiap bullet WAJIB 3–7 kata, utuh, faktual, dan menambah informasi baru. Jangan memotong kalimat; parafrase singkat.\n- Judul dan body BOLEH sama-sama menyebut nama produk/topik. Yang dilarang adalah mengulang kalimat/ide tanpa informasi baru. Body wajib menambah fakta atau konteks baru.\n- Jangan ulang ide body di bullet. Jangan ulang fakta antar-slide.\n- Setiap body dan bullet wajib punya claim dengan field yang tepat, sourceId, dan evidence dari sumber yang sama.\n- SATU field/claim jangan menggabungkan dua fakta yang hanya didukung evidence berbeda. Evidence claim itu sendiri harus cukup membuktikan seluruh makna field.\n- Evidence boleh Inggris, copy visible wajib Indonesia natural tanpa mengubah makna.\n- Angka visible hanya boleh dipakai bila angka yang sama tertulis di evidence claim tersebut ATAU merupakan bagian nama/model/version yang benar-benar tertulis di konteks sumber yang sama. Jangan menciptakan angka baru dari makna implisit.\n- Jangan mengubah kata seperti everyday/daily menjadi angka. Khusus everyday/daily harus ditulis sebagai setiap hari, BUKAN 24/7.\n- Topik apa pun harus dinilai dengan aturan grounding, keunikan fakta, kelengkapan konteks, dan keterbacaan yang sama; jangan membuat aturan berdasarkan nama brand, produk, perusahaan, atau jenis topik tertentu.\n- Jika topik luas, pilih fakta paling informatif: definisi/konteks, kemampuan/fitur, penggunaan/dampak, lalu perkembangan/implikasi yang benar-benar ada di sumber.\n- Jika format Listicle, tiap item harus fakta berbeda, bukan variasi kalimat yang sama.\n- Jika format Tutorial/Tips/Masalah-Solusi tidak didukung evidence sebagai tindakan nyata, gunakan fakta aman dan jangan mengarang instruksi.\n- Dilarang copy placeholder seperti \"Fakta utama tentang...\", \"Fakta berikutnya...\", \"Sumber membahas...\", \"Lanjut baca...\".\n- Dilarang metadata publisher, tanggal publikasi, Baca Juga, cookie policy, privacy policy, newsletter, URL, atau headline artikel terkait. Kata normal seperti privasi/login yang memang bagian fakta produk BUKAN otomatis metadata.\n- Pilih sourceId yang paling kuat untuk setiap fakta. Tidak wajib memakai semua sumber bila ada sumber yang redundant, lemah, atau tidak menambah fakta relevan; jangan memaksa fakta hanya demi coverage.\n\nKembalikan HANYA JSON:\n{"slides":[{"section":"...","title":"...","body":"...","points":["...","...","..."],"claims":[{"field":"slide:0:title","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:point:0","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
}

function autoRecoveryFieldKeys(errors = [], content = {}) {
  const fields = sourceFilter.recoveryFieldKeys(errors);
  for (const error of errors || []) {
    const match = String(error || '').match(/^AUTO_SOURCE_NUMERIC:\s+slide:(\d+):claim:(\d+)\b/i);
    if (!match) continue;
    const claim = content?.slides?.[Number(match[1])]?.claims?.[Number(match[2])];
    const field = String(claim?.field || '').trim();
    if (/^slide:\d+:(?:title|body|point:\d+)$/.test(field)) fields.add(field);
  }
  return fields;
}

function autoRecoveryPrompt({ draft, bank, topic, format, errors, fieldKeys }) {
  return `AUTO SOURCE TARGETED SAFE RECOVERY.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nTARGET_FIELDS: ${JSON.stringify([...fieldKeys])}\nERROR YANG HARUS DIPERBAIKI: ${JSON.stringify(errors || [])}\n\nFACT_BANK:\n${JSON.stringify(bank)}\n\nCURRENT_DRAFT:\n${JSON.stringify(draft?.slides || [])}\n\nATURAN WAJIB:\n- Perbaiki HANYA TARGET_FIELDS. Semua field non-target, jumlah slide, urutan, dan section harus tetap persis.\n- Jangan mengarang fakta, angka, persentase, ranking, sebab-akibat, manfaat, kondisi, atau kepastian baru.\n- Untuk AUTO_SOURCE_NUMERIC, hapus angka yang tidak didukung atau ganti seluruh field target dengan paraphrase fakta FACT_BANK yang benar-benar didukung. Jangan mengganti dengan angka lain.\n- Untuk SEMANTIC_SUPPORT, sempitkan makna field agar setia pada satu evidence. Hapus detail tambahan yang tidak tertulis di evidence, termasuk kanal seperti via teks, voice, aplikasi, platform, atau cara penggunaan bila tidak disebut.\n- Pertahankan entity type, scope/list, modalitas, negasi/pengecualian, uncertainty, tanggal, dan urutan rollout sesuai evidence.\n- Copy tampil wajib Bahasa Indonesia natural. Evidence tetap kutipan exact dari FACT_BANK.\n- Body target harus 8–24 kata. Point target harus 3–7 kata. Maksimal 3 point per slide.\n- Jika point target tidak dapat diperbaiki dari evidence lamanya, boleh ganti dengan fakta relevan lain dari FACT_BANK yang belum dipakai. Jika tetap tidak ada replacement aman, set elemen TARGET point itu menjadi null dan hapus claim target. JANGAN menggeser index point lain di JSON recovery; gunakan null sebagai penanda hapus. 0–2 point valid tetap boleh; jangan membuat bullet baru hanya untuk memenuhi jumlah tertentu.\n- Jika body target tidak dapat dipertahankan, ganti dengan SATU fakta relevan yang benar-benar didukung evidence dan masih menjawab topik.\n- claim.text harus sama persis dengan copy target; sourceId/evidence harus benar-benar mendukung seluruh makna target.\n- Jangan mengubah metadata di luar slides.\n\nKembalikan HANYA JSON lengkap dengan array slides untuk semua slide. Struktur tiap slide: {"section":"...","title":"...","body":"...","points":[],"claims":[]}.`;
}

function mergeAutoRecoveryFields(draft, incoming, fieldKeys) {
  if (!draft || !Array.isArray(draft.slides) || !incoming || !Array.isArray(incoming.slides) || !fieldKeys?.size) return draft;
  const slides = draft.slides.map((slide, slideIndex) => {
    const sourceSlide = incoming.slides[slideIndex];
    if (!sourceSlide) return slide;
    const next = {
      ...slide,
      points: Array.isArray(slide?.points) ? [...slide.points] : [],
      claims: Array.isArray(slide?.claims) ? slide.claims.map(claim => ({ ...claim })) : []
    };

    for (const kind of ['title', 'body']) {
      const field = `slide:${slideIndex}:${kind}`;
      if (!fieldKeys.has(field)) continue;
      next[kind] = String(sourceSlide?.[kind] || '').trim();
      next.claims = next.claims.filter(claim => String(claim?.field || '') !== field);
      const replacementClaim = (sourceSlide?.claims || []).find(claim => String(claim?.field || '') === field);
      if (replacementClaim) next.claims.push({ ...replacementClaim });
    }

    const pointTargets = [...fieldKeys].map(field => {
      const match = field.match(new RegExp(`^slide:${slideIndex}:point:(\\d+)$`));
      return match ? Number(match[1]) : null;
    }).filter(index => index !== null).sort((a, b) => b - a);

    for (const pointIndex of pointTargets) {
      const field = `slide:${slideIndex}:point:${pointIndex}`;
      const incomingPoints = Array.isArray(sourceSlide?.points) ? sourceSlide.points : [];
      const shouldDelete = pointIndex >= incomingPoints.length || incomingPoints[pointIndex] === null;
      if (shouldDelete) {
        if (pointIndex < 0 || pointIndex >= next.points.length) continue;
        next.points.splice(pointIndex, 1);
        next.claims = next.claims.flatMap(claim => {
          const match = String(claim?.field || '').match(new RegExp(`^slide:${slideIndex}:point:(\\d+)$`));
          if (!match) return [claim];
          const claimIndex = Number(match[1]);
          if (claimIndex === pointIndex) return [];
          if (claimIndex > pointIndex) return [{ ...claim, field: `slide:${slideIndex}:point:${claimIndex - 1}` }];
          return [claim];
        });
        continue;
      }

      if (pointIndex >= next.points.length) continue;
      next.points[pointIndex] = String(incomingPoints[pointIndex] || '').trim();
      next.claims = next.claims.filter(claim => String(claim?.field || '') !== field);
      const replacementClaim = (sourceSlide?.claims || []).find(claim => String(claim?.field || '') === field);
      if (replacementClaim) next.claims.push({ ...replacementClaim });
    }
    return next;
  });
  return { ...draft, slides };
}

function parseRecoveryResponse(response) {
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Provider tidak mengembalikan JSON recovery.');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.slides)) throw new Error('JSON recovery tidak memiliki array slides.');
  return parsed;
}

function validateAutoCandidate({ draft, sources, topic, format, contentService, facts }) {
  const checked = sourceFilter.validateVerifiedContent(draft, { slides: draft.slides }, {
    contentService,
    format,
    manualTopic: topic,
    sources,
    autoSourceTopic: false
  });
  const candidate = repairKnownNumericShorthand(compactOverlongPoints(checked.content || draft), sources);
  let checkedErrors = filterFalsePositiveMetadataErrors(checked.errors, candidate);
  checkedErrors = autoSourceValidation.filterFalsePositives(checkedErrors, candidate);
  const errors = [
    ...autoSourceValidation.numericGroundingErrors(candidate, sources),
    ...checkedErrors,
    ...autoSourceCoverageErrors(candidate, sources),
    ...naturalCopyErrors(candidate),
    ...autoSourceValidation.autoSourceStructureErrors(candidate),
    ...richnessErrors(candidate, facts)
  ];
  return { candidate, errors: [...new Set(errors)] };
}

async function recoverSemanticPointFailures({ openai, candidate, semanticErrors, sources, topic, format, contentService, facts }) {
  const reduced = sourceFilter.dropUnsupportedPointClaims(candidate, semanticErrors);
  if (!reduced) return { candidate, errors: semanticErrors };

  const validation = validateAutoCandidate({
    draft: reduced,
    sources,
    topic,
    format,
    contentService,
    facts
  });
  if (validation.errors.length) return { candidate: validation.candidate, errors: validation.errors };

  const remainingSemanticErrors = await sourceFilter.auditClaimSemantics(openai, validation.candidate, topic, format);
  return { candidate: validation.candidate, errors: remainingSemanticErrors };
}

async function rewriteAllSourcesWithAi({ generated, sources = [], topic = '', format = 'Fakta singkat', contentService, client } = {}) {
  const facts = sourceFacts(sources);
  if (!sources.length || !facts.length) throw Object.assign(new Error('Auto Source tidak memiliki fakta yang cukup untuk final rewrite.'), { status: 422 });
  const resolvedTopic = String(topic || generated?.topic || sources?.[0]?.title || 'Topik sumber').trim();
  const effectiveFormat = generated?.effectiveContentFormat || format || 'Fakta singkat';
  const sections = sourceUrlFinalizer.targetSections(generated, effectiveFormat, facts, sources, resolvedTopic);
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let draft = { ...generated, topic: resolvedTopic };
  let lastErrors = [];

  for (let attempt = 0; attempt < MAX_AUTO_FINALIZE_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          { role: 'system', content: 'Anda editor Auto Source AI Ads Lab. Buat carousel Indonesia yang padat fakta, natural, dan sepenuhnya grounded pada evidence. Output placeholder, fakta berulang, metadata, dan hallucination dilarang.' },
          { role: 'user', content: autoPrompt({ generated: draft, sources, facts, format: effectiveFormat, topic: resolvedTopic, errors: lastErrors }) }
        ],
        response_format: { type: 'json_object' }
      });
      draft = syncTop({ ...draft, slides: sourceUrlFinalizer.parseSlides(response, sections), verificationStatus: 'source_based' });
      compactOverlongPoints(draft);
      repairKnownNumericShorthand(draft, sources);
    } catch (error) {
      lastErrors = [`AUTO_SOURCE_PROVIDER_OUTPUT: ${error.message}`];
      continue;
    }

    const validation = validateAutoCandidate({
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
    if (semanticErrors.length) {
      const pruned = await recoverSemanticPointFailures({
        openai,
        candidate: validation.candidate,
        semanticErrors,
        sources,
        topic: resolvedTopic,
        format: effectiveFormat,
        contentService,
        facts
      });
      if (!pruned.errors.length) return syncTop(pruned.candidate);
      lastErrors = pruned.errors;
      draft = pruned.candidate;
      continue;
    }
    return syncTop(validation.candidate);
  }

  const bank = sourceFilter.extractFactBank(sources, resolvedTopic);
  const recoveryStates = new Set();
  for (let attempt = 0; attempt < MAX_AUTO_RECOVERY_ATTEMPTS; attempt += 1) {
    const fieldKeys = autoRecoveryFieldKeys(lastErrors, draft);
    if (!fieldKeys.size || !bank.length) break;
    const state = JSON.stringify({ fields: [...fieldKeys].sort(), slides: draft?.slides || [] });
    if (recoveryStates.has(state)) break;
    recoveryStates.add(state);

    let recovered;
    try {
      const response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          { role: 'system', content: 'Anda melakukan targeted safe recovery Auto Source. Ubah hanya field yang gagal dan jangan mengarang.' },
          { role: 'user', content: autoRecoveryPrompt({ draft, bank, topic: resolvedTopic, format: effectiveFormat, errors: lastErrors, fieldKeys }) }
        ],
        response_format: { type: 'json_object' }
      });
      const parsed = parseRecoveryResponse(response);
      recovered = mergeAutoRecoveryFields(draft, parsed, fieldKeys);
    } catch (error) {
      lastErrors = [`AUTO_SOURCE_RECOVERY_OUTPUT: ${error.message}`];
      continue;
    }

    const validation = validateAutoCandidate({
      draft: recovered,
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
    if (semanticErrors.length) {
      const pruned = await recoverSemanticPointFailures({
        openai,
        candidate: validation.candidate,
        semanticErrors,
        sources,
        topic: resolvedTopic,
        format: effectiveFormat,
        contentService,
        facts
      });
      if (!pruned.errors.length) return syncTop(pruned.candidate);
      lastErrors = pruned.errors;
      draft = pruned.candidate;
      continue;
    }
    return syncTop(validation.candidate);
  }

  throw Object.assign(new Error(`Auto Source final rewrite belum lolos: ${lastErrors[0] || 'validasi konten gagal'}`), {
    status: 422,
    validationErrors: lastErrors
  });
}

module.exports = {
  rewriteAllSourcesWithAi,
  compactOverlongPoints,
  richnessErrors,
  autoSourceCoverageErrors,
  autoPrompt,
  autoRecoveryFieldKeys,
  autoRecoveryPrompt,
  mergeAutoRecoveryFields,
  validateAutoCandidate,
  recoverSemanticPointFailures,
  filterFalsePositiveMetadataErrors,
  repairKnownNumericShorthand,
  numericGroundingErrors: autoSourceValidation.numericGroundingErrors,
  filterFalsePositiveDuplicateErrors: autoSourceValidation.filterFalsePositiveDuplicateErrors,
  MAX_AUTO_FINALIZE_ATTEMPTS,
  MAX_AUTO_RECOVERY_ATTEMPTS
};