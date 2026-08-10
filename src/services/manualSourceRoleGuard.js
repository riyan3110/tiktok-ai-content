const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const manualSourceDedupe = require('./manualSourceDedupe');

const MAX_ROLE_AUDIT_ATTEMPTS = 2;
const MAX_ROLE_REPAIR_ATTEMPTS = 3;
const ROLE_FORMATS = new Set(['tutorial langkah', 'masalah dan solusi']);
const ACTION_VERB_PATTERN = /\b(?:cek|periksa|memeriksa|buka|membuka|pilih|memilih|aktifkan|mengaktifkan|nonaktifkan|menonaktifkan|hapus|menghapus|keluarkan|mengeluarkan|putuskan|memutuskan|cabut|mencabut|ubah|mengubah|ganti|mengganti|reset|atur|mengatur|tinjau|meninjau|verifikasi|memverifikasi|konfirmasi|mengonfirmasi|gunakan|menggunakan|hindari|pastikan|jangan|laporkan|melaporkan|blokir|memblokir|amankan|mengamankan|perbarui|memperbarui|update|keluar|logout|hentikan|menghentikan|batasi|membatasi|simpan|menyimpan|bandingkan|membandingkan|pindai|scan|ketuk|tap|lakukan|ikuti)\b/i;
const NON_USER_ACTOR_PATTERN = /\b(?:pelaku|penyerang|hacker|peretas|malware|spyware|aplikasi pihak ketiga|orang lain)\b/i;
const GENERIC_CLOSING_PATTERN = /\b(?:dengan langkah sederhana|dengan langkah mudah|tetap aman|bebas berinteraksi|pentingnya keamanan|lebih aman dan nyaman|jaga keamanan akun)\b/i;

function normalizedFormat(value) {
  return String(value || '').trim().toLocaleLowerCase('id-ID');
}

function words(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean);
}

