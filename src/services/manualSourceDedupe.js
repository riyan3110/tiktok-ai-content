const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');

const MAX_MANUAL_DEDUPE_ATTEMPTS = 3;
const MAX_MANUAL_ROLE_REPAIR_ATTEMPTS = 2;
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

const USER_ACTION_PATTERN = /^(?:(?:anda|kamu|pengguna)\s+)?(?:(?:perlu|harus|sebaiknya|bisa|dapat)\s+)?(?:cek|periksa|memeriksa|buka|membuka|pilih|memilih|aktifkan|mengaktifkan|nonaktifkan|menonaktifkan|hapus|menghapus|keluarkan|mengeluarkan|putuskan|memutuskan|cabut|mencabut|ubah|mengubah|ganti|mengganti|reset|atur|mengatur|tinjau|meninjau|verifikasi|memverifikasi|konfirmasi|mengonfirmasi|gunakan|menggunakan|hindari|pastikan|jangan|laporkan|melaporkan|blokir|memblokir|amankan|mengamankan|perbarui|memperbarui|update|keluar|logout|hentikan|menghentikan|batasi|membatasi|simpan|menyimpan|bandingkan|membandingkan|pindai|scan|ketuk|tap|lakukan|ikuti)\b/i;

function meaningfulTokens(value) {
  return [...new Set(normalize(value).split(' ').filter(token => (token.length > 2 || token === 'ai') && !COPY_STOPWORDS.has(token)))];
}

function copyOverlap(left, right) {
  const a = meaningfulTokens(left);
  const b = meaningfulTokens(right);
  if (!a.length || !b.length) return { shared: 0, ratio: 0, a, b };
  const shared = a.filter(token => b.includes(token)).length;
  return { shared, ratio: shared / Math.min(a.length, b.length), a, b };
}

function nearDuplicateCopy(left, right) {
  const leftNorm = normalize(left);
  const rightNorm = normalize(right);
  if (!leftNorm || !rightNorm) return false;
  if (leftNorm === rightNorm) return true;
  const overlap = copyOverlap(left, right);
  if (overlap.a.length < 4 || overlap.b.length < 4) return false;
  return overlap.shared >= 3 && overlap.ratio >= 0.85;
}

function sameCanonicalFact(left, right) {
  const leftKey = canonicalFactKey(left);
  const rightKey = canonicalFactKey(right);
  if (!leftKey || leftKey !== rightKey) return false;
  if (normalize(left.value) === normalize(right.value)) return true;
  const overlap = copyOverlap(left.value, right.value);
  return overlap.shared >= 2 && overlap.ratio >= 0.5;
}

function isSummaryEdgeSlide(slide, slideIndex, totalSlides) {
  const section = String(slide?.section || '').trim();
  if (slideIndex === 0 && /^(?:PEMBUKA|HOOK|INTRO)$/i.test(section)) return true;
  if (slideIndex === totalSlides - 1 && /^(?:PENUTUP|CTA|KESIMPULAN|RINGKASAN|HASIL\/PENUTUP)$/i.test(section)) return true;
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
  const previous = [];
  for (const record of substantiveFields(content)) {
    const duplicate = previous.some(item => item.slideIndex !== record.slideIndex
      && (sameCanonicalFact(item, record) || nearDuplicateCopy(item.value, record.value)));
    if (duplicate) errors.push(`${record.key}: pembahasan mengulang fakta slide sebelumnya.`);
    previous.push(record);
  }
  return [...new Set(errors)];
}

function looksLikeUserAction(value) {
  return USER_ACTION_PATTERN.test(String(value || '').trim());
}

function manualTutorialRoleErrors(content, format = 'Tutorial langkah') {
  if (String(format || '').toLocaleLowerCase('id-ID') !== 'tutorial langkah') return [];
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  const invalidSteps = [];
  let stepCount = 0;

  slides.forEach((slide, slideIndex) => {
    if (!/^LANGKAH\b/i.test(String(slide?.section || '').trim())) return;
    stepCount += 1;
    const visible = [slide?.title, slide?.body, ...(Array.isArray(slide?.points) ? slide.points : [])]
      .map(value => String(value || '').trim()).filter(Boolean);
    if (visible.some(looksLikeUserAction)) return;
    invalidSteps.push(slideIndex);
    errors.push(`slide:${slideIndex}:role: LANGKAH harus berisi tindakan konkret yang dilakukan pengguna, bukan tanda, risiko, kemampuan pelaku, atau mekanisme serangan.`);
  });

  const lastIndex = slides.length - 1;
  const lastSection = String(slides[lastIndex]?.section || '').trim();
  if (/HASIL/i.test(lastSection) && (stepCount === 0 || invalidSteps.length)) {
    errors.push(`slide:${lastIndex}:role: HASIL/PENUTUP tidak boleh disebut hasil ketika langkah sebelumnya bukan tindakan pengguna yang valid.`);
  }
  return errors;
}

