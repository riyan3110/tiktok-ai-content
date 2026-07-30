const OpenAI = require('openai');
const config = require('../config');

const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    focus: {
      type: 'object', additionalProperties: false,
      properties: {
        masalah: { type: 'string' }, penyebab: { type: 'string' },
        solusi: { type: 'string' }, hasil: { type: 'string' }
      },
      required: ['masalah', 'penyebab', 'solusi', 'hasil']
    },
    topic: { type: 'string' }, hook: { type: 'string' }, body: { type: 'string' },
    caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' },
    trendKeywordsUsed: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    result: { type: 'string' }, tip: { type: 'string' },
    content_angle: { type: 'string' }, primary_tool: { type: 'string' }, hook_pattern: { type: 'string' },
    slides: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'object', properties: {
      section: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, points: { type: 'array', items: { type: 'string' } }
    }, required: ['section', 'title', 'body', 'points'] } }
  },
  required: ['focus', 'topic', 'hook', 'body', 'caption', 'hashtags', 'cta', 'trendKeywordsUsed', 'content_angle', 'primary_tool', 'hook_pattern', 'slides']
};

const words = (value) => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalizedLine = (value) => String(value || '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
const MAX_REPAIR_ATTEMPTS = 2;

function mainSlideText(slide) {
  const clean = (value) => String(value || '')
    .split('\n')
    .filter(line => !/^\s*(?:footer|metadata|nomor\s+slide)\s*:/i.test(line))
    .map(line => line.replace(/^\s*(?:slide\s*\d+|langkah\s*\d+(?:\s*[–-]\s*\d+)?)\s*[:.)-]?\s*/i, ''))
    .join(' ');
  return [clean(slide.title), clean(slide.body), ...(slide.points || []).map(clean)].filter(Boolean).join(' ');
}

function slideWordLimit(slide, index, total) {
  // Structured slides are governed by the tighter per-field limits below.
  if (slide.title && (slide.body || slide.points.length)) return 55;
  if (index === 0 || /^(?:hook|pembuka)$/i.test(slide.section)) return 18;
  if (index === total - 1 || /^(?:penutup|cta)$/i.test(slide.section)) return 20;
  return /(?:penjelasan|langkah|solusi|proses|detail)/i.test(slide.section) || slide.points.length > 1 ? 45 : 35;
}

function numberedValues(body, label) {
  const pattern = new RegExp(`(?:^|\\n)\\s*${label}\\s*(\\d+)\\s*[:.)-]`, 'gi');
  return [...String(body || '').matchAll(pattern)].map((match) => Number(match[1]));
}

function validateContent(content, { format = 'Tutorial langkah' } = {}) {
  const errors = [];
  const strings = ['topic', 'hook', 'body', 'caption', 'cta'];
  if (!content || strings.some((key) => typeof content[key] !== 'string' || !content[key].trim()) ||
      !Array.isArray(content?.hashtags) || content.hashtags.some((tag) => typeof tag !== 'string')) {
    return ['Ada kolom wajib atau slide yang kosong.'];
  }
  if (!content.focus || ['masalah', 'penyebab', 'solusi', 'hasil'].some((key) => !String(content.focus[key] || '').trim())) {
    errors.push('Fokus utama (masalah, penyebab, solusi, hasil) belum lengkap.');
  }
  if (words(content.hook).length > 18) errors.push(`Slide 1 memiliki ${words(content.hook).length} kata, batas maksimal 18 kata.`);
  errors.push(...validateSlides(content.slides, { format }));

  const nonEmptyLines = content.body.split('\n').map((line) => line.trim()).filter(Boolean);
  const seen = new Set();
  for (const line of [content.hook, ...nonEmptyLines]) {
    const value = normalizedLine(line.replace(/^(?:solusi|langkah|penyebab)\s*\d*\s*[:.)-]?\s*/i, ''));
    if (value.length >= 12 && seen.has(value)) errors.push('Isi mengandung poin yang berulang.');
    seen.add(value);
  }

  for (const label of format === 'Masalah dan solusi' ? [] : ['solusi', 'langkah']) {
    const values = numberedValues(content.body, label);
    values.forEach((value, index) => { if (value !== index + 1) errors.push(`Urutan ${label} harus dimulai dari 1 dan berurutan.`); });
  }

  if (/tingkatkan strategi bisnis|gunakan pemasaran yang tepat|optimalkan penjualan/i.test(content.body)) {
    errors.push('Solusi masih generik dan belum berupa tindakan konkret.');
  }
  return [...new Set(errors)];
}

