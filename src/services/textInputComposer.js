const OpenAI = require('openai');
const config = require('../config');

const MIN_TEXT_CHARS = 80;
const MAX_TEXT_CHARS = 20000;
const MAX_REPAIRS = 2;
const FIVE_SLIDE_MIN_WORDS = 220;
const CAPTION_MIN_WORDS = 25;
const CAPTION_MAX_WORDS = 40;
const HASHTAG_MIN = 3;
const HASHTAG_MAX = 5;

const COPY_FILLER_WORDS = new Set([
  'yang', 'dan', 'atau', 'dari', 'untuk', 'dengan', 'tentang', 'cara',
  'adalah', 'pada', 'itu', 'ini', 'sebagai', 'terjadi', 'penting',
  'slide', 'fakta', 'utama', 'detail', 'penutup', 'kesimpulan'
]);

const SOURCE_GROUNDED_MODIFIERS = [
  'terintegrasi', 'efektif', 'optimal', 'instan', 'revolusioner', 'unggul',
  'terbaik', 'sempurna', 'otomatis', 'real-time', 'realtime', 'signifikan',
  'efisiensi', 'produktivitas', 'kunci', 'menegaskan', 'mengklaim',
  'dibuat', 'dirancang', 'cocok', 'mendukung', 'ditujukan', 'bertujuan',
  'meluncurkan', 'menjanjikan', 'persaingan'
];

