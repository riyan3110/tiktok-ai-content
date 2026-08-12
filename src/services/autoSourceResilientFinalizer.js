const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const sourceUrlFinalizer = require('./sourceUrlFinalizer');
const strict = require('./autoSourceStrictFinalizer');
const manualSourceFallback = require('./manualSourceFallback');

// TANPA URL / AUTO SOURCE ONLY.
// This module is loaded only after autoSourcePatch has already excluded Pakai URL.
const MAX_COMPOSE_ATTEMPTS = 2;
const MAX_TARGETED_REPAIRS = 1;
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

function relaxedDensityErrors(content, facts = []) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const profile = strict.strictDensityProfile(facts, slides.length || 4);
  const errors = [];
  slides.forEach((slide, slideIndex) => {
    const bodyCount = words(slide?.body).length;
    const points = Array.isArray(slide?.points) ? slide.points : [];

    // 10-20 remains the writing TARGET. 8-24 is the hard safety/layout range.
    // Do not discard an otherwise factual carousel just because AI landed at 8/9 or 21-24 words.
    if (bodyCount < 8 || bodyCount > 24) {
      errors.push(`AUTO_SOURCE_DENSITY: slide:${slideIndex}:body harus 8-24 kata agar tetap rapi.`);
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

function claimForNumericError(error, content) {
  const match = String(error || '').match(/^AUTO_SOURCE_NUMERIC:\s+slide:(\d+):claim:(\d+)\b/i);
  if (!match) return null;
  return content?.slides?.[Number(match[1])]?.claims?.[Number(match[2])] || null;
}

function sourceForClaim(claim, sources = []) {
  const match = String(claim?.sourceId || '').match(/^source-(\d+)$/);
  return match ? sources[Number(match[1]) - 1] || null : null;
}

function compactEntity(value) {
  return String(value || '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, '');
}

function modelVersionSupportedBySource(claim, source) {
  if (!claim || !source) return false;
  const text = String(claim.text || '');
  const sourceText = `${source.title || ''} ${source.text || ''}`;
  const sourceCompact = compactEntity(sourceText);
  if (!sourceCompact) return false;

  const tokens = text.split(/\s+/).filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    if (!/\d/.test(tokens[index])) continue;
    for (const radius of [0, 1, 2]) {
      const start = Math.max(0, index - radius);
      const end = Math.min(tokens.length, index + radius + 1);
      const phrase = tokens.slice(start, end).join(' ');
      if (!/[a-z]/i.test(phrase) || !/\d/.test(phrase)) continue;
      const compact = compactEntity(phrase);
      if (compact.length >= 4 && sourceCompact.includes(compact)) return true;
    }
  }
  return false;
}

function filterRecoverableErrors(errors = [], content = {}, sources = []) {
  return errors.filter(error => {
    const text = String(error || '');

    // PR #176's exact 10-20 density error is replaced by relaxedDensityErrors().
    if (/^AUTO_SOURCE_DENSITY:\s+slide:\d+:body harus 10-20 kata/i.test(text)) return false;

    // Model/version numbers are valid when the same entity+version exists in the same source context.
    if (/^AUTO_SOURCE_NUMERIC:/i.test(text)) {
      const claim = claimForNumericError(text, content);
      if (claim && modelVersionSupportedBySource(claim, sourceForClaim(claim, sources))) return false;
    }

    return true;
  });
}

function validateCandidate({ draft, sources, topic, format, contentService, facts }) {
  const result = strict.validateStrictCandidate({ draft, sources, topic, format, contentService, facts });
  const errors = [
    ...filterRecoverableErrors(result.errors, result.candidate, sources),
    ...relaxedDensityErrors(result.candidate, facts)
  ];
  return {
    candidate: result.candidate,
    errors: [...new Set(errors)]
  };
}

function prompt({ generated, sources, facts, format, topic, errors }) {
  return `${strict.strictPrompt({ generated, sources, facts, format, topic, errors })}\n\nTITLE EVIDENCE CONTRACT TAMBAHAN:\n- Jika title menyatakan fakta substantif, WAJIB sertakan claim title dengan field slide:X:title, claim.text sama persis dengan title, sourceId, dan evidence yang mendukung seluruh makna title.\n- Jika title hanya heading netral/struktural, jangan menjadikannya klaim faktual baru.\n- Jangan membuat judul hanya karena terdengar menarik; judul tetap harus berasal dari fakta slide.\n- Target body tetap 10-20 kata. Hard layout hanya 8-24 kata; jangan korbankan output faktual hanya untuk mengejar hitungan kata.\n- Untuk nama model/versi seperti GPT-5.6 atau produk bernomor, pertahankan ejaan versi jika entity+versi memang tertulis pada source context yang sama.`;
}

async function tryTargetedRepair({ openai, candidate, errors, sources, facts, topic, format, contentService }) {
  const fields = strict.recoveryFields(errors, candidate);
  if (!fields.size) return { candidate, errors, changed: false };

  const repaired = await strict.targetedRepair({
    openai,
    content: candidate,
    errors,
    sources,
    facts,
    topic,
    format,
    contentService
  });
  if (!repaired.changed) return { candidate, errors, changed: false };

  const validation = validateCandidate({
    draft: repaired.candidate,
    sources,
    topic,
    format,
    contentService,
    facts
  });
  if (validation.errors.length) return { ...validation, changed: true };

  const semanticErrors = await sourceFilter.auditClaimSemantics(openai, validation.candidate, topic, format);
  return { candidate: validation.candidate, errors: semanticErrors, changed: true };
}

async function rewriteAllSourcesWithAi({ generated, sources = [], topic = '', format = 'Fakta singkat', contentService, client } = {}) {
  const facts = manualSourceFallback.sourceFacts(sources);
  if (!sources.length || !facts.length) {
    throw Object.assign(new Error('Auto Source tidak memiliki sumber/fakta yang dapat dipakai.'), { status: 422 });
  }

  const resolvedTopic = String(topic || generated?.topic || sources?.[0]?.title || 'Topik sumber').trim();
  const effectiveFormat = generated?.effectiveContentFormat || format || 'Fakta singkat';
  const sections = sourceUrlFinalizer.targetSections(generated, effectiveFormat, facts, sources, resolvedTopic);
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let draft = { ...generated, topic: resolvedTopic };
  let lastErrors = [];
  let repairCount = 0;

  for (let attempt = 0; attempt < MAX_COMPOSE_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          {
            role: 'system',
            content: 'Anda editor final Tanpa URL/Auto Source AI Ads Lab. Wajib menghasilkan carousel Indonesia yang faktual, padat, natural, memakai semua sumber terpilih, dan tidak mengarang.'
          },
          { role: 'user', content: prompt({ generated: draft, sources, facts, format: effectiveFormat, topic: resolvedTopic, errors: lastErrors }) }
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

    let validation = validateCandidate({
      draft,
      sources,
      topic: resolvedTopic,
      format: effectiveFormat,
      contentService,
      facts
    });

    // Validation errors such as title-without-evidence and unsupported numeric fields
    // get one bounded field repair BEFORE throwing away the whole draft.
    if (validation.errors.length && repairCount < MAX_TARGETED_REPAIRS) {
      const repaired = await tryTargetedRepair({
        openai,
        candidate: validation.candidate,
        errors: validation.errors,
        sources,
        facts,
        topic: resolvedTopic,
        format: effectiveFormat,
        contentService
      });
      if (repaired.changed) {
        repairCount += 1;
        validation = { candidate: repaired.candidate, errors: repaired.errors };
      }
    }

    if (validation.errors.length) {
      lastErrors = validation.errors;
      draft = validation.candidate;
      continue;
    }

    let semanticErrors = await sourceFilter.auditClaimSemantics(openai, validation.candidate, resolvedTopic, effectiveFormat);
    if (semanticErrors.length && repairCount < MAX_TARGETED_REPAIRS) {
      const repaired = await tryTargetedRepair({
        openai,
        candidate: validation.candidate,
        errors: semanticErrors,
        sources,
        facts,
        topic: resolvedTopic,
        format: effectiveFormat,
        contentService
      });
      if (repaired.changed) {
        repairCount += 1;
        semanticErrors = repaired.errors;
        validation.candidate = repaired.candidate;
      }
    }

    if (!semanticErrors.length) return syncTop(validation.candidate);
    lastErrors = semanticErrors;
    draft = validation.candidate;
  }

  throw Object.assign(new Error(`Auto Source final belum lolos: ${lastErrors[0] || 'validasi gagal'}`), {
    status: 422,
    validationErrors: lastErrors
  });
}

module.exports = {
  rewriteAllSourcesWithAi,
  relaxedDensityErrors,
  modelVersionSupportedBySource,
  filterRecoverableErrors,
  validateCandidate,
  prompt,
  richnessErrors: relaxedDensityErrors,
  filterFalsePositiveMetadataErrors: strict.filterFalsePositiveMetadataErrors,
  MAX_COMPOSE_ATTEMPTS,
  MAX_TARGETED_REPAIRS
};