function normalizeSlides(slides) {
  if (!Array.isArray(slides)) return [];
  return slides.map((slide = {}) => {
    const lines = String(slide.body ?? slide.content ?? slide.text ?? slide.description ?? '')
      .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const suppliedPoints = Array.isArray(slide.points) ? slide.points.map(String).map(value => value.trim()).filter(Boolean) : [];
    // AI models regularly put a sentence followed by list-like lines in body.
    // Keep the sentence as prose and promote short, punctuation-free lines to
    // real points so the renderer never has to interpret raw line breaks.
    const candidates = lines.filter(line => words(line.replace(/^[-•*\d.)\s]+/, '')).length <= 7 && !/[.!?]$/.test(line));
    const promote = candidates.length > 1;
    const bodyLines = promote ? lines.filter(line => !candidates.includes(line)) : lines;
    const promoted = promote ? candidates.map(line => line.replace(/^[-•*\d.)\s]+/, '').trim()) : [];
    return {
      section: String(slide.section ?? slide.label ?? '').trim(),
      title: String(slide.title ?? slide.heading ?? '').replace(/\s*\n\s*/g, ' ').trim(),
      body: bodyLines.join(' ').trim(),
      points: [...suppliedPoints, ...promoted]
    };
  }).filter(slide => slide.title || slide.body || slide.points.length);
}

function cleanSolutionPoint(value) {
  return String(value).replace(/^\s*(?:[-•*]|(?:solusi\s*)?\d+[.)\s:-]+)\s*/i, '').trim();
}

/** Normalize the semantic structure separately from generic field cleanup. */
function normalizeProblemSolutionSlides(input) {
  const slides = normalizeSlides(input);
  const problems = [];
  const solutions = [];
  const other = [];
  for (const slide of slides) {
    const label = `${slide.section} ${slide.title}`;
    const isProblem = /masalah|problem/i.test(label);
    const isSolution = /solusi|solution/i.test(label);
    if (isProblem) problems.push({ ...slide, section: 'MASALAH' });
    else if (isSolution) {
      const listLines = slide.body.split(/\r?\n|\s*(?=(?:[-•*]|(?:solusi\s*)?\d+[.)])\s+)/i)
        .map(cleanSolutionPoint).filter(Boolean);
      const bodyLooksLikeList = listLines.length > 1 || /^(?:[-•*]|(?:solusi\s*)?\d+[.)])/i.test(slide.body.trim());
      const points = [...slide.points.map(cleanSolutionPoint), ...(bodyLooksLikeList ? listLines : [])].filter(Boolean);
      const body = bodyLooksLikeList ? '' : slide.body;
      if (!points.length && body && /(?:;|\n)/.test(body)) points.push(...body.split(/;|\n/).map(cleanSolutionPoint).filter(Boolean));
      const allPoints = points.length ? points : [];
      if (!allPoints.length) solutions.push({ ...slide, section: 'SOLUSI' });
      else for (let i = 0; i < allPoints.length; i += 3) solutions.push({ ...slide, section: 'SOLUSI', body: i ? '' : body, points: allPoints.slice(i, i + 3) });
    } else other.push(slide);
  }
  return [...other.filter(slide => /pembuka|hook/i.test(slide.section)), ...problems,
    ...solutions, ...other.filter(slide => !/pembuka|hook/i.test(slide.section))];
}

function sectionRange(section) {
  const match = String(section).match(/LANGKAH\s+(\d+)\s*(?:[–-]\s*(\d+))?/i);
  return match ? [Number(match[1]), Number(match[2] || match[1])] : null;
}

