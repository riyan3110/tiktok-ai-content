// PAKAI URL ONLY.
// Repairs only body/bullet fields that the semantic auditor rejects, using the
// exact evidence already attached to that field. It never discovers new facts,
// never changes sourceId/evidence, and never touches Auto Source/Tanpa URL.

const MAX_TARGETED_REPAIR_ROUNDS = 2;
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);

function semanticTargetFields(content, errors = []) {
  const claims = new Map();
  for (const [slideIndex, slide] of (content?.slides || []).entries()) {
    for (const claim of (slide?.claims || [])) {
      const field = String(claim?.field || '').trim();
      if (!field.startsWith(`slide:${slideIndex}:`)) continue;
      claims.set(field, {
        field,
        text: String(claim?.text || '').trim(),
        sourceId: String(claim?.sourceId || '').trim(),
        evidence: String(claim?.evidence || '').trim()
      });
    }
  }

  const targets = [];
  const seen = new Set();
  for (const error of errors || []) {
    const raw = String(error || '');
    const match = raw.match(/SEMANTIC_SUPPORT:\s+(slide:\d+:(?:body|point:\d+))\b/i);
    if (!match) continue;
    const field = match[1].toLocaleLowerCase('id-ID');
    if (seen.has(field)) continue;
    const claim = claims.get(field);
    if (!claim?.sourceId || !claim?.evidence) continue;
    seen.add(field);
    targets.push({
      ...claim,
      field,
      reason: raw.replace(/^SEMANTIC_SUPPORT:\s*/i, '').trim()
    });
  }
  return targets;
}

function semanticRepairPrompt(targets, topic = '', format = '') {
  return `TARGETED PAKAI URL SEMANTIC REPAIR.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT: ${JSON.stringify(format)}\nFIELD YANG HARUS DIPERBAIKI:\n${JSON.stringify(targets)}\n\nATURAN KERAS:\n- Perbaiki HANYA field di daftar. Jangan mengubah field lain.\n- Gunakan HANYA evidence milik field itu sendiri. Dilarang memakai pengetahuan luar atau evidence field lain.\n- Tulis Bahasa Indonesia natural, utuh, ringkas, dan mudah dibaca.\n- Makna hasil HARUS sama atau lebih konservatif daripada evidence; jangan membuat inferensi baru.\n- DILARANG menambahkan tujuan, sebab-akibat, manfaat, aplikasi, risiko, strategi, implikasi, rekomendasi, outcome, atau tingkat kepastian yang tidak dinyatakan eksplisit oleh evidence.\n- Pertahankan entity type, scope, negasi, kondisi, waktu, modalitas, dan uncertainty.\n- Semua angka/ordinal/tanggal yang tampil harus sama persis dengan token yang ada pada evidence. Jangan mengubah format atau menebak angka pengganti.\n- Jika evidence berbahasa Inggris, terjemahkan/parafrase secara konservatif ke Bahasa Indonesia tanpa menambah makna.\n- Untuk field body: 10–20 kata, satu kalimat utuh.\n- Untuk field point: 3–7 kata, frasa/kalimat utuh yang dapat dipahami sendiri.\n- Jangan menyalin alasan error ke copy.\n- Jangan mengembalikan title atau field lain.\n\nKembalikan HANYA JSON:\n{"repairs":[{"field":"slide:0:body","text":"copy baru"}]}`;
}

function parseRepairResponse(response, allowedFields) {
  const content = response?.choices?.[0]?.message?.content;
  let raw = content;
  if (content && typeof content === 'object' && !Array.isArray(content)) raw = JSON.stringify(content);
  if (Array.isArray(content)) {
    if (!content.length || content.some(part => part?.type !== 'text' || typeof part?.text !== 'string')) return [];
    raw = content.map(part => part.text).join('');
  }
  if (typeof raw !== 'string' || !raw.trim()) return [];
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let parsed;
  try { parsed = JSON.parse(fenced ? fenced[1].trim() : trimmed); }
  catch { return []; }
  if (!Array.isArray(parsed?.repairs)) return [];

  const seen = new Set();
  return parsed.repairs.map(item => ({
    field: String(item?.field || '').trim().toLocaleLowerCase('id-ID'),
    text: String(item?.text || '').replace(/\s+/g, ' ').trim()
  })).filter(item => {
    if (!item.field || !item.text || seen.has(item.field) || !allowedFields.has(item.field)) return false;
    const body = /:body$/.test(item.field);
    const point = /:point:\d+$/.test(item.field);
    const count = words(item.text).length;
    if (body && (count < 8 || count > 20)) return false;
    if (point && (count < 3 || count > 7)) return false;
    seen.add(item.field);
    return body || point;
  });
}

