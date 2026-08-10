const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const manualSourceDedupe = require('./manualSourceDedupe');

const MAX_ROLE_AUDIT_ATTEMPTS = 2;
const MAX_ROLE_REPAIR_ATTEMPTS = 2;
const ROLE_FORMATS = new Set(['tutorial langkah', 'masalah dan solusi']);
const USER_ACTION_PATTERN = /^(?:(?:anda|kamu|pengguna)\s+)?(?:(?:perlu|harus|sebaiknya|bisa|dapat)\s+)?(?:cek|periksa|memeriksa|buka|membuka|pilih|memilih|aktifkan|mengaktifkan|nonaktifkan|menonaktifkan|hapus|menghapus|keluarkan|mengeluarkan|putuskan|memutuskan|cabut|mencabut|ubah|mengubah|ganti|mengganti|reset|atur|mengatur|tinjau|meninjau|verifikasi|memverifikasi|konfirmasi|mengonfirmasi|gunakan|menggunakan|hindari|pastikan|jangan|laporkan|melaporkan|blokir|memblokir|amankan|mengamankan|perbarui|memperbarui|update|keluar|logout|hentikan|menghentikan|batasi|membatasi|simpan|menyimpan|bandingkan|membandingkan|pindai|scan|ketuk|tap|lakukan|ikuti)\b/i;

function normalizedFormat(value) {
  return String(value || '').trim().toLocaleLowerCase('id-ID');
}