function validateSlides(input, { format = 'Tutorial langkah' } = {}) {
  if (!Array.isArray(input)) return ['Tahap normalisasi: response AI tidak memiliki array slides.'];
  const errors = [];
  input.forEach((raw, index) => {
    const slide = normalizeSlides([raw])[0];
    if (!slide) errors.push(`Slide ${index + 1} tidak memiliki title, body, atau points.`);
  });
  const slides = normalizeSlides(input);
  if (slides.length < 3) errors.push(`Tahap validasi: hanya ${slides.length} slide berisi; minimal 3 slide.`);
  if (slides.length > 5) errors.push(`Tahap validasi: ada ${slides.length} slide; maksimal 5 slide.`);
  slides.forEach((slide, index) => {
    if (words(slide.title).length > 12) errors.push(`Slide ${index + 1}: title maksimal 12 kata.`);
    if (words(slide.body).length > 24) errors.push(`Slide ${index + 1}: body maksimal 24 kata.`);
    if (slide.points.length > 3) errors.push(`Slide ${index + 1}: points maksimal 3 item.`);
    slide.points.forEach((point, pointIndex) => {
      if (words(point).length > 7) errors.push(`Slide ${index + 1}: point ${pointIndex + 1} maksimal 7 kata.`);
    });
    if (/\r|\n/.test(slide.title) || /\r|\n/.test(slide.body)) errors.push(`Slide ${index + 1}: line break mentah tidak boleh dirender.`);
    const count = words(mainSlideText(slide)).length;
    const limit = slideWordLimit(slide, index, slides.length);
    if (count > limit) errors.push(`Slide ${index + 1} memiliki ${count} kata, batas maksimal ${limit} kata.`);
  });
  if (format === 'Tutorial langkah') {
    let expected = 1;
    slides.forEach((slide, index) => {
      const range = sectionRange(slide.section);
      if (!range) return;
      if (range[0] !== expected || range[1] < range[0]) errors.push(`Slide ${index + 1}: urutan label ${slide.section} tidak sesuai; langkah berikutnya harus ${expected}.`);
      const numbers = [...`${slide.body}\n${slide.points.join('\n')}`.matchAll(/(?:^|\n)\s*(\d+)\s*[.)]/g)].map(match => Number(match[1]));
      if (numbers.length && (numbers[0] !== range[0] || numbers.at(-1) !== range[1] || numbers.some((number, i) => i && number !== numbers[i - 1] + 1))) {
        errors.push(`Slide ${index + 1}: label ${slide.section} tidak sesuai dengan nomor isi ${numbers.join(', ')}.`);
      }
      expected = range[1] + 1;
    });
  }
  if (format === 'Masalah dan solusi') {
    const problemIndex = slides.findIndex(slide => slide.section === 'MASALAH');
    const solutionIndex = slides.findIndex(slide => slide.section === 'SOLUSI');
    if (problemIndex < 0) errors.push('Format Masalah dan solusi tidak memiliki slide MASALAH.');
    if (solutionIndex < 0) errors.push('Format Masalah dan solusi tidak memiliki slide SOLUSI.');
    else if (problemIndex > solutionIndex) errors.push('Slide MASALAH harus berada sebelum slide SOLUSI.');
  }
  return errors;
}

function legacySlides(content) {
  return [
    { section: 'PEMBUKA', title: content.hook, body: '', points: [] },
    { section: 'PENJELASAN', title: content.topic, body: content.body, points: [] },
    { section: 'PENUTUP', title: content.cta, body: content.caption, points: [] }
  ];
}