function tutorialRoleAuditPrompt({ draft, bank }) {
  return `AUDIT PERAN FORMAT — Topik Manual + URL. Anda hanya mengaudit apakah struktur Tutorial langkah cocok dengan fakta sumber. Jangan menulis ulang konten.\n\nDEFINISI KETAT:\n- Slide LANGKAH valid hanya jika copy yang terlihat benar-benar meminta PENONTON/PENGGUNA melakukan tindakan konkret. Penjelasan tentang tanda bahaya, cara pelaku menyerang, kemampuan aplikasi, risiko, penyebab, atau mekanisme BUKAN langkah pengguna.\n- HASIL valid hanya jika menjelaskan outcome/konsekuensi setelah tindakan pada slide LANGKAH dan outcome itu didukung FACT_BANK. Peringatan umum, fakta lain, atau kalimat seperti “penting meningkatkan keamanan” bukan otomatis HASIL.\n- tutorialFit=true hanya jika FACT_BANK menyediakan minimal dua tindakan pengguna yang berbeda dan relevan yang bisa disusun sebagai urutan tutorial tanpa mengarang. Jika sumber hanya berisi tanda, risiko, metode serangan, fakta, atau konteks, tutorialFit=false.\n- Jangan menganggap tindakan PELAKU sebagai tindakan PENGGUNA.\n\nFACT_BANK:\n${JSON.stringify(bank)}\n\nSLIDES:\n${JSON.stringify(draft.slides)}\n\nKembalikan HANYA JSON:\n{"tutorialFit":true,"invalid":[{"slideIndex":1,"role":"LANGKAH","reason":"..."},{"slideIndex":3,"role":"HASIL","reason":"..."}]}`;
}

function parseRoleAudit(response) {
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Audit peran format tidak mengembalikan konten.');
  const parsed = JSON.parse(raw);
  const invalid = Array.isArray(parsed.invalid) ? parsed.invalid
    .map(item => ({
      slideIndex: Number(item?.slideIndex),
      role: String(item?.role || '').trim(),
      reason: String(item?.reason || '').trim()
    }))
    .filter(item => Number.isInteger(item.slideIndex) && item.slideIndex >= 0) : [];
  return { tutorialFit: parsed.tutorialFit === true, invalid };
}

async function auditTutorialRoles(openai, draft, bank, deterministicErrors = []) {
  try {
    const response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        { role: 'system', content: 'Anda auditor struktur tutorial source-backed. Bedakan tindakan pengguna dari deskripsi risiko atau tindakan pelaku.' },
        { role: 'user', content: tutorialRoleAuditPrompt({ draft, bank }) }
      ],
      response_format: { type: 'json_object' }
    });
    return parseRoleAudit(response);
  } catch (error) {
    const invalid = deterministicErrors.map(message => {
      const match = String(message).match(/slide:(\d+):role:/);
      return match ? { slideIndex: Number(match[1]), role: 'ROLE', reason: message } : null;
    }).filter(Boolean);
    return { tutorialFit: deterministicErrors.length === 0, invalid };
  }
}

function factFallbackSections(totalSlides) {
  const middle = ['FAKTA UTAMA', 'PENJELASAN', 'KONTEKS'];
  return Array.from({ length: totalSlides }, (_, index) => {
    if (index === 0) return 'PEMBUKA';
    if (index === totalSlides - 1) return 'KESIMPULAN';
    return middle[Math.min(index - 1, middle.length - 1)];
  });
}

function roleTargetIndexes(draft, audit, deterministicErrors) {
  const targets = new Set();
  deterministicErrors.forEach(error => {
    const match = String(error).match(/slide:(\d+):role:/);
    if (match) targets.add(Number(match[1]));
  });
  audit.invalid.forEach(item => targets.add(item.slideIndex));
  if (!audit.tutorialFit) {
    (draft.slides || []).forEach((_, index) => {
      if (index > 0) targets.add(index);
    });
  }
  return targets;
}

