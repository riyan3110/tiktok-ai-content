const OpenAI = require('openai');
const config = require('../config');
const baseComposer = require('./manualSourceComposer');

const MAX_FORMAT_CLASSIFY_ATTEMPTS = 2;
const MAX_RELATION_AUDIT_ATTEMPTS = 2;
const ACTION_FORMATS = new Set(['tutorial langkah', 'masalah dan solusi', 'tips cepat', 'before-after']);
const ACTION_VERB_PATTERN = /\b(?:cek|periksa|memeriksa|buka|membuka|pilih|memilih|aktifkan|mengaktifkan|nonaktifkan|menonaktifkan|hapus|menghapus|keluarkan|mengeluarkan|putuskan|memutuskan|cabut|mencabut|ubah|mengubah|ganti|mengganti|reset|atur|mengatur|tinjau|meninjau|verifikasi|memverifikasi|konfirmasi|mengonfirmasi|gunakan|menggunakan|hindari|pastikan|jangan|laporkan|melaporkan|blokir|memblokir|amankan|mengamankan|perbarui|memperbarui|update|logout|hentikan|menghentikan|batasi|membatasi|simpan|menyimpan|bandingkan|membandingkan|pindai|scan|ketuk|tap|lakukan|ikuti|konsumsi|mengonsumsi|makan|tambahkan|menambahkan|kurangi|mengurangi)\b/i;
const NON_USER_ACTOR_PATTERN = /\b(?:pelaku|penyerang|hacker|peretas|malware|spyware|orang lain)\b/i;

function normalizedFormat(value) {
  return String(value || '').trim().toLocaleLowerCase('id-ID');
}

function looksLikeUserAction(value) {
  const text = String(value || '').trim();
  const match = text.match(ACTION_VERB_PATTERN);
  if (!match) return false;
  return !NON_USER_ACTOR_PATTERN.test(text.slice(0, match.index || 0));
}

function factSections(count) {
  return count <= 4
    ? ['PEMBUKA', 'FAKTA UTAMA', 'PENJELASAN', 'KESIMPULAN']
    : ['PEMBUKA', 'FAKTA UTAMA', 'PENJELASAN', 'KONTEKS', 'KESIMPULAN'];
}

function structureInstruction(format, count) {
  const normalized = normalizedFormat(format);
  if (normalized === 'listicle') return `SECTION FINAL WAJIB: ITEM 1 sampai ITEM ${count}; semua slide adalah item substantif, tanpa intro/penutup generik.`;
  if (normalized === 'fakta singkat') return `SECTION FINAL WAJIB persis ${JSON.stringify(factSections(count))}.`;
  if (normalized === 'tutorial langkah') return `SECTION FINAL WAJIB: PEMBUKA, lalu LANGKAH 1 sampai LANGKAH ${count - 2}, lalu PENUTUP atau HASIL/PENUTUP. Setiap LANGKAH harus tindakan pengguna.`;
  if (normalized === 'masalah dan solusi') return `SECTION FINAL WAJIB: MASALAH, lalu ${count - 2} slide SOLUSI, lalu PENUTUP atau HASIL/PENUTUP. Semua SOLUSI harus tindakan pengguna berbeda.`;
  if (normalized === 'tips cepat') return `SECTION FINAL WAJIB: PEMBUKA, lalu TIPS 1 sampai TIPS ${count - 2}, lalu RINGKASAN atau PENUTUP. Semua TIPS harus tindakan pengguna berbeda.`;
  if (normalized === 'before-after') {
    const changes = Array.from({ length: Math.max(1, count - 3) }, (_, index) => `PERUBAHAN ${index + 1}`).join(', ');
    return `SECTION FINAL WAJIB: BEFORE, ${changes}, AFTER, lalu PENUTUP atau HASIL/PENUTUP. Hubungan transformasi wajib eksplisit di source.`;
  }
  return `Pertahankan format ${format} secara persis.`;
}

