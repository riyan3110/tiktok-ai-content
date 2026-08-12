const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const sourceUrlFinalizer = require('./sourceUrlFinalizer');
const strict = require('./autoSourceStrictFinalizer');
const manualSourceFallback = require('./manualSourceFallback');

// TANPA URL / AUTO SOURCE ONLY.
// This module is loaded only after autoSourcePatch has already excluded Pakai URL.
const MAX_COMPOSE_ATTEMPTS = 2;
const MAX_TARGETED_REPAIRS = 2;
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '').trim().toLocaleLowerCase('id-ID').replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
const cloneContent = content => ({
  ...content,
  slides: Array.isArray(content?.slides) ? content.slides.map(slide => ({
    ...slide,
    points: Array.isArray(slide?.points) ? [...slide.points] : [],
    claims: Array.isArray(slide?.claims) ? slide.claims.map(claim => ({ ...claim })) : []
  })) : []
});

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

function timeTokens(value) {
  const out = [];
  for (const match of String(value || '').matchAll(/\b([01]?\d|2[0-3])([.:])([0-5]\d)\b/g)) {
    out.push({ raw: match[0], canonical: `${String(Number(match[1])).padStart(2, '0')}:${match[3]}` });
  }
  return out;
}

function hasTimeCue(value) {
  return /\b(?:pukul|jam|wib|wita|wit|utc|gmt|waktu|mulai|berakhir|hingga|sampai|puncak|maksimum|maksimal|berlangsung)\b/i.test(String(value || ''));
}