function roleRecoveryPrompt({ draft, bank, audit, targetIndexes }) {
  const targetList = [...targetIndexes].sort((a, b) => a - b);
  const fallbackSections = factFallbackSections(draft.slides.length);
  const modeRules = audit.tutorialFit
    ? `FACT_BANK dinilai cukup untuk tutorial. Pertahankan struktur LANGKAH pada slide target yang memang langkah, tetapi ubah isinya menjadi tindakan nyata yang dilakukan PENONTON/PENGGUNA dan benar-benar didukung source. Jangan menulis tindakan pelaku sebagai langkah. Jika slide HASIL tidak memiliki outcome yang benar-benar didukung source, ubah section slide itu menjadi PENUTUP dan tulis ringkasan source-backed yang relevan.`
    : `FACT_BANK TIDAK cukup untuk tutorial. DILARANG mengarang langkah. Ubah struktur menjadi fakta informatif dengan section PERSIS ${JSON.stringify(fallbackSections)}. Gunakan fakta sumber sebagai FAKTA UTAMA/PENJELASAN/KONTEKS dan akhiri KESIMPULAN yang merangkum fakta, bukan hasil palsu atau saran rekaan.`;
  return `PERBAIKAN PERAN FORMAT — Topik Manual + URL secara SOURCE-LOCKED.\n\nTARGET SLIDE YANG BOLEH DIUBAH: ${JSON.stringify(targetList)}\nAUDIT: ${JSON.stringify(audit)}\n\n${modeRules}\n\nATURAN WAJIB:\n- Jumlah slide dan urutan slide tidak boleh berubah.\n- Slide NON-TARGET harus dikembalikan persis; sistem akan menguncinya lagi.\n- Semua title/body/points target wajib Bahasa Indonesia natural, singkat, dan sesuai fungsi section.\n- Semua fakta substantif target harus mempunyai claim dengan field yang benar, sourceId, dan evidence PERSIS dari satu entri FACT_BANK yang sama.\n- Jangan memakai pengetahuan luar. Jangan mengarang langkah, hasil, manfaat, sebab-akibat, keamanan, atau rekomendasi.\n- Jika evidence hanya menjelaskan cara pelaku menyerang, tampilkan sebagai fakta/risiko, BUKAN instruksi LANGKAH.\n- Jika evidence hanya memberi tanda bahaya, tampilkan sebagai tanda/fakta, BUKAN HASIL.\n- Jangan memperkuat “dapat/mungkin/bisa” menjadi kepastian.\n- Hindari filler dan CTA generik sebagai pengganti fakta.\n\nFACT_BANK:\n${JSON.stringify(bank)}\n\nCURRENT_DRAFT:\n${JSON.stringify(draft.slides)}\n\nKembalikan HANYA JSON {"slides":[{"section":"...","title":"...","body":"...","points":[],"claims":[{"field":"slide:1:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}.`;
}

function parseResponse(response) {
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Manual source recovery tidak mengembalikan konten.');
  return JSON.parse(raw);
}

function mergeRoleSlides(draft, candidate, targetIndexes, tutorialFit) {
  if (!candidate || !Array.isArray(candidate.slides) || candidate.slides.length !== draft.slides.length) return candidate;
  const fallback = factFallbackSections(draft.slides.length);
  const slides = draft.slides.map((original, index) => {
    if (!targetIndexes.has(index)) return {
      ...original,
      points: Array.isArray(original?.points) ? [...original.points] : [],
      claims: Array.isArray(original?.claims) ? original.claims.map(claim => ({ ...claim })) : []
    };
    const incoming = candidate.slides[index] || original;
    let section = String(original?.section || '').trim();
    if (!tutorialFit) section = fallback[index];
    else if (/^LANGKAH\b/i.test(section)) section = String(original.section || '').trim();
    else if (index === draft.slides.length - 1 && /HASIL/i.test(section)) section = 'PENUTUP';
    return {
      ...incoming,
      section,
      title: String(incoming?.title || '').trim(),
      body: String(incoming?.body || '').trim(),
      points: Array.isArray(incoming?.points) ? incoming.points.map(point => String(point || '').trim()).filter(Boolean) : [],
      claims: Array.isArray(incoming?.claims) ? incoming.claims.map(claim => ({ ...claim })) : []
    };
  });
  return { ...candidate, slides };
}