function formatStructureErrors(content, format, expectedCount) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  const normalized = normalizedFormat(format);
  const section = index => String(slides[index]?.section || '').trim();
  if (slides.length !== expectedCount) return [`format: jumlah slide ${slides.length}; harus ${expectedCount}.`];

  if (normalized === 'listicle') {
    slides.forEach((_, index) => {
      if (section(index).toUpperCase() !== `ITEM ${index + 1}`) errors.push(`slide:${index}:section: Listicle harus memakai ITEM ${index + 1}.`);
    });
    return errors;
  }
  if (normalized === 'fakta singkat') {
    const expected = factSections(expectedCount);
    slides.forEach((_, index) => {
      if (section(index).toUpperCase() !== expected[index]) errors.push(`slide:${index}:section: Fakta singkat harus memakai ${expected[index]}.`);
    });
    return errors;
  }
  if (normalized === 'tutorial langkah') {
    if (!/^PEMBUKA$/i.test(section(0))) errors.push('slide:0:section: Tutorial harus dimulai PEMBUKA.');
    for (let index = 1; index < slides.length - 1; index += 1) {
      if (section(index).toUpperCase() !== `LANGKAH ${index}`) errors.push(`slide:${index}:section: Tutorial harus memakai LANGKAH ${index}.`);
      if (![slides[index]?.body, ...(slides[index]?.points || [])].some(looksLikeUserAction)) errors.push(`slide:${index}:role: LANGKAH ${index} harus berisi tindakan pengguna.`);
    }
    if (!/^(?:PENUTUP|HASIL|HASIL\/PENUTUP)$/i.test(section(slides.length - 1))) errors.push(`slide:${slides.length - 1}:section: Tutorial harus memiliki penutup.`);
    return errors;
  }
  if (normalized === 'masalah dan solusi') {
    if (!/^MASALAH$/i.test(section(0))) errors.push('slide:0:section: Masalah dan solusi harus dimulai MASALAH.');
    for (let index = 1; index < slides.length - 1; index += 1) {
      if (!/^SOLUSI$/i.test(section(index))) errors.push(`slide:${index}:section: slide tengah harus SOLUSI.`);
      if (![slides[index]?.body, ...(slides[index]?.points || [])].some(looksLikeUserAction)) errors.push(`slide:${index}:role: SOLUSI harus berisi tindakan pengguna.`);
    }
    if (!/^(?:PENUTUP|HASIL|HASIL\/PENUTUP)$/i.test(section(slides.length - 1))) errors.push(`slide:${slides.length - 1}:section: format harus memiliki penutup.`);
    return errors;
  }
  if (normalized === 'tips cepat') {
    if (!/^PEMBUKA$/i.test(section(0))) errors.push('slide:0:section: Tips cepat harus dimulai PEMBUKA.');
    for (let index = 1; index < slides.length - 1; index += 1) {
      if (section(index).toUpperCase() !== `TIPS ${index}`) errors.push(`slide:${index}:section: Tips cepat harus memakai TIPS ${index}.`);
      if (![slides[index]?.body, ...(slides[index]?.points || [])].some(looksLikeUserAction)) errors.push(`slide:${index}:role: TIPS ${index} harus berisi tindakan pengguna.`);
    }
    if (!/^(?:RINGKASAN|PENUTUP)$/i.test(section(slides.length - 1))) errors.push(`slide:${slides.length - 1}:section: Tips cepat harus diakhiri RINGKASAN atau PENUTUP.`);
    return errors;
  }
  if (normalized === 'before-after') {
    if (!/^BEFORE$/i.test(section(0))) errors.push('slide:0:section: Before-after harus dimulai BEFORE.');
    for (let index = 1; index < slides.length - 2; index += 1) {
      if (section(index).toUpperCase() !== `PERUBAHAN ${index}`) errors.push(`slide:${index}:section: Before-after harus memakai PERUBAHAN ${index}.`);
    }
    const afterIndex = slides.length - 2;
    if (!/^AFTER$/i.test(section(afterIndex))) errors.push(`slide:${afterIndex}:section: Before-after membutuhkan AFTER.`);
    if (!/^(?:PENUTUP|HASIL|HASIL\/PENUTUP)$/i.test(section(slides.length - 1))) errors.push(`slide:${slides.length - 1}:section: Before-after harus memiliki penutup.`);
  }
  return errors;
}

async function classifyEffectiveFormat(openai, requestedFormat, bank) {
  const normalized = normalizedFormat(requestedFormat);
  if (!ACTION_FORMATS.has(normalized)) return requestedFormat;
  let lastError;
  for (let attempt = 1; attempt <= MAX_FORMAT_CLASSIFY_ATTEMPTS; attempt += 1) {
    try {
      const response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          { role: 'system', content: 'Anda classifier kecocokan format terhadap FACT_BANK. Jangan membuat konten.' },
          { role: 'user', content: `FORMAT: ${requestedFormat}\nFACT_BANK: ${JSON.stringify(bank)}\nTentukan apakah source benar-benar mendukung format TANPA mengarang. Tutorial perlu minimal dua tindakan berurutan. Masalah dan solusi perlu masalah + minimal dua tindakan solusi. Tips cepat perlu minimal dua tindakan/tips. Before-after perlu kondisi BEFORE, perubahan, dan AFTER. Kembalikan HANYA JSON {"fit":true}.` }
        ],
        response_format: { type: 'json_object' }
      });
      const parsed = JSON.parse(response?.choices?.[0]?.message?.content || '{}');
      if (typeof parsed?.fit !== 'boolean') throw new Error('classifier tidak memiliki fit boolean');
      return parsed.fit ? requestedFormat : 'Fakta singkat';
    } catch (error) {
      lastError = error;
    }
  }
  throw Object.assign(new Error(`Audit kecocokan format gagal; format tidak boleh diubah tanpa keputusan valid: ${lastError?.message || 'provider gagal'}`), { status: 422 });
}