function applySemanticRepairs(content, repairs = []) {
  if (!content?.slides || !Array.isArray(repairs) || !repairs.length) return { content, changed: false };
  const slides = content.slides.map(slide => ({
    ...slide,
    points: Array.isArray(slide?.points) ? [...slide.points] : [],
    claims: Array.isArray(slide?.claims) ? slide.claims.map(claim => ({ ...claim })) : []
  }));
  let changed = false;

  for (const repair of repairs) {
    const match = String(repair?.field || '').match(/^slide:(\d+):(body|point:(\d+))$/i);
    if (!match) continue;
    const slideIndex = Number(match[1]);
    const slide = slides[slideIndex];
    if (!slide) continue;
    const field = `slide:${slideIndex}:${match[2].toLocaleLowerCase('id-ID')}`;
    const claim = slide.claims.find(item => String(item?.field || '').toLocaleLowerCase('id-ID') === field);
    if (!claim?.evidence || !claim?.sourceId) continue;
    const text = String(repair?.text || '').trim();
    if (!text) continue;

    if (match[2].toLocaleLowerCase('id-ID') === 'body') {
      slide.body = text;
    } else {
      const pointIndex = Number(match[3]);
      if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= slide.points.length) continue;
      slide.points[pointIndex] = text;
    }
    claim.text = text;
    changed = true;
  }

  return { content: changed ? { ...content, slides } : content, changed };
}

async function repairUnsupportedFields({ openai, model, content, errors = [], topic = '', format = '' } = {}) {
  const targets = semanticTargetFields(content, errors);
  if (!targets.length) return { content, changed: false, targets: [] };
  const allowedFields = new Set(targets.map(target => target.field));
  let response;
  try {
    response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Anda editor koreksi fakta yang sangat konservatif. Perbaiki hanya field yang diberikan agar sepenuhnya didukung evidence yang sama, tanpa menambah inferensi.' },
        { role: 'user', content: semanticRepairPrompt(targets, topic, format) }
      ],
      response_format: { type: 'json_object' }
    });
  } catch {
    return { content, changed: false, targets };
  }
  const repairs = parseRepairResponse(response, allowedFields);
  const applied = applySemanticRepairs(content, repairs);
  return { ...applied, targets, repairs };
}

async function recoverSemanticFailures({ openai, model, content, errors = [], topic = '', format = '', validate, audit } = {}) {
  let working = content;
  let remainingErrors = Array.isArray(errors) ? errors : [];
  let changed = false;
  let lastTargets = [];

  for (let round = 0; round < MAX_TARGETED_REPAIR_ROUNDS; round += 1) {
    const repaired = await repairUnsupportedFields({
      openai,
      model,
      content: working,
      errors: remainingErrors,
      topic,
      format
    });
    lastTargets = repaired.targets || [];
    if (!repaired.changed) break;
    changed = true;
    working = repaired.content;

    const validated = typeof validate === 'function' ? validate(working) : { content: working, errors: [] };
    working = validated?.content || working;
    if (validated?.errors?.length) {
      remainingErrors = validated.errors;
      break;
    }

    const audited = typeof audit === 'function'
      ? await audit(working)
      : { content: working, errors: [] };
    working = audited?.content || working;
    remainingErrors = Array.isArray(audited?.errors) ? audited.errors : [];
    if (!remainingErrors.length) break;
    if (!semanticTargetFields(working, remainingErrors).length) break;
  }

  return {
    content: working,
    errors: remainingErrors,
    changed,
    targets: lastTargets
  };
}

module.exports = {
  semanticTargetFields,
  semanticRepairPrompt,
  parseRepairResponse,
  applySemanticRepairs,
  repairUnsupportedFields,
  recoverSemanticFailures,
  MAX_TARGETED_REPAIR_ROUNDS
};