function effectiveManualFormat(content, requestedFormat) {
  if (String(requestedFormat || '').toLocaleLowerCase('id-ID') !== 'tutorial langkah') return requestedFormat;
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const hasStep = slides.some(slide => /^LANGKAH\b/i.test(String(slide?.section || '').trim()));
  const isFactFallback = !hasStep && slides.length >= 4
    && /^PEMBUKA$/i.test(String(slides[0]?.section || '').trim())
    && /^KESIMPULAN$/i.test(String(slides.at(-1)?.section || '').trim());
  return isFactFallback ? 'Fakta singkat' : requestedFormat;
}

function rebaseSections(base, slides) {
  return {
    ...base,
    slides: (base.slides || []).map((slide, index) => ({
      ...slide,
      section: String(slides?.[index]?.section || slide?.section || '').trim()
    }))
  };
}

async function repairManualTutorialRoles({ contentService, generated, options, sources, bank, openai }) {
  if (String(options.contentFormat || '').toLocaleLowerCase('id-ID') !== 'tutorial langkah') return generated;

  let draft = generated;
  let deterministicErrors = manualTutorialRoleErrors(draft, options.contentFormat);
  let audit = await auditTutorialRoles(openai, draft, bank, deterministicErrors);
  if (!deterministicErrors.length && audit.tutorialFit && !audit.invalid.length) return generated;
  let lastErrors = [...deterministicErrors, ...audit.invalid.map(item => `slide:${item.slideIndex}:role: ${item.reason || `${item.role} tidak sesuai fungsi format.`}`)];

  for (let attempt = 1; attempt <= MAX_MANUAL_ROLE_REPAIR_ATTEMPTS; attempt += 1) {
    const targetIndexes = roleTargetIndexes(draft, audit, deterministicErrors);
    if (!targetIndexes.size) break;

    const response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        { role: 'system', content: 'Anda memperbaiki peran section carousel secara source-locked. Jangan mengarang langkah atau hasil.' },
        { role: 'user', content: roleRecoveryPrompt({ draft, bank, audit, targetIndexes }) }
      ],
      response_format: { type: 'json_object' }
    });

    let candidate;
    try { candidate = parseResponse(response); }
    catch (error) {
      lastErrors = [`JSON perbaikan peran format tidak valid: ${error.message}`];
      continue;
    }
    candidate = mergeRoleSlides(draft, candidate, targetIndexes, audit.tutorialFit);
    if (!candidate || !Array.isArray(candidate.slides) || candidate.slides.length !== draft.slides.length) {
      lastErrors = ['Perbaikan peran format mengubah jumlah slide.'];
      continue;
    }

    const validationFormat = audit.tutorialFit ? 'Tutorial langkah' : 'Fakta singkat';
    const baseForValidation = rebaseSections(draft, candidate.slides);
    const checked = sourceFilter.validateVerifiedContent(baseForValidation, { slides: candidate.slides }, {
      contentService,
      format: validationFormat,
      manualTopic: options.requestedTopic || '',
      sources,
      autoSourceTopic: false
    });
    if (checked.errors.length) {
      lastErrors = checked.errors;
      draft = { ...draft, slides: candidate.slides };
      continue;
    }

    const semanticReady = sourceFilter.pruneUnneededClaims(checked.content, validationFormat);
    const semanticErrors = await sourceFilter.auditClaimSemantics(openai, semanticReady, options.requestedTopic || generated?.topic || '', validationFormat);
    if (semanticErrors.length) {
      lastErrors = semanticErrors;
      draft = checked.content;
      continue;
    }

    if (!audit.tutorialFit) return checked.content;

    deterministicErrors = manualTutorialRoleErrors(checked.content, 'Tutorial langkah');
    const nextAudit = await auditTutorialRoles(openai, checked.content, bank, deterministicErrors);
    if (!deterministicErrors.length && nextAudit.tutorialFit && !nextAudit.invalid.length) return checked.content;
    audit = nextAudit;
    lastErrors = [...deterministicErrors, ...audit.invalid.map(item => `slide:${item.slideIndex}:role: ${item.reason || `${item.role} tidak sesuai fungsi format.`}`)];
    draft = checked.content;
  }

  throw Object.assign(new Error(`Topik manual tidak dapat diselaraskan dengan fungsi format tanpa mengarang: ${lastErrors[0] || 'peran slide tidak valid'}`), {
    status: 422,
    validationErrors: lastErrors
  });
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
  return `Anda memperbaiki carousel Topik Manual + URL secara SOURCE-LOCKED. Jangan memakai pengetahuan luar.\n\nTARGET FIELD YANG BOLEH BERUBAH:\n${JSON.stringify([...fieldKeys])}\n\nERROR:\n${errors.join('\n')}\n\nATURAN WAJIB:\n- Ubah HANYA target field. Semua field non-target, jumlah slide, urutan, section, dan title non-target harus tetap persis.\n- Error pengulangan berarti target field membahas fakta yang sudah dipakai slide sebelumnya. Ganti target dengan SATU fakta relevan lain dari FACT_BANK yang belum dipakai.\n- Fakta dianggap sama berdasarkan pasangan sourceId + evidence canonical DAN isi substantif yang sama, walaupun wording Indonesia berbeda. Jangan memparafrasekan fakta lama menjadi kalimat baru.\n- sourceId dan evidence harus disalin PERSIS dari pasangan FACT_BANK yang sama. Evidence tidak boleh diterjemahkan atau diedit.\n- Copy target wajib Bahasa Indonesia natural, singkat, dan setia pada evidence. Jangan menambah sebab-akibat, manfaat, angka, nama, tanggal, modalitas, atau kesimpulan yang tidak ada.\n- Jika target berupa point dan tidak ada fakta berbeda yang aman, point boleh dihapus beserta claim-nya.\n- Jika target berupa body, jangan ganti dengan filler/CTA seperti “baca selengkapnya”, “perhatikan konteks”, atau kalimat kosong; gunakan fakta substantif yang berbeda.\n- Jangan gunakan pasangan canonical berikut untuk mengulang fakta yang sudah dipakai field non-target: ${JSON.stringify(usedFacts)}. Satu evidence yang memuat dua klausa berbeda masih boleh dipakai bila target benar-benar membahas fakta berbeda, bukan parafrase fakta lama.\n\nFACT_BANK:\n${JSON.stringify(bank)}\n\nCURRENT_DRAFT:\n${JSON.stringify(draft.slides)}\n\nKembalikan HANYA JSON {"slides":[{"section":"...","title":"...","body":"...","points":[],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}.`;
}