function sourceSentenceCandidates(source) {
  return String(source?.text || '')
    .replace(/\r/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter(value => words(value).length >= 4 && words(value).length <= 32);
}

function fieldValue(content, field) {
  const match = String(field || '').match(/^slide:(\d+):(title|body|point:(\d+))$/);
  if (!match) return '';
  const slide = content?.slides?.[Number(match[1])];
  if (!slide) return '';
  if (match[2] === 'title') return String(slide.title || '');
  if (match[2] === 'body') return String(slide.body || '');
  return String(slide.points?.[Number(match[3])] || '');
}

function setFieldValue(content, field, value) {
  const match = String(field || '').match(/^slide:(\d+):(title|body|point:(\d+))$/);
  if (!match) return false;
  const slide = content?.slides?.[Number(match[1])];
  if (!slide) return false;
  if (match[2] === 'title') slide.title = value;
  else if (match[2] === 'body') slide.body = value;
  else {
    const index = Number(match[3]);
    if (!Array.isArray(slide.points) || index < 0 || index >= slide.points.length) return false;
    slide.points[index] = value;
  }
  return true;
}

function repairEquivalentTimeFormatting(content, sources = []) {
  if (!content?.slides) return content;
  const repaired = cloneContent(content);
  for (const slide of repaired.slides) {
    for (const claim of Array.isArray(slide?.claims) ? slide.claims : []) {
      const source = sourceForClaim(claim, sources);
      if (!source) continue;
      const claimTimes = timeTokens(claim.text);
      if (!claimTimes.length) continue;
      const candidates = sourceSentenceCandidates(source);
      const sourceTimes = candidates.flatMap(sentence => timeTokens(sentence).map(time => ({ ...time, sentence })));
      let nextText = String(claim.text || '');
      let nextEvidence = String(claim.evidence || '');
      let changed = false;

      for (const claimTime of claimTimes) {
        const match = sourceTimes.find(sourceTime => sourceTime.canonical === claimTime.canonical
          && (hasTimeCue(nextText) || hasTimeCue(nextEvidence) || hasTimeCue(sourceTime.sentence)));
        if (!match) continue;
        if (claimTime.raw !== match.raw) {
          nextText = nextText.replace(claimTime.raw, match.raw);
          changed = true;
        }
        if (!timeTokens(nextEvidence).some(time => time.canonical === claimTime.canonical)) {
          nextEvidence = match.sentence;
          changed = true;
        } else if (!String(nextEvidence).includes(match.raw) && claimTime.raw !== match.raw) {
          const evidenceMatch = sourceTimes.find(sourceTime => sourceTime.canonical === claimTime.canonical && sourceTime.raw === match.raw);
          if (evidenceMatch) {
            nextEvidence = evidenceMatch.sentence;
            changed = true;
          }
        }
      }

      if (!changed) continue;
      const oldText = String(claim.text || '');
      claim.text = nextText;
      claim.evidence = nextEvidence;
      if (normalize(fieldValue(repaired, claim.field)) === normalize(oldText)) setFieldValue(repaired, claim.field, nextText);
    }
  }
  return syncTop(repaired);
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

function titleErrorIndexes(errors = []) {
  const indexes = new Set();
  for (const error of errors) {
    const text = String(error || '');
    let match = text.match(/^slide:(\d+):natural:\s+judul (?:mengulang|generik)/i);
    if (!match) match = text.match(/^slide:(\d+):title:\s*(?:klaim faktual tidak memiliki evidence|claim\.text tidak sama)/i);
    if (!match) match = text.match(/^SEMANTIC_SUPPORT:\s+slide:(\d+):title\b/i);
    if (match) indexes.add(Number(match[1]));
  }
  return indexes;
}

function deriveUniqueTitle(body, usedTitles = new Set()) {
  const tokens = words(String(body || '').replace(/[.!?]+$/g, '').trim());
  if (!tokens.length) return '';
  for (let count = Math.min(8, tokens.length); count >= Math.min(3, tokens.length); count -= 1) {
    const raw = tokens.slice(0, count).join(' ').replace(/[,;:\-–—]+$/g, '').trim();
    const key = normalize(raw);
    if (!raw || !key || usedTitles.has(key)) continue;
    return raw.charAt(0).toLocaleUpperCase('id-ID') + raw.slice(1);
  }
  return '';
}

function repairTitleOnlyErrors(content, errors = []) {
  const targets = titleErrorIndexes(errors);
  if (!targets.size || !content?.slides) return { candidate: content, changed: false };
  const repaired = cloneContent(content);
  const used = new Set(repaired.slides.map((slide, index) => targets.has(index) ? '' : normalize(slide?.title)).filter(Boolean));
  let changed = false;

  for (const slideIndex of targets) {
    const slide = repaired.slides[slideIndex];
    if (!slide) continue;
    const bodyField = `slide:${slideIndex}:body`;
    const bodyClaim = (slide.claims || []).find(claim => String(claim?.field || '') === bodyField);
    if (!bodyClaim) continue;
    const title = deriveUniqueTitle(slide.body, used);
    if (!title || normalize(title) === normalize(slide.title)) continue;
    slide.title = title;
    const titleField = `slide:${slideIndex}:title`;
    slide.claims = (slide.claims || []).filter(claim => String(claim?.field || '') !== titleField);
    slide.claims.push({
      field: titleField,
      text: title,
      sourceId: bodyClaim.sourceId,
      evidence: bodyClaim.evidence
    });
    used.add(normalize(title));
    changed = true;
  }

  return { candidate: changed ? syncTop(repaired) : content, changed };
}

function validateCandidate({ draft, sources, topic, format, contentService, facts }) {
  let prepared = repairEquivalentTimeFormatting(draft, sources);
  let result = strict.validateStrictCandidate({ draft: prepared, sources, topic, format, contentService, facts });

  // Exact duplicate/generic title is a copy-quality issue, not a reason to destroy
  // an otherwise grounded carousel. Repair it deterministically from the grounded body.
  const titleRepair = repairTitleOnlyErrors(result.candidate, result.errors);
  if (titleRepair.changed) {
    prepared = titleRepair.candidate;
    result = strict.validateStrictCandidate({ draft: prepared, sources, topic, format, contentService, facts });
  }

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
  return `${strict.strictPrompt({ generated, sources, facts, format, topic, errors })}\n\nRESILIENT OUTPUT CONTRACT — TAMBAHAN:\n- Jika title menyatakan fakta substantif, WAJIB sertakan claim title dengan field slide:X:title, claim.text sama persis dengan title, sourceId, dan evidence yang mendukung seluruh makna title.\n- Setiap title wajib berbeda antar-slide. Jangan mengulang title slide sebelumnya dan jangan memakai label section sebagai title visible.\n- Jika title hanya heading netral/struktural, jangan menjadikannya klaim faktual baru.\n- Target body tetap 10-20 kata. Hard layout hanya 8-24 kata; jangan korbankan output faktual hanya untuk mengejar hitungan kata.\n- Untuk nama model/versi seperti GPT-5.6 atau produk bernomor, pertahankan ejaan versi jika entity+versi memang tertulis pada source context yang sama.\n- Untuk waktu, jangan mengubah nilai jam. Ikuti format yang dipakai sumber (contoh 23:57 vs 23.57) supaya evidence dan copy konsisten.\n- Jika satu fakta/angka tidak bisa didukung evidence yang sama, GANTI field itu dengan fakta lain dari fact bank; jangan biarkan seluruh carousel gagal.\n- Semua source terpilih tetap wajib menyumbang fakta visible. Source kaya tetap target body padat + 3 bullet fakta berbeda per slide.`;
}

function resilientRecoveryFields(errors = [], content = {}) {
  const fields = strict.recoveryFields(errors, content);
  for (const error of errors) {
    const text = String(error || '');
    let match = text.match(/^slide:(\d+):natural:\s+judul (?:mengulang|generik)/i);
    if (match) fields.add(`slide:${Number(match[1])}:title`);

    match = text.match(/^slide:(\d+):natural:\s+body\b/i);
    if (match) fields.add(`slide:${Number(match[1])}:body`);

    match = text.match(/^slide:(\d+):duplicate:\s+fakta canonical mengulang slide sebelumnya/i);
    if (match) {
      const slideIndex = Number(match[1]);
      const seen = new Set();
      for (let earlier = 0; earlier < slideIndex; earlier += 1) {
        for (const claim of content?.slides?.[earlier]?.claims || []) {
          if (String(claim?.field || '').endsWith(':title')) continue;
          const key = `${String(claim?.sourceId || '')}::${normalize(claim?.evidence)}`;
          if (!key.endsWith('::')) seen.add(key);
        }
      }
      for (const claim of content?.slides?.[slideIndex]?.claims || []) {
        if (String(claim?.field || '').endsWith(':title')) continue;
        const key = `${String(claim?.sourceId || '')}::${normalize(claim?.evidence)}`;
        if (seen.has(key) && /^slide:\d+:(?:body|point:\d+)$/.test(String(claim?.field || ''))) fields.add(String(claim.field));
      }
    }
  }
  return fields;
}

function repairPrompt({ content, fields, bank, topic, format, errors }) {
  return `AUTO SOURCE RESILIENT TARGETED REPAIR — TANPA URL SAJA.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nTARGET FIELD: ${JSON.stringify([...fields])}\nERROR: ${JSON.stringify(errors)}\nFACT BANK: ${JSON.stringify(bank)}\nCURRENT SLIDES: ${JSON.stringify(content?.slides || [])}\n\nATURAN KERAS:\n- Perbaiki HANYA target field. Semua field non-target harus tetap sama.\n- Gunakan fakta dari FACT BANK saja. Jangan memakai pengetahuan luar.\n- Jika field lama tidak bisa didukung, ganti dengan fakta berbeda yang evidence-nya benar; jangan menghapus bullet untuk sekadar lolos.\n- Title harus natural, spesifik, 3-10 kata, berbeda dari semua title slide lain, dan tidak boleh hanya label section.\n- Body 8-24 kata (target 10-20). Bullet 3-7 kata.\n- Body/bullet harus natural Bahasa Indonesia, bukan potongan evidence mentah.\n- claim.text harus sama persis dengan copy visible; sourceId dan evidence harus berasal dari source yang sama.\n- Jangan menambah tujuan, manfaat, strategi, sebab-akibat, aplikasi, implikasi, outcome, angka, waktu, versi, atau kepastian yang tidak dinyatakan evidence.\n- Jika menulis angka/waktu/versi, ikuti nilai dan format sumber yang dipilih.\n- Jangan memakai evidence canonical yang sudah dipakai field lain jika ada fakta unik lain yang tersedia.\n- Semua sumber terpilih harus tetap terwakili pada carousel final.\n\nKembalikan HANYA JSON: {"repairs":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}`;
}

function parseJsonResponse(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) return content;
  let raw = content;
  if (Array.isArray(content)) raw = content.map(part => part?.text || '').join('');
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Provider tidak mengembalikan JSON repair.');
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}

async function tryTargetedRepair({ openai, candidate, errors, sources, facts, topic, format, contentService }) {
  const fields = resilientRecoveryFields(errors, candidate);
  if (!fields.size) return { candidate, errors, changed: false };
  const bank = sourceFilter.extractFactBank(sources, topic);
  if (!bank.length) return { candidate, errors, changed: false };

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        { role: 'system', content: 'Anda editor koreksi Auto Source. Perbaiki hanya field yang gagal, gunakan semua sumber terpilih secara faktual, natural, dan jangan mengarang.' },
        { role: 'user', content: repairPrompt({ content: candidate, fields, bank, topic, format, errors }) }
      ],
      response_format: { type: 'json_object' }
    });
  } catch {
    return { candidate, errors, changed: false };
  }

  let parsed;
  try { parsed = parseJsonResponse(response); }
  catch { return { candidate, errors, changed: false }; }

  const repaired = strict.applyRepairs(candidate, Array.isArray(parsed?.repairs) ? parsed.repairs : [], fields);
  const changed = normalize(JSON.stringify(repaired?.slides || [])) !== normalize(JSON.stringify(candidate?.slides || []));
  if (!changed) return { candidate, errors, changed: false };

  const validation = validateCandidate({
    draft: repaired,
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

  throw Object.assign(new Error(`Auto Source final belum lolos setelah compose + repair terarah: ${lastErrors[0] || 'validasi gagal'}`), {
    status: 422,
    validationErrors: lastErrors
  });
}

module.exports = {
  rewriteAllSourcesWithAi,
  relaxedDensityErrors,
  modelVersionSupportedBySource,
  timeTokens,
  repairEquivalentTimeFormatting,
  resilientRecoveryFields,
  repairTitleOnlyErrors,
  filterRecoverableErrors,
  validateCandidate,
  prompt,
  richnessErrors: relaxedDensityErrors,
  filterFalsePositiveMetadataErrors: strict.filterFalsePositiveMetadataErrors,
  MAX_COMPOSE_ATTEMPTS,
  MAX_TARGETED_REPAIRS
};