function visibleActionCopy(slide) {
  return [slide?.body, ...(Array.isArray(slide?.points) ? slide.points : [])]
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function looksLikeUserAction(value) {
  return USER_ACTION_PATTERN.test(String(value || '').trim());
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
  return requestedFormat;
}

function deterministicRoleErrors(content, format) {
  const normalized = normalizedFormat(format);
  if (!ROLE_FORMATS.has(normalized)) return [];
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  const actionSections = normalized === 'tutorial langkah' ? /^LANGKAH\b/i : /^SOLUSI$/i;
  const roleName = normalized === 'tutorial langkah' ? 'LANGKAH' : 'SOLUSI';
  let actionCount = 0;
  let invalidActions = 0;

  slides.forEach((slide, slideIndex) => {
    if (!actionSections.test(String(slide?.section || '').trim())) return;
    actionCount += 1;
    if (visibleActionCopy(slide).some(looksLikeUserAction)) return;
    invalidActions += 1;
    errors.push(`slide:${slideIndex}:role: ${roleName} harus berisi tindakan konkret yang dilakukan pengguna; judul aksi saja tidak cukup jika body/points hanya menjelaskan tanda, risiko, mekanisme, atau konteks.`);
  });

  const lastIndex = slides.length - 1;
  const lastSection = String(slides[lastIndex]?.section || '').trim();
  if (/^HASIL(?:\/PENUTUP)?$/i.test(lastSection) && (actionCount === 0 || invalidActions > 0)) {
    errors.push(`slide:${lastIndex}:role: HASIL tidak boleh dipakai ketika tindakan pengguna sebelumnya belum valid.`);
  }
  return errors;
}

function auditPrompt({ draft, bank, format }) {
  const normalized = normalizedFormat(format);
  const rules = normalized === 'tutorial langkah'
    ? `- LANGKAH valid hanya jika body/points benar-benar berisi tindakan yang dilakukan penonton/pengguna dan tindakan itu didukung evidence. Judul berbentuk kata kerja tidak cukup.\n- Tindakan pelaku, tanda bahaya, risiko, kemampuan aplikasi, atau mekanisme serangan BUKAN LANGKAH pengguna.\n- formatFit=true hanya jika FACT_BANK menyediakan tindakan pengguna berbeda yang cukup untuk slide LANGKAH yang ada, tanpa mengarang.\n- HASIL valid hanya jika outcome setelah tindakan tersebut memang dinyatakan/didukung FACT_BANK. Jika tidak ada outcome, tandai slide HASIL invalid agar dapat diturunkan menjadi PENUTUP.`
    : `- MASALAH harus benar-benar berupa masalah, tanda, gejala, risiko, atau kondisi yang didukung FACT_BANK; jangan menjadikannya saran generik.\n- SOLUSI valid hanya jika body/points benar-benar berisi tindakan konkret yang dilakukan penonton/pengguna DAN evidence mendukung tindakan itu. Judul seperti “Batasi akses” tidak membuat slide valid bila body justru membahas OTP atau fakta lain.\n- Title, body, points, claim.text, dan evidence pada SOLUSI harus membahas tindakan yang sama; jangan memasangkan judul solusi dengan body/evidence yang tidak nyambung.\n- formatFit=true hanya jika FACT_BANK menyediakan masalah yang relevan dan tindakan pengguna berbeda yang cukup untuk seluruh slide SOLUSI yang ada, tanpa mengarang.\n- HASIL valid hanya jika outcome dari solusi sebelumnya benar-benar didukung FACT_BANK. Kalimat umum seperti “pentingnya keamanan” atau konteks produk BUKAN HASIL. Jika outcome tidak tersedia, tandai HASIL invalid agar dapat menjadi PENUTUP.`;
  return `AUDIT PERAN FORMAT — Manual + URL. Jangan menulis ulang konten.\n\nFORMAT: ${format}\n\nATURAN:\n${rules}\n- Audit MAKNA, bukan hanya kata kerja. Periksa hubungan title ↔ body/points ↔ claim/evidence.\n- Semua penilaian hanya dari FACT_BANK. Jangan gunakan pengetahuan luar.\n\nFACT_BANK:\n${JSON.stringify(bank)}\n\nSLIDES:\n${JSON.stringify(draft.slides)}\n\nKembalikan HANYA JSON {"formatFit":true,"invalid":[{"slideIndex":1,"role":"SOLUSI","reason":"..."}]}.`;
}

function parseAudit(response) {
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Audit peran format tidak mengembalikan konten.');
  const parsed = JSON.parse(raw);
  if (typeof parsed?.formatFit !== 'boolean') throw new Error('Audit peran format tidak memiliki formatFit boolean.');
  const invalid = Array.isArray(parsed.invalid) ? parsed.invalid.map(item => ({
    slideIndex: Number(item?.slideIndex),
    role: String(item?.role || '').trim(),
    reason: String(item?.reason || '').trim()
  })).filter(item => Number.isInteger(item.slideIndex) && item.slideIndex >= 0) : [];
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

function targetIndexes(draft, audit, deterministicErrors) {
  if (!audit.formatFit) return new Set((draft.slides || []).map((_, index) => index));
  const targets = new Set(audit.invalid.map(item => item.slideIndex));
  deterministicErrors.forEach(error => {
    const match = String(error).match(/slide:(\d+):role:/);
    if (match) targets.add(Number(match[1]));
  });
  return targets;
}

function recoveryPrompt({ draft, bank, format, audit, targets }) {
  const normalized = normalizedFormat(format);
  const targetList = [...targets].sort((a, b) => a - b);
  const fallback = factFallbackSections(draft.slides.length);
  let modeRule;
  if (!audit.formatFit) {
    modeRule = `FACT_BANK tidak cukup untuk mempertahankan format ${format}. DILARANG mengarang masalah, langkah, solusi, atau hasil. Ubah menjadi struktur fakta PERSIS ${JSON.stringify(fallback)}.`;
  } else if (normalized === 'masalah dan solusi') {
    modeRule = `Pertahankan MASALAH/SOLUSI yang valid. Untuk target SOLUSI, tulis tindakan konkret yang benar-benar dilakukan pengguna dan didukung FACT_BANK; title dan body/points harus membahas tindakan yang sama. Jika target HASIL tidak memiliki outcome source-backed, ubah section hanya menjadi PENUTUP dan gunakan ringkasan fakta yang relevan, bukan hasil palsu.`;
  } else {
    modeRule = `Pertahankan LANGKAH yang valid. Untuk target LANGKAH, tulis tindakan pengguna yang benar-benar didukung FACT_BANK. Jika target HASIL tidak memiliki outcome source-backed, ubah section hanya menjadi PENUTUP dan gunakan ringkasan source-backed.`;
  }
  return `PERBAIKAN ROLE FORMAT — Manual + URL secara SOURCE-LOCKED.\n\nFORMAT: ${format}\nTARGET SLIDE: ${JSON.stringify(targetList)}\nAUDIT: ${JSON.stringify(audit)}\n\n${modeRule}\n\nATURAN WAJIB:\n- Jumlah dan urutan slide tidak boleh berubah.\n- Slide NON-TARGET harus tetap persis.\n- Semua copy target harus Bahasa Indonesia natural, ringkas, dan sesuai fungsi section.\n- Semua fakta/tindakan substantif target wajib punya claim dengan field benar, sourceId, dan evidence PERSIS dari FACT_BANK yang sama.\n- Jangan memakai pengetahuan luar. Jangan mengarang tindakan, manfaat, hasil, sebab-akibat, keamanan, atau rekomendasi.\n- Jangan membuat judul solusi yang tidak didukung body/evidence.\n- Jangan mengubah “dapat/mungkin/bisa” menjadi kepastian.\n\nFACT_BANK:\n${JSON.stringify(bank)}\n\nCURRENT_DRAFT:\n${JSON.stringify(draft.slides)}\n\nKembalikan HANYA JSON {"slides":[{"section":"...","title":"...","body":"...","points":[],"claims":[{"field":"slide:1:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}.`;
}

function parseResponse(response) {
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Role recovery tidak mengembalikan konten.');
  return JSON.parse(raw);
}

function mergeTargetSlides(draft, candidate, targets, audit) {
  if (!candidate || !Array.isArray(candidate.slides) || candidate.slides.length !== draft.slides.length) return null;
  const fallback = factFallbackSections(draft.slides.length);
  return {
    ...candidate,
    slides: draft.slides.map((original, index) => {
      if (!targets.has(index)) return {
        ...original,
        points: Array.isArray(original?.points) ? [...original.points] : [],
        claims: Array.isArray(original?.claims) ? original.claims.map(claim => ({ ...claim })) : []
      };
      const incoming = candidate.slides[index] || original;
      let section;
      if (!audit.formatFit) section = fallback[index];
      else {
        const originalSection = String(original?.section || '').trim();
        const allowPenutup = index === draft.slides.length - 1 && /^HASIL(?:\/PENUTUP)?$/i.test(originalSection);
        section = allowPenutup && /^PENUTUP$/i.test(String(incoming?.section || '').trim()) ? 'PENUTUP' : originalSection;
      }
      return {
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

async function repairManualSourceRoles({ contentService, generated, options = {}, sources = [], client }) {
  const requestedFormat = options.contentFormat || '';
  const normalized = normalizedFormat(requestedFormat);
  if (!ROLE_FORMATS.has(normalized)) return generated;

  const alreadyEffective = effectiveManualFormat(generated, requestedFormat);
  if (normalizedFormat(alreadyEffective) === 'fakta singkat') {
    return { ...generated, effectiveContentFormat: 'Fakta singkat' };
  }

  const topic = options.requestedTopic || generated?.topic || '';
  const bank = sourceFilter.extractFactBank(sources, topic);
  if (!bank.length) return generated;
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });

  let draft = generated;
  let deterministicErrors = deterministicRoleErrors(draft, requestedFormat);
  let audit = await auditRoles(openai, draft, bank, requestedFormat);
  if (!deterministicErrors.length && audit.formatFit && !audit.invalid.length) return draft;
  let lastErrors = [...deterministicErrors, ...audit.invalid.map(item => `slide:${item.slideIndex}:role: ${item.reason || `${item.role} tidak sesuai fungsi format.`}`)];

  for (let attempt = 1; attempt <= MAX_ROLE_REPAIR_ATTEMPTS; attempt += 1) {
    const targets = targetIndexes(draft, audit, deterministicErrors);
    if (!targets.size) break;
    const response = await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        { role: 'system', content: 'Anda melakukan targeted role recovery source-backed. Jangan mengarang fakta atau tindakan.' },
        { role: 'user', content: recoveryPrompt({ draft, bank, format: requestedFormat, audit, targets }) }
      ],
      response_format: { type: 'json_object' }
    });

    let parsed;
    try { parsed = parseResponse(response); }
    catch (error) { lastErrors = [`JSON role recovery tidak valid: ${error.message}`]; continue; }
    const candidate = mergeTargetSlides(draft, parsed, targets, audit);
    if (!candidate) { lastErrors = ['Role recovery mengubah jumlah slide.']; continue; }

    const validationFormat = audit.formatFit ? requestedFormat : 'Fakta singkat';
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

    // Audit every explicit replacement claim before pruning. This prevents a
    // factual replacement paired with unrelated-but-existing evidence from
    // slipping through merely because a keyword heuristic considered it neutral.
    const semanticErrors = await sourceFilter.auditClaimSemantics(openai, checked.content, topic, validationFormat);
    if (semanticErrors.length) {
      lastErrors = semanticErrors;
      draft = checked.content;
      continue;
    }

    const duplicateErrors = manualSourceDedupe.manualCrossSlideDuplicateErrors(checked.content);
    if (duplicateErrors.length) {
      lastErrors = duplicateErrors;
      draft = checked.content;
      continue;
    }

    if (!audit.formatFit) return { ...checked.content, effectiveContentFormat: 'Fakta singkat' };

    deterministicErrors = deterministicRoleErrors(checked.content, requestedFormat);
    audit = await auditRoles(openai, checked.content, bank, requestedFormat);
    if (!deterministicErrors.length && audit.formatFit && !audit.invalid.length) return checked.content;
    lastErrors = [...deterministicErrors, ...audit.invalid.map(item => `slide:${item.slideIndex}:role: ${item.reason || `${item.role} tidak sesuai fungsi format.`}`)];
    draft = checked.content;
  }

  throw Object.assign(new Error(`Topik manual tidak dapat diselaraskan dengan fungsi format tanpa mengarang: ${lastErrors[0] || 'role tidak valid'}`), {
    status: 422,
    validationErrors: lastErrors
  });
}

module.exports = {
  repairManualSourceRoles,
  deterministicRoleErrors,
  looksLikeUserAction,
  effectiveManualFormat,
  auditRoles,
  MAX_ROLE_AUDIT_ATTEMPTS,
  MAX_ROLE_REPAIR_ATTEMPTS
};
