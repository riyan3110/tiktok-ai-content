const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const manualSourceFallback = require('./manualSourceFallback');
const sourceUrlFinalizer = require('./sourceUrlFinalizer');

const { sourceFacts, sourceRichness, validateSourceContent, compactPoint } = manualSourceFallback;
const MAX_AUTO_FINALIZE_ATTEMPTS = 3;
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
  return `AUTO SOURCE FINAL REWRITE — BUAT CAROUSEL FAKTUAL, PADAT, NATURAL.\n\nTOPIK USER: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nSECTION WAJIB: ${JSON.stringify(sections)}\nERROR SEBELUMNYA: ${JSON.stringify(errors || [])}\n\nSUMBER TERPILIH + FACT BANK:\n${JSON.stringify(sourceGroups)}\n\nDRAF SAAT INI:\n${JSON.stringify(generated?.slides || [])}\n\nATURAN WAJIB:\n- Tulis Bahasa Indonesia natural seperti editor manusia, bukan template/fallback.\n- HANYA gunakan fakta dari FACT BANK. Tidak boleh menambah pengetahuan luar, asumsi, angka, ranking, sebab-akibat, atau kepastian yang tidak ada pada evidence.\n- Setiap slide harus punya SATU ide utama yang spesifik, bukan judul generik.\n- Judul 3–10 kata, spesifik terhadap fakta slide.\n- Body 10–20 kata, satu kalimat utuh yang menjelaskan fakta/konteks utama. Maksimal 24 kata.\n- Jika source cukup kaya, isi ${profile.targetPoints} bullet fakta berbeda pada SETIAP slide. Maksimal 3 bullet.\n- Setiap bullet WAJIB 3–7 kata, utuh, faktual, dan menambah informasi baru. Jangan memotong kalimat; parafrase singkat.\n- Jangan ulang ide body di bullet. Jangan ulang fakta antar-slide.\n- Setiap body dan bullet wajib punya claim dengan field yang tepat, sourceId, dan evidence dari sumber yang sama.\n- Evidence boleh Inggris, copy visible wajib Indonesia natural tanpa mengubah makna.\n- Jika topik luas, pilih fakta paling informatif: definisi/konteks, kemampuan/fitur, penggunaan/dampak, lalu perkembangan/implikasi yang benar-benar ada di sumber.\n- Jika format Listicle, tiap item harus fakta berbeda, bukan variasi kalimat yang sama.\n- Jika format Tutorial/Tips/Masalah-Solusi tidak didukung evidence sebagai tindakan nyata, gunakan fakta aman dan jangan mengarang instruksi.\n- Dilarang copy placeholder seperti \"Fakta utama tentang...\", \"Fakta berikutnya...\", \"Sumber membahas...\", \"Lanjut baca...\".\n- Dilarang metadata publisher, tanggal publikasi, Baca Juga, cookie, newsletter, URL, atau headline artikel terkait.\n- Gunakan semua sourceId yang diberikan minimal sekali bila lebih dari satu sumber.\n\nKembalikan HANYA JSON:\n{"slides":[{"section":"...","title":"...","body":"...","points":["...","...","..."],"claims":[{"field":"slide:0:title","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:point:0","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
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
    } catch (error) {
      lastErrors = [`AUTO_SOURCE_PROVIDER_OUTPUT: ${error.message}`];
      continue;
    }

    const checked = sourceFilter.validateVerifiedContent(draft, { slides: draft.slides }, {
      contentService,
      format: effectiveFormat,
      manualTopic: resolvedTopic,
      sources,
      autoSourceTopic: false
    });
    const candidate = compactOverlongPoints(checked.content || draft);
    const deterministicErrors = [
      ...sourceUrlFinalizer.numericGroundingErrors(candidate),
      ...checked.errors,
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
  MAX_AUTO_FINALIZE_ATTEMPTS
};
