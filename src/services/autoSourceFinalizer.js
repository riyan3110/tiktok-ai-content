const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const manualSourceFallback = require('./manualSourceFallback');
const sourceUrlFinalizer = require('./sourceUrlFinalizer');
const autoSourceValidation = require('./autoSourceValidation');

const { sourceFacts, sourceRichness, validateSourceContent, compactPoint } = manualSourceFallback;
const MAX_AUTO_FINALIZE_ATTEMPTS = 2;
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

function repairKnownNumericShorthand(content) {
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
  return content;
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
  const profile = sourceRichness(facts, slides.length || 4);
  const errors = [];
  slides.forEach((slide, index) => {
    const bodyCount = words(slide?.body).length;
    const points = Array.isArray(slide?.points) ? slide.points : [];
    const visibleCount = words(slide?.title).length + bodyCount + points.reduce((sum, point) => sum + words(point).length, 0);
    if (bodyCount < Math.max(8, profile.bodyMin)) errors.push(`AUTO_SOURCE_RICHNESS: slide ${index + 1} body terlalu tipis (${bodyCount} kata).`);
    if (points.length < profile.targetPoints) errors.push(`AUTO_SOURCE_RICHNESS: slide ${index + 1} baru ${points.length} fakta ringkas; target ${profile.targetPoints}.`);
    if (visibleCount < Math.max(20, profile.hardFloor)) errors.push(`AUTO_SOURCE_RICHNESS: slide ${index + 1} belum cukup padat fakta.`);
  });
  return [...new Set(errors)];
}

function autoPrompt({ generated, sources, facts, format, topic, errors }) {
  const sections = sourceUrlFinalizer.targetSections(generated, format, facts, sources, topic);
  const sourceGroups = sourceUrlFinalizer.groupedFacts(sources, facts);
  const profile = sourceRichness(facts, sections.length);
  return `AUTO SOURCE FINAL REWRITE — BUAT CAROUSEL FAKTUAL, PADAT, NATURAL.\n\nTOPIK USER: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nSECTION WAJIB: ${JSON.stringify(sections)}\nERROR SEBELUMNYA: ${JSON.stringify(errors || [])}\n\nSUMBER TERPILIH + FACT BANK:\n${JSON.stringify(sourceGroups)}\n\nDRAF SAAT INI:\n${JSON.stringify(generated?.slides || [])}\n\nATURAN WAJIB:\n- Tulis Bahasa Indonesia natural seperti editor manusia, bukan template/fallback.\n- HANYA gunakan fakta dari FACT BANK. Tidak boleh menambah pengetahuan luar, asumsi, angka, ranking, sebab-akibat, atau kepastian yang tidak ada pada evidence.\n- Setiap slide harus punya SATU ide utama yang spesifik, bukan judul generik.\n- Judul 3–10 kata, spesifik terhadap fakta slide.\n- Body 10–20 kata, satu kalimat utuh yang menjelaskan fakta/konteks utama. Maksimal 24 kata.\n- Jika source cukup kaya, isi ${profile.targetPoints} bullet fakta berbeda pada SETIAP slide. Maksimal 3 bullet.\n- Setiap bullet WAJIB 3–7 kata, utuh, faktual, dan menambah informasi baru. Jangan memotong kalimat; parafrase singkat.\n- Judul dan body BOLEH sama-sama menyebut nama produk/topik. Yang dilarang adalah mengulang kalimat/ide tanpa informasi baru. Body wajib menambah fakta atau konteks baru.\n- Jangan ulang ide body di bullet. Jangan ulang fakta antar-slide.\n- Setiap body dan bullet wajib punya claim dengan field yang tepat, sourceId, dan evidence dari sumber yang sama.\n- Evidence boleh Inggris, copy visible wajib Indonesia natural tanpa mengubah makna.\n- Angka visible hanya boleh dipakai bila angka yang sama tertulis di evidence claim tersebut ATAU merupakan bagian nama/model/version yang benar-benar tertulis di sumber yang sama. Jangan menciptakan angka baru dari makna implisit.\n- Jangan mengubah kata seperti everyday/daily menjadi angka. Khusus everyday/daily harus ditulis sebagai setiap hari, BUKAN 24/7.\n- Jika topik luas, pilih fakta paling informatif: definisi/konteks, kemampuan/fitur, penggunaan/dampak, lalu perkembangan/implikasi yang benar-benar ada di sumber.\n- Jika format Listicle, tiap item harus fakta berbeda, bukan variasi kalimat yang sama.\n- Jika format Tutorial/Tips/Masalah-Solusi tidak didukung evidence sebagai tindakan nyata, gunakan fakta aman dan jangan mengarang instruksi.\n- Dilarang copy placeholder seperti \"Fakta utama tentang...\", \"Fakta berikutnya...\", \"Sumber membahas...\", \"Lanjut baca...\".\n- Dilarang metadata publisher, tanggal publikasi, Baca Juga, cookie policy, privacy policy, newsletter, URL, atau headline artikel terkait. Kata normal seperti privasi/login yang memang bagian fakta produk BUKAN otomatis metadata.\n- Gunakan semua sourceId yang diberikan minimal sekali bila lebih dari satu sumber.\n\nKembalikan HANYA JSON:\n{"slides":[{"section":"...","title":"...","body":"...","points":["...","...","..."],"claims":[{"field":"slide:0:title","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:point:0","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
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
      repairKnownNumericShorthand(draft);
    } catch (error) {
      lastErrors = [`AUTO_SOURCE_PROVIDER_OUTPUT: ${error.message}`];
      continue;
    }

    const checked = sourceFilter.validateVerifiedContent(draft, { slides: draft.slides }, {
      contentService,
      format: effectiveFormat,
      manualTopic: resolvedTopic,
      sources,
      autoSourceTopic: true
    });
    const candidate = repairKnownNumericShorthand(compactOverlongPoints(checked.content || draft));
    let checkedErrors = filterFalsePositiveMetadataErrors(checked.errors, candidate);
    checkedErrors = autoSourceValidation.filterFalsePositives(checkedErrors, candidate);
    const deterministicErrors = [
      ...autoSourceValidation.numericGroundingErrors(candidate, sources),
      ...checkedErrors,
      ...validateSourceContent(candidate, sources),
      ...richnessErrors(candidate, facts)
    ];
    if (deterministicErrors.length) {
      lastErrors = [...new Set(deterministicErrors)];
      draft = candidate;
      continue;
    }

    const semanticErrors = await sourceFilter.auditClaimSemantics(openai, candidate, resolvedTopic, effectiveFormat);
    if (semanticErrors.length) {
      lastErrors = semanticErrors;
      draft = candidate;
      continue;
    }
    return syncTop(candidate);
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
  autoPrompt,
  filterFalsePositiveMetadataErrors,
  repairKnownNumericShorthand,
  numericGroundingErrors: autoSourceValidation.numericGroundingErrors,
  filterFalsePositiveDuplicateErrors: autoSourceValidation.filterFalsePositiveDuplicateErrors,
  MAX_AUTO_FINALIZE_ATTEMPTS
};