const GENERIC_SLIDE_TITLE_TERMS = [
  'hook',
  'fakta utama',
  'detail',
  'detail penting',
  'hal penting',
  'konteks',
  'konteks tambahan',
  'penutup',
  'kesimpulan',
  'ringkasan',
  'kecepatan utama', 'kemampuan utama', 'manfaat utama', 'aplikasi utama',
  'fokus utama', 'dampak utama', 'informasi utama'
];

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const words = value => clean(value).split(/\s+/).filter(Boolean);
const normalized = value => clean(value)
  .toLocaleLowerCase('id-ID')
  .replace(/[^a-z0-9%.,\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function numbers(value) {
  return [...new Set(String(value || '').match(/\b\d+(?:[.,]\d+)*(?:%|gb|tb|mb|miliar|juta|ribu)?\b/gi) || [])]
    .map(item => item.toLocaleLowerCase('id-ID'));
}

function stripPoint(value) {
  return clean(value).replace(/^(?:[•*\-–—]|\d+[.)])\s*/, '').trim();
}

function normalizeSlides(input) {
  if (!Array.isArray(input)) return [];
  return input.map((slide = {}) => ({
    section: clean(slide.section),
    title: clean(slide.title),
    body: clean(slide.body),
    points: Array.isArray(slide.points) ? slide.points.map(stripPoint).filter(Boolean).slice(0, 3) : []
  })).filter(slide => slide.title || slide.body || slide.points.length);
}

function meaningfulTokens(value) {
  return normalized(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => (token.length > 2 || token === 'ai') && !COPY_FILLER_WORDS.has(token));
}

function genericSlideTitle(value) {
  const title = normalized(value).replace(/[.,:;!?]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!title) return false;
  return GENERIC_SLIDE_TITLE_TERMS.some(term => {
    const key = normalized(term);
    return title === key || title.startsWith(`${key} `) || title.endsWith(` ${key}`);
  });
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTypedEntities(sourceText) {
  const source = clean(sourceText);
  const modes = [];
  const models = [];
  const add = (list, raw) => {
    const name = clean(raw).replace(/[.,;:!?]+$/, '');
    if (!name || /^(ini|baru)$/i.test(name)) return;
    if (!list.some(item => normalized(item) === normalized(name))) list.push(name);
  };
  for (const match of source.matchAll(/\bmode(?:\s+baru)?(?:\s+bernama)?\s+([A-Z][A-Za-z0-9.-]*(?:\s+[A-Z0-9][A-Za-z0-9.-]*){0,2})/g)) add(modes, match[1]);
  for (const match of source.matchAll(/\bmodel\s+([A-Z][A-Za-z0-9.-]*(?:\s+[A-Z0-9][A-Za-z0-9.-]*){0,3})/g)) add(models, match[1]);
  for (const match of source.matchAll(/\b([A-Z][A-Za-z0-9.-]*(?:\s+[A-Z0-9][A-Za-z0-9.-]*){0,3})\s+(?:sendiri\s+)?(?:merupakan|adalah)\s+model\b/g)) add(models, match[1]);
  return { modes, models };
}

function attributionOnlyPoint(value) {
  return /^(?:menurut\b|dilansir(?:\s+oleh)?\b|diberitakan(?:\s+oleh)?\b|dikutip(?:\s+dari)?\b|diklaim(?:\s+oleh)?\b|sumber(?:nya)?\b)/i.test(clean(value));
}

function validateModeSubjectShift(result, sourceText) {
  const source = normalized(sourceText);
  const visible = normalized([result?.caption, ...(result?.slides || []).flatMap(slide => [slide?.title, slide?.body, ...(slide?.points || [])])].join(' '));
  const relation = '(?:ditujukan|dirancang|dibuat|bertujuan)';
  if (new RegExp(`\\bmode (?:ini|tersebut) ${relation}\\b`, 'i').test(visible) && !new RegExp(`\\bmode (?:ini|tersebut) ${relation}\\b`, 'i').test(source)) {
    return ['subjek relasi berubah: jangan mengubah fakta tentang peningkatan/fitur menjadi "Mode ini ditujukan/dirancang/dibuat"'];
  }
  for (const mode of extractTypedEntities(sourceText).modes) {
    const key = escapeRegExp(mode);
    if (new RegExp(`\\bmode ${key} ${relation}\\b`, 'i').test(visible) && !new RegExp(`\\bmode ${key} ${relation}\\b`, 'i').test(source)) {
      return [`subjek relasi berubah: Mode ${mode} tidak boleh diberi relasi baru`];
    }
  }
  return [];
}

function validateEntityContext(result, sourceText) {
  const issues = [];
  const { modes, models } = extractTypedEntities(sourceText);
  const slides = Array.isArray(result?.slides) ? result.slides : [];
  const visible = [result?.topic, result?.caption, ...slides.flatMap(slide => [slide?.title, slide?.body, ...(slide?.points || [])])]
    .filter(Boolean).join(' ');

  for (const mode of modes) {
    const key = escapeRegExp(mode);
    if (new RegExp(`\\bmodel\\s+${key}\\b|\\b${key}\\s+(?:adalah\\s+|merupakan\\s+)?model\\b`, 'i').test(visible)) {
      issues.push(`jenis entitas tertukar: ${mode} adalah mode, bukan model`);
    }
    if (new RegExp(`\\b${key}\\s+mode\\b`, 'i').test(visible)) {
      issues.push(`urutan istilah tidak natural: gunakan "Mode ${mode}", bukan "${mode} Mode"`);
    }
    for (const slide of slides) {
      const title = clean(slide?.title);
      const detail = [slide?.body, ...(slide?.points || [])].filter(Boolean).join(' ');
      const benefitTitle = new RegExp(`(?:\\bmanfaat\\b|\\bkemampuan\\b|\\bfitur\\b|\\baplikasi\\b).*\\b${key}\\b|\\b${key}\\b.*(?:\\bmanfaat\\b|\\bkemampuan\\b|\\bfitur\\b|\\baplikasi\\b)`, 'i').test(title);
      if (benefitTitle && /\bmodel\s+(?:dirancang|digunakan|mendukung|memiliki|merupakan)\b/i.test(detail)) {
        issues.push(`konteks slide mencampur fakta model ke manfaat/kemampuan mode ${mode}`);
      }
    }
  }

  for (const model of models) {
    const key = escapeRegExp(model);
    if (new RegExp(`\\bmode\\s+${key}\\b|\\b${key}\\s+(?:adalah\\s+|merupakan\\s+)?mode\\b`, 'i').test(visible)) {
      issues.push(`jenis entitas tertukar: ${model} adalah model, bukan mode`);
    }
  }
  return [...new Set(issues)];
}

function validateComparisonCompleteness(result, sourceText) {
  const issues = [];
  const comparisons = [...clean(sourceText).matchAll(/\b(\d+(?:[.,]\d+)?)\s+kali\s+lebih\s+([a-z]+)\b/gi)];
  if (!comparisons.length) return issues;
  const fields = [result?.topic, result?.caption, ...(result?.slides || []).flatMap(slide => [slide?.title, slide?.body, ...(slide?.points || [])])]
    .map(clean).filter(Boolean);
  for (const match of comparisons) {
    const number = match[1];
    const adjective = match[2];
    const short = new RegExp(`\\b${escapeRegExp(number)}\\s+kali\\b`, 'i');
    const complete = new RegExp(`\\b${escapeRegExp(number)}\\s+kali\\s+lebih\\s+${escapeRegExp(adjective)}\\b`, 'i');
    if (fields.some(field => short.test(field) && !complete.test(field))) {
      issues.push(`perbandingan "${number} kali lebih ${adjective}" tidak boleh dipotong menjadi "${number} kali"`);
    }
  }
  return [...new Set(issues)];
}

function duplicateSlideCopy(slide = {}) {
  const fields = [slide.title, slide.body, ...(slide.points || [])]
    .map(value => ({ raw: clean(value), tokens: [...new Set(meaningfulTokens(value))] }))
    .filter(field => field.tokens.length);

  for (let left = 0; left < fields.length; left += 1) {
    for (let right = left + 1; right < fields.length; right += 1) {
      const a = fields[left].tokens;
      const b = fields[right].tokens;
      const shared = a.filter(token => b.includes(token));
      if (
        normalized(fields[left].raw) === normalized(fields[right].raw) ||
        (shared.length >= 2 && shared.length / Math.min(a.length, b.length) >= 0.75)
      ) return true;
    }
  }
  return false;
}

function targetSlideCount(sourceText) {
  return words(sourceText).length >= FIVE_SLIDE_MIN_WORDS ? 5 : 4;
}

function shapeSlides(input, targetCount) {
  let slides = normalizeSlides(input);
  if (slides.length > targetCount) {
    const first = slides[0];
    const last = slides.at(-1);
    slides = [first, ...slides.slice(1, -1).slice(0, targetCount - 2), last];
  }

  slides = slides.map((slide, index) => {
    const next = { ...slide, points: [...slide.points] };
    if (index === 0) {
      next.body = '';
      next.points = [];
    }
    if (index === slides.length - 1) next.points = [];
    if (targetCount === 5 && index === 3) next.points = [];
    return next;
  });
  return slides;
}

function shapeParsed(parsed, targetCount) {
  return { ...(parsed || {}), slides: shapeSlides(parsed?.slides, targetCount) };
}

function parseOutput(response) {
  const output = response?.choices?.[0]?.message?.content;
  if (!output) throw new Error(`Provider AI ${config.aiProvider || 'yang dipilih'} tidak mengembalikan konten`);
  try { return JSON.parse(output); }
  catch {
    console.error('[Text input composer][JSON invalid]', output);
    throw new Error(`Provider AI ${config.aiProvider || 'yang dipilih'} mengembalikan JSON yang tidak valid`);
  }
}

function validateInputText(text) {
  const value = String(text || '').trim();
  if (value.length < MIN_TEXT_CHARS) {
    throw Object.assign(new Error('Teks terlalu pendek. Tempel ringkasan berita yang lebih lengkap agar bisa disusun menjadi 4–5 slide tanpa mengarang fakta.'), { status: 422 });
  }
  if (value.length > MAX_TEXT_CHARS) {
    throw Object.assign(new Error(`Teks terlalu panjang. Maksimal ${MAX_TEXT_CHARS.toLocaleString('id-ID')} karakter.`), { status: 422 });
  }
  return value;
}

function validateGroundedNumbers(result, sourceText) {
  const sourceNumbers = new Set(numbers(sourceText));
  const visible = [
    result?.topic,
    result?.caption,
    ...(result?.slides || []).flatMap(slide => [slide?.title, slide?.body, ...(slide?.points || [])])
  ].join(' ');
  return numbers(visible).filter(value => !sourceNumbers.has(value));
}

function validateGroundedModifiers(result, sourceText) {
  const source = normalized(sourceText).replace(/-/g, ' ');
  const visible = normalized([
    result?.caption,
    ...(result?.slides || []).flatMap(slide => [slide?.title, slide?.body, ...(slide?.points || [])])
  ].join(' ')).replace(/-/g, ' ');

  return SOURCE_GROUNDED_MODIFIERS.filter(term => {
    const key = normalized(term).replace(/-/g, ' ');
    return visible.includes(key) && !source.includes(key);
  });
}

function buildRepairGuidance(errors = []) {
  const guidance = [];
  for (const raw of errors) {
    const error = clean(raw);
    const unsupportedTerms = error.match(/^kata atau penegasan baru yang tidak ada di teks input:\s*(.+)$/i);
    if (unsupportedTerms) {
      guidance.push(`WAJIB hapus atau tulis ulang semua field yang memuat kata/frasa berikut karena tidak ada di TEXT_INPUT: ${unsupportedTerms[1]}. Jangan mempertahankan kata itu dan jangan menggantinya dengan sinonim yang menambah klaim baru.`);
      continue;
    }

    const extraNumbers = error.match(/^angka baru yang tidak ada di teks input:\s*(.+)$/i);
    if (extraNumbers) {
      guidance.push(`WAJIB hapus angka berikut dari field yang memuatnya karena tidak ada di TEXT_INPUT: ${extraNumbers[1]}. Jangan menggantinya dengan angka lain.`);
      continue;
    }

    const genericTitle = error.match(/^slide\s+(\d+):\s+judul besar harus spesifik/i);
    if (genericTitle) {
      guidance.push(`WAJIB ganti judul slide ${genericTitle[1]} dengan fakta atau objek spesifik yang benar-benar ada di TEXT_INPUT. Jangan gunakan label section, pola "... Utama", atau judul generik lain.`);
      continue;
    }

    if (/subjek relasi berubah/i.test(error)) {
      guidance.push('WAJIB kembalikan subjek relasi ke subjek yang sama seperti TEXT_INPUT. Jangan pindahkan relasi "ditujukan/dirancang/dibuat/bertujuan" dari peningkatan atau fitur ke mode, model, atau produk.');
      continue;
    }

    if (/perbandingan .*tidak boleh dipotong/i.test(error)) {
      guidance.push('WAJIB tulis perbandingan secara lengkap persis dalam makna yang sama seperti TEXT_INPUT; jangan sisakan angka tanpa "lebih" dan sifat pembandingnya.');
    }
  }

  if (!guidance.length) {
    return 'Perbaiki hanya field yang menyebabkan error. Bila sebuah field bergantung pada klaim yang ditolak, tulis ulang field itu dari fakta yang benar-benar ada di TEXT_INPUT, bukan dengan fakta pengganti dari luar.';
  }
  return guidance.join(' ');
}

function normalizeHashtags(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    const tag = clean(raw).replace(/\s+/g, '').replace(/^#+/, '');
    if (!tag) continue;
    const value = `#${tag}`;
    const key = value.toLocaleLowerCase('id-ID');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= HASHTAG_MAX) break;
  }
  return out;
}

function validateResult(result, sourceText, requestedSlideCount = targetSlideCount(sourceText)) {
  const errors = [];
  const slides = shapeSlides(result?.slides, requestedSlideCount);
  const caption = clean(result?.caption);
  const hashtags = normalizeHashtags(result?.hashtags);

  if (!clean(result?.topic)) errors.push('topic wajib diisi');
  if (!caption) errors.push('caption wajib diisi');
  const captionWords = words(caption).length;
  if (caption && (captionWords < CAPTION_MIN_WORDS || captionWords > CAPTION_MAX_WORDS)) {
    errors.push(`caption harus ringkas ${CAPTION_MIN_WORDS}–${CAPTION_MAX_WORDS} kata; sekarang ${captionWords} kata`);
  }
  if (hashtags.length < HASHTAG_MIN || hashtags.length > HASHTAG_MAX) {
    errors.push(`hashtag harus ${HASHTAG_MIN}–${HASHTAG_MAX} item; sekarang ${hashtags.length}`);
  }
  if (slides.length !== requestedSlideCount) {
    errors.push(`jumlah slide harus tepat ${requestedSlideCount}, sekarang ${slides.length}`);
  }

  const seen = new Set();
  slides.forEach((slide, index) => {
    const number = index + 1;
    if (!slide.title) errors.push(`slide ${number}: judul kosong`);
    const titleWords = words(slide.title).length;
    if (index !== 0 && !slide.body) errors.push(`slide ${number}: body kosong`);
    if (index === 0 && (titleWords < 7 || titleWords > 10)) {
      errors.push(`slide 1: judul hook harus padat 7–10 kata; sekarang ${titleWords} kata`);
    } else if (index !== 0 && titleWords > 10) {
      errors.push(`slide ${number}: judul maksimal 10 kata`);
    }
    if (genericSlideTitle(slide.title) || normalized(slide.title) === normalized(slide.section)) {
      errors.push(`slide ${number}: judul besar harus spesifik dan tidak boleh mengulang label section "${slide.section}"`);
    }

    const fields = [slide.title, slide.body, ...slide.points].map(normalized).filter(Boolean);
    for (const field of fields) {
      if (seen.has(field)) errors.push(`slide ${number}: ada kalimat yang diulang persis`);
      seen.add(field);
    }

    if (normalized(slide.title) === normalized(slide.body)) {
      errors.push(`slide ${number}: judul dan body tidak boleh sama`);
    }
    if (duplicateSlideCopy(slide)) {
      errors.push(`slide ${number}: judul, body, dan bullet harus membawa informasi yang berbeda`);
    }
  });

  if (slides.length === requestedSlideCount) {
    const first = slides[0];
    const last = slides.at(-1);
    if (first.body) errors.push('slide 1 harus hanya judul tanpa body');
    if (first.points.length) errors.push('slide 1 harus tanpa bullet');

    for (const index of [1, 2]) {
      const slide = slides[index];
      if (!slide) continue;
      if (slide.points.length < 2 || slide.points.length > 3) {
        errors.push(`slide ${index + 1} harus memiliki 2–3 bullet`);
      }
      const bodyWords = words(slide.body).length;
      if (bodyWords < 8 || bodyWords > 14) {
        errors.push(`slide ${index + 1}: body target 8–14 kata`);
      }
      slide.points.forEach((point, pointIndex) => {
        const count = words(point).length;
        if (count < 3 || count > 7) {
          errors.push(`slide ${index + 1} bullet ${pointIndex + 1}: target 3–7 kata`);
        }
        if (attributionOnlyPoint(point)) {
          errors.push(`slide ${index + 1} bullet ${pointIndex + 1}: sumber/publisher tidak boleh dijadikan bullet isi`);
        }
      });
    }

    if (requestedSlideCount === 5) {
      const fourth = slides[3];
      if (fourth.points.length) errors.push('slide 4 pada carousel 5 slide harus tanpa bullet');
      const count = words(fourth.body).length;
      if (count < 10 || count > 16) {
        errors.push(`slide 4: body target 10–16 kata; sekarang ${count} kata`);
      }
    }

    if (last.points.length) errors.push('slide terakhir harus tanpa bullet');
    const lastWords = words(last.body).length;
    if (lastWords < 14 || lastWords > 18) {
      errors.push(`slide terakhir harus berupa penutup yang cukup isi, target 14–18 kata; sekarang ${lastWords} kata`);
    }
  }

  const extraNumbers = validateGroundedNumbers({ ...result, slides }, sourceText);
  if (extraNumbers.length) errors.push(`angka baru yang tidak ada di teks input: ${extraNumbers.join(', ')}`);

  const extraModifiers = validateGroundedModifiers({ ...result, slides }, sourceText);
  if (extraModifiers.length) {
    errors.push(`kata atau penegasan baru yang tidak ada di teks input: ${extraModifiers.join(', ')}`);
  }

  errors.push(...validateEntityContext({ ...result, slides }, sourceText));
  errors.push(...validateComparisonCompleteness({ ...result, slides }, sourceText));
  errors.push(...validateModeSubjectShift({ ...result, slides }, sourceText));

  return { errors: [...new Set(errors)], slides, caption, hashtags };
}

function promptFor(text, requestedSlideCount) {
  const optionalContext = requestedSlideCount === 5
    ? '- Slide 4 = KONTEKS / DETAIL TAMBAHAN. Body 10–16 kata dan points wajib [].\n'
    : '';

  return `MODE: GENERATE DARI TEKS — TRANSFORM ONLY.\n\nTEKS INPUT PENGGUNA:\n<<<TEXT_INPUT>>>\n${text}\n<<<END_TEXT_INPUT>>>\n\nTUGAS:\nSusun teks input menjadi carousel AI Ads Lab berbahasa Indonesia yang rapi. Anda BUKAN peneliti dan BUKAN mesin pencari. Jangan browsing, jangan memakai pengetahuan internal, dan jangan menambahkan fakta dari luar teks input. Anda hanya boleh meringkas, memparafrasekan, mengurutkan, dan memperjelas informasi yang memang tertulis pada TEXT_INPUT.\n\nSTRUKTUR WAJIB:\n- Total HARUS tepat ${requestedSlideCount} slide. Jangan membuat slide tambahan.\n- Slide 1 = HOOK. HANYA judul besar 7–10 kata yang padat, jelas, dan menarik tanpa clickbait berlebihan. body wajib "" dan points wajib [].\n- Slide 2 = FAKTA UTAMA. Body 8–14 kata + 2–3 bullet. Setiap bullet 3–7 kata dan membawa informasi berbeda.\n- Slide 3 = DETAIL / HAL PENTING. Body 8–14 kata + 2–3 bullet. Setiap bullet 3–7 kata. Jangan mengulang slide 2.\n${optionalContext}- Slide terakhir = PENUTUP / KESIMPULAN. Body 14–18 kata. points wajib []. Jangan sekadar mengulang hook.\n\nATURAN KERAS:\n- Tidak boleh menambah fakta, angka, tanggal, nama, lokasi, fitur, manfaat, sebab-akibat, opini, prediksi, atau status peluncuran yang tidak ada di teks input.\n- Nama brand, produk, model, mode, fitur, angka, persentase, tanggal, dan tingkat kepastian harus dipertahankan maknanya. Jangan menukar jenis entitas: jika teks menyebut sesuatu sebagai MODE, jangan menyebutnya MODEL; jika sesuatu adalah MODEL, jangan menyebutnya MODE.\n- Kata kerja status dan tingkat kepastian harus setara dengan TEXT_INPUT. Jika sumber menulis "memperkenalkan", jangan ubah menjadi "meluncurkan"; jika sumber menulis "dapat", jangan menaikkan menjadi "menjanjikan" atau klaim yang lebih tegas.\n- Pertahankan subjek setiap fakta. Fakta tentang kemampuan MODEL harus tetap milik MODEL, jangan dipindahkan menjadi kemampuan/target MODE atau fitur.\n- Contoh penggunaan tetap ditulis sebagai contoh penggunaan; jangan diubah menjadi fitur, kemampuan, manfaat, dukungan, atau integrasi baru.\n- Jangan mengubah contoh/konteks menjadi relasi baru seperti dibuat untuk, dirancang untuk, cocok untuk, mendukung, ditujukan untuk, atau bertujuan untuk kecuali relasi itu memang tertulis pada subjek yang sama.\n- Jika TEXT_INPUT menyebut "peningkatan kecepatan ini ditujukan...", subjek itu harus tetap peningkatan kecepatan; jangan ubah menjadi "Mode ini ditujukan..." atau "[nama model] ditujukan...".\n- Jangan membuat atribusi baru. Kesimpulan naratif dari TEXT_INPUT tidak boleh diubah menjadi "perusahaan/brand menegaskan, mengklaim, atau menyebut" kecuali TEXT_INPUT memang menyatakannya.\n- Jangan menambahkan kata penilaian seperti signifikan, efektif, optimal, instan, terintegrasi, unggul, terbaik, sempurna, otomatis, efisiensi, produktivitas, kunci, atau real-time jika tidak tertulis pada TEXT_INPUT.\n- Judul maksimal 10 kata.\n- Nilai section adalah LABEL KECIL yang sudah ditampilkan renderer. Jangan memakai ulang label section sebagai judul besar.\n- Judul besar WAJIB spesifik pada objek/fakta dari TEXT_INPUT. Jangan gunakan judul generik seperti "Hook", "Fakta Utama", "Detail", "Detail Penting", "Hal Penting", "Konteks", "Penutup", "Kesimpulan", atau variasinya.\n- Satu fakta utama cukup muncul sekali. Jika angka/klaim utama sudah dipakai di judul, body wajib memberi konteks berbeda dan jangan mengulang angka/klaim yang sama.\n- Jika klaim angka utama sudah dipakai di hook, judul slide 2 WAJIB mengambil angle lain dari TEXT_INPUT dan tidak mengulang angka/klaim tersebut dengan susunan kata berbeda.\n- Judul adalah angle spesifik slide, bukan salinan body. Body harus menambahkan konteks baru dan tidak mengulang ide judul.\n- Bullet harus singkat, natural, spesifik, dan bersumber dari TEXT_INPUT. Hindari bullet generik seperti "kerja lebih cepat" atau "peningkatan efisiensi proses"; gunakan fakta/konteks konkret yang memang disebut pada teks.\n- Bullet tidak boleh mengulang body atau bullet lain pada slide yang sama.\n- Nama media/publisher yang hanya menjadi sumber berita jangan dijadikan bullet seperti "Diklaim oleh X"; bullet harus berisi substansi berita.\n- Jika TEXT_INPUT menamai sebuah mode, gunakan urutan Bahasa Indonesia "Mode [nama]", bukan "[nama] Mode".\n- Jika sumber menyebut perbandingan lengkap seperti "14 kali lebih cepat", jangan memotongnya menjadi "14 kali".\n- Jangan memberi judul seperti "Manfaat/Kemampuan/Aplikasi [mode]" lalu mengisinya dengan fakta yang sebenarnya milik MODEL.\n- Semua judul antar-slide harus berbeda.\n- Jangan mengulang satu fakta dengan susunan kata berbeda pada slide 2 dan 3. Penutup boleh merangkum, tetapi jangan menyalin kalimat sebelumnya.\n- Penutup harus mengikuti kesimpulan TEXT_INPUT tanpa menaikkan tingkat kepastian dan tanpa mengubahnya menjadi pernyataan resmi perusahaan.\n- Penutup tidak boleh menggeneralisasi ke persaingan AI, tren industri, pasar, atau real-time jika konteks itu tidak tertulis di TEXT_INPUT.\n- Bullet jangan diawali simbol • karena renderer akan menambah tanda bullet sendiri.\n- Gunakan Bahasa Indonesia natural. Istilah resmi/brand boleh dipertahankan.\n- Caption WAJIB ${CAPTION_MIN_WORDS}–${CAPTION_MAX_WORDS} kata, 1–2 kalimat. Langsung sebut inti berita, klaim utama, lalu satu konteks penting. Jangan CTA, jangan filler, jangan mengulang semua isi slide.\n- Hashtag WAJIB ${HASHTAG_MIN}–${HASHTAG_MAX} item, spesifik pada objek/topik yang memang ada di teks input.\n\nKembalikan HANYA JSON dengan bentuk:\n{\"topic\":\"judul/topik singkat\",\"caption\":\"...\",\"hashtags\":[\"#...\"],\"slides\":[{\"section\":\"HOOK\",\"title\":\"...\",\"body\":\"\",\"points\":[]},{\"section\":\"FAKTA UTAMA\",\"title\":\"...\",\"body\":\"...\",\"points\":[\"...\",\"...\"]},{\"section\":\"DETAIL\",\"title\":\"...\",\"body\":\"...\",\"points\":[\"...\",\"...\"]}${requestedSlideCount === 5 ? ',{\"section\":\"KONTEKS\",\"title\":\"...\",\"body\":\"...\",\"points\":[]}' : ''},{\"section\":\"PENUTUP\",\"title\":\"...\",\"body\":\"...\",\"points\":[]}]} `;
}

function buildContent(parsed, slides) {
  const first = slides[0];
  const last = slides.at(-1);
  const middle = slides.slice(1, -1);
  return {
    focus: {
      masalah: first?.body || parsed.topic,
      penyebab: middle[0]?.body || first?.body || parsed.topic,
      solusi: middle[1]?.body || middle[0]?.body || parsed.topic,
      hasil: last?.body || parsed.topic
    },
    topic: clean(parsed.topic),
    hook: clean(first?.title || parsed.topic),
    body: middle.map(slide => [slide.body, ...slide.points].filter(Boolean).join(' • ')).join('\n'),
    caption: clean(parsed.caption),
    hashtags: normalizeHashtags(parsed.hashtags),
    cta: clean(last?.title || 'Kesimpulan'),
    trendKeywordsUsed: [],
    content_angle: clean(parsed.topic),
    primary_tool: 'teks pengguna',
    hook_pattern: 'text-input-hook',
    verificationStatus: 'text_input_only',
    unsupportedClaims: [],
    slides
  };
}

async function compose({ text, client } = {}) {
  const sourceText = validateInputText(text);
  const requestedSlideCount = targetSlideCount(sourceText);
  if (!client) config.validateAiConfig();
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const messages = [
    { role: 'system', content: 'Anda editor layout carousel Indonesia dalam mode transform-only. Fakta hanya boleh berasal dari teks pengguna yang diberikan.' },
    { role: 'user', content: promptFor(sourceText, requestedSlideCount) }
  ];

  let parsed = shapeParsed(parseOutput(await openai.chat.completions.create({
    model: config.aiModel,
    messages,
    response_format: { type: 'json_object' }
  })), requestedSlideCount);

  for (let repair = 0; repair <= MAX_REPAIRS; repair += 1) {
    const checked = validateResult(parsed, sourceText, requestedSlideCount);
    if (!checked.errors.length) return buildContent(parsed, checked.slides);
    if (repair === MAX_REPAIRS) {
      throw Object.assign(new Error(`Generate dari Teks belum lolos pengecekan: ${checked.errors[0]}`), {
        status: 422,
        validationErrors: checked.errors
      });
    }
    const targetedRepair = buildRepairGuidance(checked.errors);
    parsed = shapeParsed(parseOutput(await openai.chat.completions.create({
      model: config.aiModel,
      messages: [
        ...messages,
        { role: 'assistant', content: JSON.stringify(parsed) },
        {
          role: 'user',
          content: `Perbaiki JSON tadi TANPA menambah informasi dari luar TEXT_INPUT. PERBAIKAN WAJIB BERDASARKAN ERROR SAAT INI: ${targetedRepair} Masalah lengkap: ${checked.errors.join('; ')}. Jangan sekadar mengganti satu kata bila kalimatnya bergantung pada klaim yang ditolak; tulis ulang field tersebut dari fakta yang benar-benar ada di TEXT_INPUT. Total harus tepat ${requestedSlideCount} slide. Slide 1 WAJIB hanya judul hook 7–10 kata dengan body "" dan points []; slide 2–3 body 8–14 kata dengan 2–3 bullet berisi 3–7 kata; ${requestedSlideCount === 5 ? 'slide 4 body 10–16 kata tanpa bullet; ' : ''}slide terakhir body 14–18 kata tanpa bullet. Caption harus ${CAPTION_MIN_WORDS}–${CAPTION_MAX_WORDS} kata dan hashtag ${HASHTAG_MIN}–${HASHTAG_MAX} item. Label section hanya untuk label kecil; judul besar harus spesifik. Jika angka/klaim utama sudah ada di hook atau judul, field berikutnya harus memberi konteks berbeda tanpa mengulang klaim itu. Bullet harus berupa fakta/konteks konkret dari TEXT_INPUT, bukan filler generik atau atribusi publisher seperti "Diklaim oleh X". Pertahankan subjek asli: kemampuan model tetap milik model dan jangan dipindah ke mode/fitur; relasi yang subjeknya "peningkatan kecepatan" tidak boleh dipindah ke mode atau model. Gunakan urutan "Mode [nama]", bukan "[nama] Mode". Pertahankan perbandingan lengkap seperti "14 kali lebih cepat". Pertahankan kata kerja status dan tingkat kepastian; jangan mengubah "memperkenalkan" menjadi "meluncurkan" atau "dapat" menjadi "menjanjikan" jika TEXT_INPUT tidak memakai makna itu. Penutup jangan membuat konteks baru seperti persaingan AI, tren industri, pasar, atau real-time bila tidak ada di TEXT_INPUT. Jangan membuat atribusi baru seperti perusahaan menegaskan atau mengklaim jika TEXT_INPUT tidak mengatakan itu. Jangan menyalin satu fakta yang sama ke slide 2 dan 3. Pertahankan jenis entitas, hubungan fakta, nama, angka, dan tingkat kepastian dari teks input. Kembalikan JSON lengkap saja.`
        }
      ],
      response_format: { type: 'json_object' }
    })), requestedSlideCount);
  }

  throw Object.assign(new Error('Generate dari Teks gagal disusun.'), { status: 422 });
}

module.exports = {
  compose,
  validateInputText,
  validateResult,
  normalizeSlides,
  validateGroundedNumbers,
  validateGroundedModifiers,
  buildRepairGuidance,
  normalizeHashtags,
  genericSlideTitle,
  extractTypedEntities,
  attributionOnlyPoint,
  validateEntityContext,
  validateComparisonCompleteness,
  validateModeSubjectShift,
  duplicateSlideCopy,
  targetSlideCount,
  shapeSlides,
  buildContent,
  MIN_TEXT_CHARS,
  MAX_TEXT_CHARS,
  FIVE_SLIDE_MIN_WORDS,
  CAPTION_MIN_WORDS,
  CAPTION_MAX_WORDS,
  HASHTAG_MIN,
  HASHTAG_MAX
};