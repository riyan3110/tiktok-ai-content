const OpenAI = require('openai');
const config = require('../config');
const base = require('./textInputComposerBase');

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const normalized = value => clean(value).toLocaleLowerCase('id-ID').replace(/[^a-z0-9%.,\s-]/g, ' ').replace(/\s+/g, ' ').trim();
const escapeRegExp = value => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CONTEXT_RULES = `ATURAN TAMBAHAN KHUSUS GENERATE DARI TEKS:\n- Nama media/publisher yang hanya menjadi sumber berita (misalnya pola “Menurut X”) bukan fakta isi. Jangan jadikan bullet seperti “Diklaim oleh X”.\n- Jika TEXT_INPUT menamai sebuah mode, gunakan urutan Bahasa Indonesia “Mode [nama]”, bukan “[nama] Mode”.\n- Jangan menyebut mode sebagai model atau model sebagai mode.\n- Jangan memberi judul “Manfaat/Kemampuan/Aplikasi [mode]” lalu mengisinya dengan fakta yang sebenarnya milik model.\n- Pertahankan perbandingan lengkap. Jika sumber menyebut “14 kali lebih cepat”, jangan dipotong menjadi “14 kali”.\n- Bullet harus berisi substansi yang masih berada dalam konteks judul slide.`;

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

function repairSafeWording(content, sourceText) {
  if (!content || !Array.isArray(content.slides)) return content;
  const { modes } = extractTypedEntities(sourceText);
  const slides = content.slides.map(slide => ({ ...slide, points: Array.isArray(slide.points) ? [...slide.points] : [] }));
  for (const slide of slides) {
    for (const mode of modes) {
      const key = escapeRegExp(mode);
      slide.title = clean(slide.title).replace(new RegExp(`\\b${key}\\s+Mode\\b`, 'gi'), `Mode ${mode}`);
    }
  }
  return { ...content, hook: slides[0]?.title || content.hook, slides };
}

function contextIssues(content, sourceText) {
  const issues = [];
  const { modes, models } = extractTypedEntities(sourceText);
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const visible = [content?.topic, content?.caption, ...slides.flatMap(slide => [slide?.title, slide?.body, ...(slide?.points || [])])].filter(Boolean).join(' ');

  slides.forEach((slide, slideIndex) => {
    (slide.points || []).forEach((point, pointIndex) => {
      if (attributionOnlyPoint(point)) issues.push(`slide ${slideIndex + 1} bullet ${pointIndex + 1}: publisher/sumber tidak boleh menjadi bullet isi`);
    });
  });

  for (const mode of modes) {
    const key = escapeRegExp(mode);
    if (new RegExp(`\\bmodel\\s+${key}\\b|\\b${key}\\s+(?:adalah\\s+|merupakan\\s+)?model\\b`, 'i').test(visible)) {
      issues.push(`${mode} adalah mode, bukan model`);
    }
    if (new RegExp(`\\b${key}\\s+Mode\\b`, 'i').test(visible)) issues.push(`gunakan “Mode ${mode}”, bukan “${mode} Mode”`);
    for (const slide of slides) {
      const title = clean(slide.title);
      const detail = [slide.body, ...(slide.points || [])].filter(Boolean).join(' ');
      const framedAsModeBenefit = new RegExp(`(?:\\bmanfaat\\b|\\bkemampuan\\b|\\bfitur\\b|\\baplikasi\\b).*\\b${key}\\b|\\b${key}\\b.*(?:\\bmanfaat\\b|\\bkemampuan\\b|\\bfitur\\b|\\baplikasi\\b)`, 'i').test(title);
      if (framedAsModeBenefit && /\bmodel\b/i.test(detail)) issues.push(`judul slide membingkai fakta model sebagai manfaat/kemampuan Mode ${mode}`);
    }
  }
  for (const model of models) {
    const key = escapeRegExp(model);
    if (new RegExp(`\\bmode\\s+${key}\\b|\\b${key}\\s+(?:adalah\\s+|merupakan\\s+)?mode\\b`, 'i').test(visible)) {
      issues.push(`${model} adalah model, bukan mode`);
    }
  }

  const comparisons = [...clean(sourceText).matchAll(/\b(\d+(?:[.,]\d+)?)\s+kali\s+lebih\s+([a-z]+)\b/gi)];
  const fields = [content?.topic, content?.caption, ...slides.flatMap(slide => [slide?.title, slide?.body, ...(slide?.points || [])])].map(clean).filter(Boolean);
  for (const match of comparisons) {
    const number = match[1];
    const adjective = match[2];
    const short = new RegExp(`\\b${escapeRegExp(number)}\\s+kali\\b`, 'i');
    const complete = new RegExp(`\\b${escapeRegExp(number)}\\s+kali\\s+lebih\\s+${escapeRegExp(adjective)}\\b`, 'i');
    if (fields.some(field => short.test(field) && !complete.test(field))) issues.push(`perbandingan “${number} kali lebih ${adjective}” tidak boleh dipotong menjadi “${number} kali”`);
  }
  return [...new Set(issues)];
}

function contextualClient(rawClient, retryIssues = []) {
  return {
    chat: {
      completions: {
        create(params = {}) {
          const extra = retryIssues.length ? `\nMasalah konteks pada hasil sebelumnya: ${retryIssues.join('; ')}` : '';
          return rawClient.chat.completions.create({
            ...params,
            messages: [...(params.messages || []), { role: 'system', content: `${CONTEXT_RULES}${extra}` }]
          });
        }
      }
    }
  };
}

async function compose({ text, client } = {}) {
  const sourceText = base.validateInputText(text);
  if (!client) config.validateAiConfig();
  const rawClient = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let retryIssues = [];
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const content = repairSafeWording(await base.compose({ text: sourceText, client: contextualClient(rawClient, retryIssues) }), sourceText);
      const issues = contextIssues(content, sourceText);
      if (!issues.length) return content;
      retryIssues = issues;
      lastError = Object.assign(new Error(`Generate dari Teks belum lolos konteks: ${issues[0]}`), { status: 422, validationErrors: issues });
    } catch (error) {
      if (error?.status !== 422) throw error;
      lastError = error;
      retryIssues = Array.isArray(error.validationErrors) && error.validationErrors.length ? error.validationErrors : [error.message];
    }
  }
  throw lastError || Object.assign(new Error('Generate dari Teks gagal menjaga konteks sumber.'), { status: 422 });
}

module.exports = {
  ...base,
  compose,
  extractTypedEntities,
  attributionOnlyPoint,
  contextIssues,
  repairSafeWording
};