async function beforeAfterRelationshipErrors(openai, content, bank) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RELATION_AUDIT_ATTEMPTS; attempt += 1) {
    try {
      const response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          { role: 'system', content: 'Anda auditor hubungan Before-after source-backed. Jangan memperbaiki atau mengisi fakta.' },
          { role: 'user', content: `FACT_BANK: ${JSON.stringify(bank)}\nSLIDES: ${JSON.stringify(content?.slides || [])}\nPeriksa secara ketat apakah BEFORE, seluruh PERUBAHAN, dan AFTER adalah SATU hubungan transformasi/urutan sebab-perubahan-hasil yang secara eksplisit didukung FACT_BANK. Jangan menggabungkan fakta independen menjadi before-after baru. AFTER harus benar-benar keadaan sesudah perubahan yang sama, bukan fakta lain yang kebetulan benar. Kembalikan HANYA JSON {"supported":true,"reason":""}.` }
        ],
        response_format: { type: 'json_object' }
      });
      const parsed = JSON.parse(response?.choices?.[0]?.message?.content || '{}');
      if (typeof parsed?.supported !== 'boolean') throw new Error('audit hubungan tidak memiliki supported boolean');
      if (parsed.supported) return [];
      return [`before-after: hubungan BEFORE → PERUBAHAN → AFTER tidak didukung sebagai satu transformasi oleh sumber${parsed.reason ? `: ${String(parsed.reason)}` : '.'}`];
    } catch (error) {
      lastError = error;
    }
  }
  return [`before-after: audit hubungan gagal; hasil tidak boleh dirender tanpa verifikasi hubungan: ${lastError?.message || 'provider gagal'}`];
}

function guardedClient(openai, effectiveFormat, expectedCount) {
  return {
    chat: {
      completions: {
        async create(args = {}) {
          const prompt = String(args?.messages?.at(-1)?.content || '');
          // The final wrapper already classified the format strictly. Prevent the legacy
          // internal classifier from making a second, inconsistent decision.
          if (/Nilai apakah FACT_BANK benar-benar cukup untuk format tersebut/i.test(prompt)) {
            return { choices: [{ message: { content: JSON.stringify({ fit: true }) } }] };
          }
          if (/KOMPOSISI FINAL MANUAL \+ URL/i.test(prompt)) {
            const messages = (args.messages || []).map((message, index, all) => index === all.length - 1
              ? { ...message, content: `${message.content}\n\nFINAL FORMAT CONTRACT (lebih kuat dari contoh schema):\n${structureInstruction(effectiveFormat, expectedCount)}\nJika tidak mampu memenuhi contract ini dari FACT_BANK, jangan mengganti format atau mengarang fakta.` }
              : message);
            return openai.chat.completions.create({ ...args, messages });
          }
          return openai.chat.completions.create(args);
        }
      }
    }
  };
}

async function composeManualSourceContent(params = {}) {
  const requestedFormat = params?.options?.contentFormat || 'Fakta singkat';
  const requestedTopic = String(params?.options?.requestedTopic || '').trim();
  const bank = baseComposer.extractManualFactBank(params.sources || [], requestedTopic);
  const openai = params.client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const effectiveFormat = await classifyEffectiveFormat(openai, requestedFormat, bank);
  const expectedCount = baseComposer.desiredSlideCount(effectiveFormat, params.sources || [], bank);
  const result = await baseComposer.composeManualSourceContent({
    ...params,
    options: { ...(params.options || {}), contentFormat: effectiveFormat },
    client: guardedClient(openai, effectiveFormat, expectedCount)
  });

  const actualFormat = result?.effectiveContentFormat || effectiveFormat;
  if (normalizedFormat(actualFormat) !== normalizedFormat(effectiveFormat)) {
    throw Object.assign(new Error(`Composer mencoba mengubah format ${effectiveFormat} menjadi ${actualFormat}; hasil ditolak.`), { status: 422 });
  }
  const structureErrors = formatStructureErrors(result, effectiveFormat, expectedCount);
  if (structureErrors.length) {
    throw Object.assign(new Error(`Konten tidak sesuai format final: ${structureErrors[0]}`), {
      status: 422,
      validationErrors: structureErrors
    });
  }
  if (normalizedFormat(effectiveFormat) === 'before-after') {
    const relationErrors = await beforeAfterRelationshipErrors(openai, result, bank);
    if (relationErrors.length) {
      throw Object.assign(new Error(`Konten tidak sesuai format final: ${relationErrors[0]}`), {
        status: 422,
        validationErrors: relationErrors
      });
    }
  }

  const final = { ...result };
  delete final.effectiveContentFormat;
  if (normalizedFormat(effectiveFormat) !== normalizedFormat(requestedFormat)) final.effectiveContentFormat = effectiveFormat;
  return final;
}

module.exports = {
  composeManualSourceContent,
  classifyEffectiveFormat,
  beforeAfterRelationshipErrors,
  formatStructureErrors,
  looksLikeUserAction,
  MAX_FORMAT_CLASSIFY_ATTEMPTS,
  MAX_RELATION_AUDIT_ATTEMPTS
};
