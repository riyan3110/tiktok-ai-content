const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');

const MAX_MANUAL_DEDUPE_ATTEMPTS = 3;
const COPY_STOPWORDS = new Set([
  'yang', 'dan', 'atau', 'dari', 'untuk', 'dengan', 'tentang', 'cara', 'adalah', 'pada',
  'itu', 'ini', 'sebagai', 'dalam', 'lebih', 'juga', 'bisa', 'dapat', 'akan', 'fakta',
  'utama', 'singkat', 'slide', 'bagian'
]);

const normalize = value => String(value || '')
  .toLocaleLowerCase('id-ID')
  .replace(/[^a-z0-9%\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function meaningfulTokens(value) {
  return [...new Set(normalize(value).split(' ').filter(token => (token.length > 2 || token === 'ai') && !COPY_STOPWORDS.has(token)))];
}

function nearDuplicateCopy(left, right) {
  const leftNorm = normalize(left);
  const rightNorm = normalize(right);
  if (!leftNorm || !rightNorm) return false;
  if (leftNorm === rightNorm) return true;
  const a = meaningfulTokens(left);
  const b = meaningfulTokens(right);
  if (a.length < 4 || b.length < 4) return false;
  const shared = a.filter(token => b.includes(token));
  return shared.length >= 3 && shared.length / Math.min(a.length, b.length) >= 0.85;
}

function isSummaryEdgeSlide(slide, slideIndex, totalSlides) {
  const section = String(slide?.section || '').trim();
  if (slideIndex === 0 && /^(?:PEMBUKA|HOOK|INTRO)$/i.test(section)) return true;
  if (slideIndex === totalSlides - 1 && /^(?:PENUTUP|CTA|KESIMPULAN|RINGKASAN)$/i.test(section)) return true;
  return false;
}

function substantiveFields(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const records = [];
  slides.forEach((slide, slideIndex) => {
    if (isSummaryEdgeSlide(slide, slideIndex, slides.length)) return;
    const claimByField = new Map((Array.isArray(slide?.claims) ? slide.claims : []).map(claim => [String(claim?.field || ''), claim]));
    const body = String(slide?.body || '').trim();
    if (body) {
      const key = `slide:${slideIndex}:body`;
      records.push({ slideIndex, key, value: body, claim: claimByField.get(key) });
    }
    (Array.isArray(slide?.points) ? slide.points : []).forEach((point, pointIndex) => {
      const value = String(point || '').trim();
      if (!value) return;
      const key = `slide:${slideIndex}:point:${pointIndex}`;
      records.push({ slideIndex, key, value, claim: claimByField.get(key) });
    });
  });
  return records;
}

function canonicalFactKey(record) {
  const sourceId = String(record?.claim?.sourceId || '').trim();
  const evidence = normalize(record?.claim?.evidence);
  return sourceId && evidence ? `${sourceId}::${evidence}` : '';
}

function manualCrossSlideDuplicateErrors(content) {
  const errors = [];
  const seenFacts = new Map();
  const previous = [];
  for (const record of substantiveFields(content)) {
    let duplicate = false;
    const factKey = canonicalFactKey(record);
    if (factKey && seenFacts.has(factKey) && seenFacts.get(factKey).slideIndex !== record.slideIndex) duplicate = true;
    if (!duplicate) {
      duplicate = previous.some(item => item.slideIndex !== record.slideIndex && nearDuplicateCopy(item.value, record.value));
    }
    if (duplicate) errors.push(`${record.key}: pembahasan mengulang fakta slide sebelumnya.`);
    if (factKey && !seenFacts.has(factKey)) seenFacts.set(factKey, record);
    previous.push(record);
  }
  return [...new Set(errors)];
}

function usedCanonicalFacts(content, targetFields = new Set()) {
  const used = [];
  for (const record of substantiveFields(content)) {
    if (targetFields.has(record.key)) continue;
    const sourceId = String(record?.claim?.sourceId || '').trim();
    const evidence = String(record?.claim?.evidence || '').trim();
    if (!sourceId || !evidence) continue;
    const key = `${sourceId}::${normalize(evidence)}`;
    if (!used.some(item => item.key === key)) used.push({ key, sourceId, evidence });
  }
  return used.map(({ sourceId, evidence }) => ({ sourceId, evidence }));
}

function recoveryPrompt({ draft, bank, errors, fieldKeys }) {
  const usedFacts = usedCanonicalFacts(draft, fieldKeys);
  return `Anda memperbaiki carousel Topik Manual + URL secara SOURCE-LOCKED. Jangan memakai pengetahuan luar.\n\nTARGET FIELD YANG BOLEH BERUBAH:\n${JSON.stringify([...fieldKeys])}\n\nERROR:\n${errors.join('\n')}\n\nATURAN WAJIB:\n- Ubah HANYA target field. Semua field non-target, jumlah slide, urutan, section, dan title non-target harus tetap persis.\n- Error pengulangan berarti target field membahas fakta yang sudah dipakai slide sebelumnya. Ganti target dengan SATU fakta relevan lain dari FACT_BANK yang belum dipakai.\n- Fakta dianggap sama berdasarkan pasangan sourceId + evidence canonical, walaupun wording Indonesia berbeda. Jangan memparafrasekan evidence lama menjadi kalimat baru.\n- sourceId dan evidence harus disalin PERSIS dari pasangan FACT_BANK yang sama. Evidence tidak boleh diterjemahkan atau diedit.\n- Copy target wajib Bahasa Indonesia natural, singkat, dan setia pada evidence. Jangan menambah sebab-akibat, manfaat, angka, nama, tanggal, modalitas, atau kesimpulan yang tidak ada.\n- Jika target berupa point dan tidak ada fakta berbeda yang aman, point boleh dihapus beserta claim-nya.\n- Jika target berupa body, jangan ganti dengan filler/CTA seperti “baca selengkapnya”, “perhatikan konteks”, atau kalimat kosong; gunakan fakta substantif yang berbeda.\n- Jangan gunakan pasangan canonical berikut karena sudah dipakai field non-target: ${JSON.stringify(usedFacts)}.\n\nFACT_BANK:\n${JSON.stringify(bank)}\n\nCURRENT_DRAFT:\n${JSON.stringify(draft.slides)}\n\nKembalikan HANYA JSON {"slides":[{"section":"...","title":"...","body":"...","points":[],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}.`;
}

function parseResponse(response) {
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Manual duplicate recovery tidak mengembalikan konten.');
  return JSON.parse(raw);
}

async function repairManualSourceDuplicates({ contentService, generated, options = {}, sources = [], client }) {
  let draft = generated;
  let errors = manualCrossSlideDuplicateErrors(draft);
  if (!errors.length) return generated;

  const topic = options.requestedTopic || generated?.topic || '';
  const bank = sourceFilter.extractFactBank(sources, topic);
  if (!bank.length) return generated;
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const recoveryStates = new Set();

  for (let attempt = 1; attempt <= MAX_MANUAL_DEDUPE_ATTEMPTS; attempt += 1) {
    const fieldKeys = sourceFilter.recoveryFieldKeys(errors);
    if (!fieldKeys.size) break;
    const state = JSON.stringify({ fields: [...fieldKeys].sort(), slides: draft.slides });
    if (recoveryStates.has(state)) break;
    recoveryStates.add(state);

    const response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        { role: 'system', content: 'Anda melakukan targeted recovery source-backed. Jangan mengubah field non-target dan jangan mengarang fakta.' },
        { role: 'user', content: recoveryPrompt({ draft, bank, errors, fieldKeys }) }
      ],
      response_format: { type: 'json_object' }
    });

    let candidate;
    try { candidate = parseResponse(response); }
    catch (error) { errors = [`JSON manual duplicate recovery tidak valid: ${error.message}`]; continue; }

    const merged = sourceFilter.mergeRecoveryFields(draft, candidate, fieldKeys);
    const checked = sourceFilter.validateVerifiedContent(generated, { slides: merged.slides }, {
      contentService,
      format: options.contentFormat,
      manualTopic: options.requestedTopic || '',
      sources,
      autoSourceTopic: false
    });
    if (checked.errors.length) {
      errors = checked.errors;
      draft = merged;
      continue;
    }

    const duplicateErrors = manualCrossSlideDuplicateErrors(checked.content);
    if (duplicateErrors.length) {
      errors = duplicateErrors;
      draft = checked.content;
      continue;
    }

    const semanticReady = sourceFilter.pruneUnneededClaims(checked.content, options.contentFormat);
    const semanticErrors = await sourceFilter.auditClaimSemantics(openai, semanticReady, topic, options.contentFormat);
    if (!semanticErrors.length) return checked.content;
    errors = semanticErrors;
    draft = checked.content;
  }

  throw Object.assign(new Error(`Topik manual masih mengulang pembahasan antar-slide setelah targeted recovery: ${errors[0] || 'recovery gagal'}`), {
    status: 422,
    validationErrors: errors
  });
}

module.exports = {
  repairManualSourceDuplicates,
  manualCrossSlideDuplicateErrors,
  nearDuplicateCopy,
  MAX_MANUAL_DEDUPE_ATTEMPTS
};