function visibleBodyCopy(slide) {
  return [slide?.body, ...(Array.isArray(slide?.points) ? slide.points : [])]
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function visibleBodyWordCount(slide) {
  return visibleBodyCopy(slide).reduce((sum, value) => sum + words(value).length, 0);
}

function looksLikeUserAction(value) {
  const text = String(value || '').trim();
  const verb = text.match(ACTION_VERB_PATTERN);
  if (!verb) return false;
  const beforeVerb = text.slice(0, verb.index || 0);
  if (NON_USER_ACTOR_PATTERN.test(beforeVerb)) return false;
  return true;
}

function factFallbackSections(totalSlides) {
  const middle = ['FAKTA UTAMA', 'PENJELASAN', 'KONTEKS'];
  return Array.from({ length: totalSlides }, (_, index) => {
    if (index === 0) return 'PEMBUKA';
    if (index === totalSlides - 1) return 'KESIMPULAN';
    return middle[Math.min(index - 1, middle.length - 1)];
  });
}

function isFactFallback(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  if (slides.length < 4) return false;
  if (!/^PEMBUKA$/i.test(String(slides[0]?.section || '').trim())) return false;
  if (!/^KESIMPULAN$/i.test(String(slides.at(-1)?.section || '').trim())) return false;
  return slides.slice(1, -1).every(slide => /^(?:FAKTA UTAMA|PENJELASAN|KONTEKS)$/i.test(String(slide?.section || '').trim()));
}

function effectiveManualFormat(content, requestedFormat) {
  const format = normalizedFormat(requestedFormat);
  if (ROLE_FORMATS.has(format) && isFactFallback(content)) return 'Fakta singkat';
  return content?.effectiveContentFormat || requestedFormat;
}

function distinctBank(bank = []) {
  const seen = new Set();
  return bank.filter(fact => {
    const key = `${String(fact?.sourceId || '').trim()}::${String(fact?.evidence || '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ')}`;
    if (!String(fact?.evidence || '').trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function claimKey(claim) {
  const sourceId = String(claim?.sourceId || '').trim();
  const evidence = String(claim?.evidence || '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
  return sourceId && evidence ? `${sourceId}::${evidence}` : '';
}

function usedFactKeys(content) {
  const keys = new Set();
  for (const slide of Array.isArray(content?.slides) ? content.slides : []) {
    for (const claim of Array.isArray(slide?.claims) ? slide.claims : []) {
      const key = claimKey(claim);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function deterministicRoleErrors(content, format) {
  const normalized = normalizedFormat(format);
  if (!ROLE_FORMATS.has(normalized) || isFactFallback(content)) return [];
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  const actionSections = normalized === 'tutorial langkah' ? /^LANGKAH\b/i : /^SOLUSI$/i;
  const roleName = normalized === 'tutorial langkah' ? 'LANGKAH' : 'SOLUSI';
  const actionIndexes = [];
  let invalidActions = 0;

  slides.forEach((slide, slideIndex) => {
    if (!actionSections.test(String(slide?.section || '').trim())) return;
    actionIndexes.push(slideIndex);
    if (visibleBodyCopy(slide).some(looksLikeUserAction)) return;
    invalidActions += 1;
    errors.push(`slide:${slideIndex}:role: ${roleName} harus berisi tindakan konkret yang dilakukan pengguna; judul aksi saja tidak cukup jika body/points hanya menjelaskan tanda, risiko, mekanisme, fitur, atau konteks.`);
  });

  if (normalized === 'masalah dan solusi') {
    const problemIndexes = slides.map((slide, index) => /^MASALAH$/i.test(String(slide?.section || '').trim()) ? index : -1).filter(index => index >= 0);
    if (!problemIndexes.length) {
      const target = Math.min(1, Math.max(0, slides.length - 1));
      errors.push(`slide:${target}:role: format Masalah dan solusi wajib memiliki slide MASALAH yang didukung sumber.`);
    }
    if (actionIndexes.length < 2) {
      const candidate = slides.findIndex((slide, index) => index > 0 && index < slides.length - 1
        && !/^(?:MASALAH|SOLUSI)$/i.test(String(slide?.section || '').trim()));
      errors.push(`slide:${candidate >= 0 ? candidate : Math.max(1, slides.length - 2)}:role: format Masalah dan solusi membutuhkan minimal dua SOLUSI berbeda yang benar-benar berupa tindakan pengguna; jangan mengganti solusi dengan PENYEBAB atau fitur.`);
    }
  } else if (actionIndexes.length < 2) {
    const candidate = slides.findIndex((slide, index) => index > 0 && index < slides.length - 1 && !/^LANGKAH\b/i.test(String(slide?.section || '').trim()));
    errors.push(`slide:${candidate >= 0 ? candidate : Math.max(1, slides.length - 2)}:role: Tutorial langkah membutuhkan minimal dua slide LANGKAH yang benar-benar berisi tindakan pengguna.`);
  }

  const lastIndex = slides.length - 1;
  const lastSection = String(slides[lastIndex]?.section || '').trim();
  if (/^HASIL(?:\/PENUTUP)?$/i.test(lastSection) && (actionIndexes.length < 2 || invalidActions > 0)) {
    errors.push(`slide:${lastIndex}:role: HASIL tidak boleh dipakai ketika tindakan pengguna sebelumnya belum valid.`);
  }
  return [...new Set(errors)];
}

function densityMinimum(index, totalSlides, bankSize) {
  if (bankSize < 3) return 0;
  const rich = bankSize >= Math.max(5, totalSlides);
  if (index === 0) return rich ? 18 : 12;
  if (index === totalSlides - 1) return rich ? 14 : 10;
  return rich ? 18 : 14;
}

function contentDensityErrors(content, bank = []) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const uniqueBank = distinctBank(bank);
  if (uniqueBank.length < 3) return [];
  const errors = [];
  slides.forEach((slide, index) => {
    const count = visibleBodyWordCount(slide);
    const minimum = densityMinimum(index, slides.length, uniqueBank.length);
    if (count < minimum) {
      errors.push(`slide:${index}:density: isi terlalu tipis (${count} kata); sumber masih cukup kaya, targetkan minimal ${minimum} kata substantif pada body/points tanpa filler.`);
    }
    const section = String(slide?.section || '').trim();
    if (/^(?:SOLUSI|LANGKAH\b|TIPS?)/i.test(section) && count >= minimum && !visibleBodyCopy(slide).some(looksLikeUserAction)) {
      errors.push(`slide:${index}:density: slide tindakan cukup panjang tetapi belum berisi aksi pengguna yang nyata.`);
    }
    if (index === slides.length - 1 && GENERIC_CLOSING_PATTERN.test(visibleBodyCopy(slide).join(' '))) {
      const hasClaims = Array.isArray(slide?.claims) && slide.claims.some(claim => claimKey(claim));
      if (!hasClaims) errors.push(`slide:${index}:density: penutup masih generik dan tidak membawa fakta atau outcome source-backed.`);
    }
  });

  const used = usedFactKeys(content);
  const required = uniqueBank.length >= slides.length
    ? Math.max(3, slides.length - 1)
    : Math.min(uniqueBank.length, Math.max(2, slides.length - 2));
  if (used.size < required) {
    errors.push(`coverage:density: hanya ${used.size} fakta canonical dipakai dari sumber; gunakan minimal ${required} fakta berbeda selama masih relevan dan tidak berulang.`);
  }
  return [...new Set(errors)];
}

function auditPrompt({ draft, bank, format }) {
  const normalized = normalizedFormat(format);
  const rules = normalized === 'tutorial langkah'
    ? `- Struktur harus memiliki minimal dua slide LANGKAH.\n- LANGKAH valid hanya jika body/points benar-benar berisi tindakan yang dilakukan penonton/pengguna dan tindakan itu didukung evidence. Judul berbentuk kata kerja tidak cukup.\n- Tindakan pelaku, tanda bahaya, risiko, kemampuan aplikasi, atau mekanisme serangan BUKAN LANGKAH pengguna.\n- formatFit=true hanya jika FACT_BANK menyediakan minimal dua tindakan pengguna berbeda tanpa mengarang.\n- HASIL valid hanya jika outcome setelah tindakan tersebut memang didukung FACT_BANK. Jika tidak ada outcome, tandai HASIL invalid agar dapat menjadi PENUTUP.`
    : `- Struktur harus memiliki satu MASALAH dan minimal dua slide SOLUSI; INTRO/PEMBUKA dan PENUTUP boleh ada sebagai tambahan.\n- MASALAH harus benar-benar berupa masalah, tanda, gejala, risiko, atau kondisi yang didukung FACT_BANK.\n- SOLUSI valid hanya jika body/points benar-benar berisi tindakan konkret yang dilakukan pengguna DAN evidence mendukung tindakan itu. Informasi fitur, mekanisme, PENYEBAB, atau kemampuan produk bukan SOLUSI kecuali evidence memang memerintahkan tindakan pengguna.\n- Title, body, points, claim.text, dan evidence pada SOLUSI harus membahas tindakan yang sama.\n- formatFit=true hanya jika FACT_BANK menyediakan masalah relevan dan minimal dua tindakan pengguna berbeda tanpa mengarang.\n- HASIL valid hanya jika outcome dari solusi sebelumnya benar-benar didukung FACT_BANK. Kalimat umum seperti “pentingnya keamanan” bukan HASIL.`;
  return `AUDIT PERAN FORMAT — Manual + URL. Jangan menulis ulang konten.\n\nFORMAT: ${format}\n\nATURAN:\n${rules}\n- Audit MAKNA, bukan hanya kata kerja. Periksa hubungan title ↔ body/points ↔ claim/evidence.\n- Semua penilaian hanya dari FACT_BANK. Jangan gunakan pengetahuan luar.\n\nFACT_BANK:\n${JSON.stringify(bank)}\n\nSLIDES:\n${JSON.stringify(draft.slides)}\n\nKembalikan HANYA JSON dengan KEDUA field wajib: {"formatFit":true,"invalid":[{"slideIndex":1,"role":"SOLUSI","reason":"..."}]}. Field invalid WAJIB selalu berupa array, termasuk saat kosong.`;
}

function parseAudit(response) {
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Audit peran format tidak mengembalikan konten.');
  const parsed = JSON.parse(raw);
  if (typeof parsed?.formatFit !== 'boolean') throw new Error('Audit peran format tidak memiliki formatFit boolean.');
  if (!Array.isArray(parsed?.invalid)) throw new Error('Audit peran format wajib memiliki invalid array.');
  const invalid = parsed.invalid.map(item => ({
    slideIndex: Number(item?.slideIndex),
    role: String(item?.role || '').trim(),
    reason: String(item?.reason || '').trim()
  })).filter(item => Number.isInteger(item.slideIndex) && item.slideIndex >= 0);
  return { formatFit: parsed.formatFit, invalid };
}

async function auditRoles(openai, draft, bank, format) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ROLE_AUDIT_ATTEMPTS; attempt += 1) {
    try {
      const response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          { role: 'system', content: 'Anda auditor peran struktur carousel source-backed. Nilai isi, fungsi section, dan evidence secara ketat.' },
          { role: 'user', content: auditPrompt({ draft, bank, format }) }
        ],
        response_format: { type: 'json_object' }
      });
      return parseAudit(response);
    } catch (error) {
      lastError = error;
    }
  }
  throw Object.assign(new Error(`Audit peran format gagal; konten tidak boleh dianggap valid tanpa audit: ${lastError?.message || 'provider gagal'}`), { status: 422 });
}

function indexesFromErrors(errors = []) {
  const targets = new Set();
  errors.forEach(error => {
    const match = String(error).match(/slide:(\d+):/);
    if (match) targets.add(Number(match[1]));
  });
  return targets;
}

function coverageTargets(draft, bank, count = 1) {
  const slides = Array.isArray(draft?.slides) ? draft.slides : [];
  const candidates = slides.map((slide, index) => ({ index, words: visibleBodyWordCount(slide) }))
    .filter(item => item.index > 0 && item.index < slides.length - 1)
    .sort((a, b) => a.words - b.words || b.index - a.index);
  if (!candidates.length && slides.length) candidates.push({ index: slides.length - 1, words: visibleBodyWordCount(slides.at(-1)) });
  return candidates.slice(0, Math.max(1, Math.min(count, candidates.length))).map(item => item.index);
}

function targetIndexes(draft, audit, errors, bank) {
  if (audit && audit.formatFit === false) return new Set((draft.slides || []).map((_, index) => index));
  const targets = indexesFromErrors(errors);
  const coverage = errors.find(error => String(error).startsWith('coverage:density:'));
  if (coverage) {
    const match = String(coverage).match(/hanya\s+(\d+).*minimal\s+(\d+)/i);
    const missing = match ? Math.max(1, Number(match[2]) - Number(match[1])) : 1;
    coverageTargets(draft, bank, missing).forEach(index => targets.add(index));
  }
  if (audit) audit.invalid.forEach(item => targets.add(item.slideIndex));
  return targets;
}

function usedFactsOutsideTargets(draft, targets) {
  const used = [];
  (draft.slides || []).forEach((slide, index) => {
    if (targets.has(index)) return;
    (Array.isArray(slide?.claims) ? slide.claims : []).forEach(claim => {
      const sourceId = String(claim?.sourceId || '').trim();
      const evidence = String(claim?.evidence || '').trim();
      if (!sourceId || !evidence) return;
      const key = `${sourceId}::${evidence.toLocaleLowerCase('id-ID').replace(/\s+/g, ' ')}`;
      if (!used.some(item => item.key === key)) used.push({ key, sourceId, evidence });
    });
  });
  return used.map(({ sourceId, evidence }) => ({ sourceId, evidence }));
}

function recoveryPrompt({ draft, bank, format, audit, targets, errors }) {
  const targetList = [...targets].sort((a, b) => a - b);
  const fallback = factFallbackSections(draft.slides.length);
  const normalized = normalizedFormat(format);
  const sourceRich = distinctBank(bank).length >= Math.max(5, draft.slides.length);
  const usedOutside = usedFactsOutsideTargets(draft, targets);
  let modeRule = 'Pertahankan fungsi section yang sudah benar.';
  if (audit && audit.formatFit === false) {
    modeRule = `FACT_BANK tidak cukup untuk mempertahankan format ${format}. DILARANG mengarang. Ubah menjadi struktur fakta PERSIS ${JSON.stringify(fallback)}.`;
  } else if (normalized === 'masalah dan solusi') {
    modeRule = 'Pertahankan MASALAH/SOLUSI yang valid. Target SOLUSI harus menjadi tindakan pengguna yang konkret dan source-backed; title dan body/points wajib membahas tindakan yang sama. Jika target HASIL tidak punya outcome source-backed, ubah hanya menjadi PENUTUP.';
  } else if (normalized === 'tutorial langkah') {
    modeRule = 'Pertahankan LANGKAH yang valid. Target LANGKAH wajib berisi tindakan pengguna yang konkret dan source-backed. Jika target HASIL tidak punya outcome source-backed, ubah hanya menjadi PENUTUP.';
  }
  const densityRule = sourceRich
    ? 'Sumber kaya: pada setiap slide TARGET, isi body/points harus terasa penuh tetapi tetap ringkas: targetkan sekitar 18–32 kata substantif total. Gunakan body 12–22 kata dan, bila ada fakta pendukung berbeda, 1–2 points masing-masing 3–7 kata. Jangan memenuhi ruang dengan filler.'
    : 'Isi slide TARGET secukupnya berdasarkan fakta yang tersedia; jangan memaksa panjang jika source memang terbatas.';
  return `PERBAIKAN FINAL QUALITY — Manual + URL secara SOURCE-LOCKED.\n\nFORMAT: ${format}\nTARGET SLIDE: ${JSON.stringify(targetList)}\nERROR YANG HARUS DITUNTASKAN:\n${errors.join('\n')}\nAUDIT ROLE: ${JSON.stringify(audit || { formatFit: true, invalid: [] })}\n\n${modeRule}\n${densityRule}\n\nATURAN WAJIB:\n- Jumlah dan urutan slide tidak boleh berubah.\n- Slide NON-TARGET harus tetap persis.\n- Gunakan fakta canonical yang BELUM dipakai slide non-target terlebih dahulu. Fakta non-target yang sudah dipakai: ${JSON.stringify(usedOutside)}.\n- Jangan memparafrase fakta lama lalu menganggapnya fakta baru. Hindari duplicate antar-slide.\n- Semua copy target wajib Bahasa Indonesia natural dan informatif.\n- Semua fakta/tindakan substantif target wajib punya claim dengan field yang benar, sourceId, dan evidence PERSIS dari FACT_BANK yang sama. Jika title membuat klaim faktual spesifik (termasuk hasil/manfaat/keamanan), title juga wajib punya claim field slide:X:title.\n- Body maksimal 24 kata. Points maksimal 3, masing-masing 3–7 kata. Title maksimal 12 kata.\n- Jangan memakai pengetahuan luar. Jangan mengarang tindakan, manfaat, hasil, sebab-akibat, keamanan, atau rekomendasi.\n- Informasi fitur atau kemampuan produk tidak boleh disamarkan menjadi SOLUSI/LANGKAH kecuali evidence benar-benar mendukung tindakan pengguna.\n- Jangan membuat klaim “aman”, “pasti”, “mencegah”, “melindungi”, atau outcome lain jika evidence tidak menyatakannya.\n- Jangan mengubah “dapat/mungkin/bisa” menjadi kepastian.\n\nFACT_BANK:\n${JSON.stringify(bank)}\n\nCURRENT_DRAFT:\n${JSON.stringify(draft.slides)}\n\nKembalikan HANYA JSON {"slides":[{"section":"...","title":"...","body":"...","points":[],"claims":[{"field":"slide:1:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}.`;
}

function parseResponse(response) {
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Final quality recovery tidak mengembalikan konten.');
  return JSON.parse(raw);
}

function mergeTargetSlides(draft, candidate, targets, audit) {
  if (!candidate || !Array.isArray(candidate.slides) || candidate.slides.length !== draft.slides.length) return null;
  const fallback = factFallbackSections(draft.slides.length);
  return {
    ...draft,
    slides: draft.slides.map((original, index) => {
      if (!targets.has(index)) return {
        ...original,
        points: Array.isArray(original?.points) ? [...original.points] : [],
        claims: Array.isArray(original?.claims) ? original.claims.map(claim => ({ ...claim })) : []
      };
      const incoming = candidate.slides[index] || original;
      let section = String(original?.section || '').trim();
      if (audit && audit.formatFit === false) section = fallback[index];
      else if (index === draft.slides.length - 1 && /^HASIL(?:\/PENUTUP)?$/i.test(section)
        && /^PENUTUP$/i.test(String(incoming?.section || '').trim())) section = 'PENUTUP';
      else if (/^(?:PENYEBAB|KONTEKS|PENJELASAN)$/i.test(section)
        && /^SOLUSI$/i.test(String(incoming?.section || '').trim())) section = 'SOLUSI';
      else if (/^(?:INTRO|PEMBUKA|PENYEBAB|KONTEKS|PENJELASAN)$/i.test(section)
        && /^MASALAH$/i.test(String(incoming?.section || '').trim())) section = 'MASALAH';
      else if (/^(?:PENYEBAB|KONTEKS|PENJELASAN)$/i.test(section)
        && /^LANGKAH\b/i.test(String(incoming?.section || '').trim())) section = String(incoming.section).trim();
      else if (!section && incoming?.section) section = String(incoming.section).trim();
      return {
        ...original,
        ...incoming,
        section,
        title: String(incoming?.title || '').trim(),
        body: String(incoming?.body || '').trim(),
        points: Array.isArray(incoming?.points) ? incoming.points.map(point => String(point || '').trim()).filter(Boolean) : [],
        claims: Array.isArray(incoming?.claims) ? incoming.claims.map(claim => ({ ...claim })) : []
      };
    })
  };
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

async function validateFinal({ contentService, draft, options, sources, openai, format }) {
  const base = rebaseSections(draft, draft.slides);
  const checked = sourceFilter.validateVerifiedContent(base, { slides: draft.slides }, {
    contentService,
    format,
    manualTopic: options.requestedTopic || '',
    sources,
    autoSourceTopic: false
  });
  if (checked.errors.length) return { content: checked.content || draft, errors: checked.errors };
  const semanticErrors = await sourceFilter.auditClaimSemantics(openai, checked.content, options.requestedTopic || draft?.topic || '', format);
  return { content: checked.content, errors: semanticErrors };
}

async function repairManualSourceRoles({ contentService, generated, options = {}, sources = [], client }) {
  const requestedFormat = options.contentFormat || '';
  const topic = options.requestedTopic || generated?.topic || '';
  const bank = distinctBank(sourceFilter.extractFactBank(sources, topic));
  if (!bank.length) return generated;
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });

  let draft = generated;
  let lastErrors = [];

  for (let attempt = 0; attempt <= MAX_ROLE_REPAIR_ATTEMPTS; attempt += 1) {
    const effectiveFormat = effectiveManualFormat(draft, requestedFormat);
    const isRoleFormat = ROLE_FORMATS.has(normalizedFormat(requestedFormat)) && normalizedFormat(effectiveFormat) !== 'fakta singkat';
    const roleErrors = isRoleFormat ? deterministicRoleErrors(draft, requestedFormat) : [];
    const audit = isRoleFormat ? await auditRoles(openai, draft, bank, requestedFormat) : { formatFit: true, invalid: [] };
    const densityErrors = contentDensityErrors(draft, bank);
    const duplicateErrors = manualSourceDedupe.manualCrossSlideDuplicateErrors(draft);
    const auditErrors = audit.invalid.map(item => `slide:${item.slideIndex}:role: ${item.reason || `${item.role} tidak sesuai fungsi format.`}`);

    let validationErrors = [];
    let validatedContent = draft;
    if (!roleErrors.length && audit.formatFit && !auditErrors.length && !densityErrors.length && !duplicateErrors.length) {
      const validated = await validateFinal({ contentService, draft, options, sources, openai, format: effectiveFormat });
      validatedContent = validated.content;
      validationErrors = validated.errors;
      if (!validationErrors.length) {
        return normalizedFormat(effectiveFormat) === 'fakta singkat' && normalizedFormat(requestedFormat) !== 'fakta singkat'
          ? { ...validatedContent, effectiveContentFormat: 'Fakta singkat' }
          : validatedContent;
      }
    }

    lastErrors = [...roleErrors, ...auditErrors, ...densityErrors, ...duplicateErrors, ...validationErrors];
    if (attempt === MAX_ROLE_REPAIR_ATTEMPTS) break;

    const targets = targetIndexes(draft, audit, lastErrors, bank);
    if (!targets.size) break;
    const response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        { role: 'system', content: 'Anda melakukan final quality recovery untuk carousel Manual + URL. Semua perubahan harus source-backed dan hanya pada target.' },
        { role: 'user', content: recoveryPrompt({ draft, bank, format: requestedFormat, audit, targets, errors: lastErrors }) }
      ],
      response_format: { type: 'json_object' }
    });

    let parsed;
    try { parsed = parseResponse(response); }
    catch (error) { lastErrors = [`JSON final quality recovery tidak valid: ${error.message}`]; continue; }
    const candidate = mergeTargetSlides(draft, parsed, targets, audit);
    if (!candidate) { lastErrors = ['Final quality recovery mengubah jumlah slide.']; continue; }
    draft = candidate;
  }

  throw Object.assign(new Error(`Topik manual + URL belum lolos final quality gate tanpa mengarang: ${lastErrors[0] || 'kualitas konten tidak valid'}`), {
    status: 422,
    validationErrors: lastErrors
  });
}

module.exports = {
  repairManualSourceRoles,
  deterministicRoleErrors,
  contentDensityErrors,
  looksLikeUserAction,
  effectiveManualFormat,
  auditRoles,
  MAX_ROLE_AUDIT_ATTEMPTS,
  MAX_ROLE_REPAIR_ATTEMPTS
};