function legacyProblemSolutionSlides(content) {
  const lines = String(content.body || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const problem = lines.find(line => /^MASALAH\s*:/i.test(line));
  const solutionPoints = lines.filter(line => /^SOLUSI\s*\d*\s*:/i.test(line))
    .map(line => cleanSolutionPoint(line.replace(/^SOLUSI\s*\d*\s*:/i, '')));
  return [
    { section: 'PEMBUKA', title: content.hook, body: '', points: [] },
    ...(problem ? [{ section: 'MASALAH', title: 'Masalah', body: problem.replace(/^MASALAH\s*:/i, '').trim(), points: [] }] : []),
    ...(solutionPoints.length ? [{ section: 'SOLUSI', title: 'Solusi yang bisa dilakukan', body: '', points: solutionPoints }] : []),
    { section: 'PENUTUP', title: content.cta, body: '', points: [] }
  ];
}

function normalizeLegacySolutionBody(body) {
  let number = 0;
  return String(body || '').replace(/(^|\n)(\s*)SOLUSI\s*\d*\s*:/gi, (_, start, spacing) => `${start}${spacing}SOLUSI ${++number}:`);
}

function parseOutput(response) {
  const output = response.choices?.[0]?.message?.content;
  if (!output) throw new Error(`Provider AI ${config.aiProvider || 'yang dipilih'} tidak mengembalikan konten`);
  try {
    const parsed = JSON.parse(output);
    Object.defineProperty(parsed, '_rawAiResponse', { value: output, enumerable: false });
    return parsed;
  } catch {
    console.error('[AI raw response][parsing gagal]', output);
    throw new Error(`Provider AI ${config.aiProvider || 'yang dipilih'} mengembalikan JSON yang tidak valid atau strukturnya tidak sesuai`);
  }
}

async function generateContent(previousTopics, options = {}, client) {
  if (options?.chat) { client = options; options = {}; }
  if (!client) config.validateAiConfig();
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const category = options.contentCategory || 'Iklan & UGC';
  const format = options.contentFormat || 'Tutorial langkah';
  const categoryDirections = {
    'Tutorial AI': 'Buat langkah nyata menggunakan tool AI.', 'Tips bisnis': 'Berikan tindakan bisnis spesifik dan realistis.',
    Produktivitas: 'Berikan tindakan kecil yang praktis.', 'Fakta unik': 'Gunakan fakta akurat tanpa klaim yang tidak pasti.',
    'Edukasi teknologi': 'Gunakan bahasa sederhana dan satu contoh yang mudah dipahami.', Motivasi: 'Gunakan motivasi yang membumi.',
    'Konten kreator': 'Berikan tindakan praktis untuk proses kreator.', 'Iklan & UGC': 'Fokus pada konsep atau produksi konten promosi.'
  };
  const source = options.topicSource === 'manual' ? `Gunakan topik pengguna: "${options.requestedTopic}" dan jangan mengubah inti topiknya.`
    : options.topicSource === 'trending' && options.requestedTopic ? `Gunakan topik tren: "${options.requestedTopic}".`
      : `Pilih topik baru dalam kategori "${category}".`;
  const specialStructure = format === 'Masalah dan solusi'
    ? 'Slide pertama ber-section MASALAH dengan title dan body singkat. Slide berikutnya ber-section SOLUSI; body kosong dan points berisi maksimal 3 tindakan. Gunakan bullet tanpa nomor; bila solusi lebih dari 3, lanjutkan pada slide SOLUSI berikutnya.'
    : format === 'Tutorial langkah'
      ? 'Gunakan default 3 slide: hook + hasil; satu slide LANGKAH PRAKTIS berisi 3–5 langkah bernomor dengan total maksimal 45 kata; lalu hasil akhir + tip relevan + CTA. Hanya pecah menjadi 4 slide untuk 6–7 langkah atau isi sedang, dan maksimal 5 untuk isi panjang. Gabungkan langkah terkait; jangan buat slide untuk satu kalimat pendek. Isi kolom result dan tip secara spesifik.'
      : 'Body berisi poin slide yang berurutan dan gabungkan poin yang saling berkaitan.';
  const categorizedKeywords = (options.trendReference?.keyword_categories || options.trendReference?.keywords?.map(keyword => ({ keyword, category: 'UMUM' })) || []).map(({ category, keyword }) => `[${category}] ${keyword}`).join(' | ');
  const trendDirection = options.trendReference ? `Referensi tren aktif memiliki tiga daftar terpisah. KEYWORD/HASHTAG BERKATEGORI: ${categorizedKeywords || 'tidak ada'}; gunakan hanya untuk memilih istilah dan konteks yang relevan. Sebelum menulis, baca topik dan kategori konten, lalu pilih nol sampai maksimal 3 keyword yang paling relevan. Prioritaskan kategori konten pengguna jika topik ambigu. Abaikan seluruh keyword dari kategori yang tidak sesuai dan keyword yang tidak berkaitan langsung; jangan mencampur lintas kategori hanya karena sedang tren dan jangan memaksakan tren bila tidak ada yang relevan. Gunakan ejaan keyword persis pada trendKeywordsUsed. Jangan mencampurkan ketiganya sebagai satu daftar. GAYA HOOK: ${(options.trendReference.trend_hooks || []).join(' | ') || 'tidak ada'}; gunakan hanya sebagai referensi kalimat pembuka, jangan menyalin hook mentah terus-menerus dan buat variasi yang natural. POLA KONTEN: ${(options.trendReference.trend_content_patterns || []).join(' | ') || 'tidak ada'}; gunakan hanya sebagai referensi struktur penyampaian. Jangan ubah inti topik atau membuat klaim tren tanpa dasar catatan: "${options.trendReference.notes || ''}".` : 'Tidak ada referensi tren aktif; isi trendKeywordsUsed dengan array kosong.';
  const history = (options.recentContents || []).map(item => `${item.content_angle || item.topic}; tool=${item.primary_tool || '-'}; hook=${item.hook_pattern || item.hook || '-'}; langkah=${item.body || '-'}; CTA=${item.cta || '-'}`).join(' || ');
  const diversity = category === 'Tutorial AI' && format === 'Tutorial langkah' ? `Sebelum memilih, susun minimal 8 kandidat angle yang berbeda dari: tutorial pemula, kesalahan umum, perbandingan tools, workflow praktis, fitur tersembunyi, masalah dan solusi, before-after, studi kasus, tips meningkatkan hasil, alternatif gratis. Pilih satu yang paling berbeda dari 15 riwayat. Variasikan ranah gambar, video, audio, produktivitas, penulisan, presentasi, bisnis, riset, desain, dan otomatisasi. Jangan gunakan tool yang muncul 2 kali dalam 10 riwayat kecuali topik manual. Simpan pilihan pada content_angle, nama aplikasi pada primary_tool, dan bentuk pembuka pada hook_pattern. ${options.rejectedAngle || ''} Riwayat: ${history || 'belum ada'}.` : `Tetapkan content_angle, primary_tool (boleh "tanpa tool"), dan hook_pattern yang spesifik. ${options.rejectedAngle || ''}`;
  const prompt = `${source} ${trendDirection} Referensi tren hanya tambahan gaya dan keyword, bukan alasan mengubah bahasan menjadi AI tools umum. ${diversity} Pertahankan inti topik dan kategori "${category}". ${categoryDirections[category] || 'Pastikan isi relevan dengan kategori khusus ini.'} Jangan memaksakan isi menjadi video iklan. Format "${format}". Sebelum menulis, tetapkan tepat satu fokus pada objek focus: satu masalah utama, penyebab utama, solusi utama, dan hasil yang diharapkan. Jangan campur masalah lain. ${specialStructure} Kembalikan 3–5 slides dengan schema konsisten {section,title,body,points}. Setiap slide hanya membahas satu ide. Title wajib satu judul natural (maksimal 12 kata), bukan gabungan beberapa judul. Body wajib satu atau dua kalimat bahasa Indonesia yang utuh dan alami (maksimal 24 kata), jangan menulis potongan seperti "Kewalahan pagi hilangkan motivasi" dan jangan menaruh daftar atau line break di body. Points wajib array terpisah, maksimal 3 item dan masing-masing 3–7 kata. Jangan mengulang title di body atau points. section tutorial memakai LANGKAH 1 atau rentang LANGKAH 2–3 yang sama dengan nomor di points; slide non-tutorial tidak memakai nomor. Slide pembuka/penutup boleh memakai section non-langkah. Gunakan kalimat langsung, mudah dipahami, tidak berulang, tanpa klaim berlebihan. Semua saran harus berupa tindakan konkret dan solusi harus menjawab masalah. Caption hanya merangkum slide tanpa klaim baru. Nomor selalu mulai 1 dan berurutan. Hindari topik lama: ${previousTopics.join(' | ') || 'belum ada'}. Hashtag diawali #. Field inti: {"required":["focus","topic","hook","body","caption","hashtags","cta","trendKeywordsUsed"]}. Kembalikan hanya JSON sesuai schema: ${JSON.stringify(schema)}`;
  const messages = [
    { role: 'system', content: 'Anda editor carousel TikTok Indonesia yang cermat. Utamakan satu fokus dan langkah konkret.' },
    { role: 'user', content: prompt }
  ];
  let content = parseOutput(await openai.chat.completions.create({ model: config.aiModel, messages, response_format: { type: 'json_object' } }));
  if (format === 'Masalah dan solusi') content.body = normalizeLegacySolutionBody(content.body);
  if (content.slides !== undefined) content.slides = format === 'Masalah dan solusi' ? normalizeProblemSolutionSlides(content.slides) : normalizeSlides(content.slides);
  const validationContent = value => value.slides === undefined
    ? { ...value, slides: format === 'Masalah dan solusi' ? normalizeProblemSolutionSlides(legacyProblemSolutionSlides(value)) : legacySlides(value) }
    : value;
  let errors = validateContent(validationContent(content), { format });
  for (let repair = 1; errors.length && repair <= MAX_REPAIR_ATTEMPTS; repair++) {
    console.error('[AI raw response][validasi awal gagal]', content._rawAiResponse);
    content = parseOutput(await openai.chat.completions.create({
      model: config.aiModel,
      messages: [...messages, { role: 'assistant', content: JSON.stringify(content) }, { role: 'user', content: `Perbaikan ${repair} dari ${MAX_REPAIR_ATTEMPTS}. Hasil belum lolos validasi: ${errors.join(' ')} ${repair === 1 ? 'Ringkas kalimat, hapus kata berulang, dan pertahankan makna utama.' : 'Susun ulang section, title, body, dan points sesuai struktur format; pindahkan daftar body ke points.'} Jika ada dua poin berbeda, pecah atau pindahkan poin kedua ke slide berikutnya. Tetap gunakan 3–5 slide. Pastikan solusi menjawab masalah dan caption tidak menambah klaim. Jangan mengulang kalimat hasil sebelumnya. Kembalikan JSON lengkap saja.` }],
      response_format: { type: 'json_object' }
    }));
    if (format === 'Masalah dan solusi') content.body = normalizeLegacySolutionBody(content.body);
    if (content.slides !== undefined) content.slides = format === 'Masalah dan solusi' ? normalizeProblemSolutionSlides(content.slides) : normalizeSlides(content.slides);
    errors = validateContent(validationContent(content), { format });
  }
  if (errors.length) {
    console.error('[AI raw response][validasi perbaikan gagal]', content._rawAiResponse);
    throw Object.assign(new Error(`Konten AI tidak lolos validasi: ${errors[0]}`), { status: 422, validationErrors: errors });
  }
  if (content.slides !== undefined) content.slides = normalizeSlides(content.slides);
  return content;
}

async function generateAngles(mainTopic, count, options = {}, client) {
  if (!client) config.validateAiConfig();
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [{ role: 'system', content: 'Anda adalah perencana konten TikTok Indonesia.' }, { role: 'user', content: `Buat tepat ${count} sudut pembahasan yang jelas berbeda untuk topik utama "${mainTopic}", kategori "${options.category}", format "${options.format}". Pastikan judul, hook, bahasan, caption, dan CTA nantinya dapat berbeda serta kemiripan isi di bawah 60%. Kembalikan hanya JSON {"angles":["..."]}.` }],
    response_format: { type: 'json_object' }
  });
  const parsed = parseOutput(response);
  return parsed.angles;
}

module.exports = { generateContent, generateAngles, validateContent, validateSlides, normalizeSlides, normalizeProblemSolutionSlides, numberedValues, mainSlideText, slideWordLimit, MAX_REPAIR_ATTEMPTS };