async function repairManualSourceDuplicates({ contentService, generated, options = {}, sources = [], client }) {
  const requestedFormat = options.contentFormat || '';
  let draft = generated;
  let duplicateErrors = manualCrossSlideDuplicateErrors(draft);
  const needsRoleAudit = String(requestedFormat).toLocaleLowerCase('id-ID') === 'tutorial langkah';
  if (!needsRoleAudit && !duplicateErrors.length) return generated;

  const topic = options.requestedTopic || generated?.topic || '';
  const bank = sourceFilter.extractFactBank(sources, topic);
  if (!bank.length) return generated;
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });

  if (needsRoleAudit) {
    draft = await repairManualTutorialRoles({ contentService, generated: draft, options, sources, bank, openai });
    duplicateErrors = manualCrossSlideDuplicateErrors(draft);
  }
  if (!duplicateErrors.length) return draft;

  let errors = duplicateErrors;
  const recoveryStates = new Set();
  const duplicateBase = draft;
  const validationFormat = effectiveManualFormat(duplicateBase, requestedFormat);

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
    const baseForValidation = rebaseSections(duplicateBase, merged.slides);
    const checked = sourceFilter.validateVerifiedContent(baseForValidation, { slides: merged.slides }, {
      contentService,
      format: validationFormat,
      manualTopic: options.requestedTopic || '',
      sources,
      autoSourceTopic: false
    });
    if (checked.errors.length) {
      errors = checked.errors;
      draft = merged;
      continue;
    }

    const remainingDuplicateErrors = manualCrossSlideDuplicateErrors(checked.content);
    if (remainingDuplicateErrors.length) {
      errors = remainingDuplicateErrors;
      draft = checked.content;
      continue;
    }

    const semanticReady = sourceFilter.pruneUnneededClaims(checked.content, validationFormat);
    const semanticErrors = await sourceFilter.auditClaimSemantics(openai, semanticReady, topic, validationFormat);
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
  manualTutorialRoleErrors,
  looksLikeUserAction,
  nearDuplicateCopy,
  effectiveManualFormat,
  MAX_MANUAL_DEDUPE_ATTEMPTS,
  MAX_MANUAL_ROLE_REPAIR_ATTEMPTS
};
