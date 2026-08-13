from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch target: {label}')
    return text.replace(old, new, 1)

# Renderer: all changes are gated by verificationStatus=text_input_only.
p = Path('src/services/images.js')
s = p.read_text()
s = replace_once(s,
    "const WATERMARK_Y = 270;",
    "const WATERMARK_Y = 270;\nconst TEXT_INPUT_HOOK_Y = 680;",
    'hook y constant')
s = replace_once(s,
    "function buildStructuredLayout(slide, index, total, format = '') {\n  const tutorial = /tutorial/i.test(format) || /LANGKAH/i.test(slide.section);",
    "function buildStructuredLayout(slide, index, total, format = '', options = {}) {\n  const textInputOnly = options.textInputOnly === true;\n  const tutorial = !textInputOnly && (/tutorial/i.test(format) || /LANGKAH/i.test(slide.section));",
    'structured options')
s = replace_once(s,
    "      const clean = String(point).replace(/^[-•*\\d.)\\s]+/, '').trim();",
    "      const clean = String(point).replace(textInputOnly ? /^(?:[-•*]\\s*|\\d+[.)]\\s+)/ : /^[-•*\\d.)\\s]+/, '').trim();",
    'point cleanup')
s = replace_once(s,
    "    isOnlyTitle: Boolean(slide.title && !slide.body && !points.length), total",
    "    isOnlyTitle: Boolean(slide.title && !slide.body && !points.length),\n    textInputHook: Boolean(textInputOnly && index === 0 && slide.title && !slide.body && !points.length), total",
    'text input hook flag')
s = replace_once(s,
    "function fitStructuredSlides(input, format = '') {",
    "function fitStructuredSlides(input, format = '', options = {}) {",
    'fit options')
s = replace_once(s,
    "      return validateVisualLayout(buildStructuredLayout(slide, index, normalized.length, format));",
    "      return validateVisualLayout(buildStructuredLayout(slide, index, normalized.length, format, options));",
    'fit build options')
s = replace_once(s,
    "    // Do not summarize or bulletize copy that already fits the native canvas.\n    const slides = fitStructuredSlides(content.slides, content.contentFormat);",
    "    // Generate dari Teks has its own fixed carousel structure. Keep its hook\n    // and bullets independent from the UI format selector without changing URL mode.\n    const textInputOnly = content.verificationStatus === 'text_input_only';\n    const layoutOptions = { textInputOnly };\n    // Do not summarize or bulletize copy that already fits the native canvas.\n    const slides = fitStructuredSlides(content.slides, content.contentFormat, layoutOptions);",
    'build layout options')
s = replace_once(s,
    "    return validateCarouselLayouts(slides.map((slide, index) => buildStructuredLayout(slide, index, slides.length, content.contentFormat)));",
    "    return validateCarouselLayouts(slides.map((slide, index) => buildStructuredLayout(slide, index, slides.length, content.contentFormat, layoutOptions)));",
    'build map options')
s = replace_once(s,
    "    let y = layout.isOnlyTitle ? Math.round(Math.max(CONTENT_TOP, (CONTENT_TOP + CONTENT_BOTTOM - layout.fit.height) / 2)) : startY;",
    "    let y = layout.isOnlyTitle\n      ? (layout.textInputHook ? TEXT_INPUT_HOOK_Y : Math.round(Math.max(CONTENT_TOP, (CONTENT_TOP + CONTENT_BOTTOM - layout.fit.height) / 2)))\n      : startY;",
    'hook render position')
p.write_text(s)

# Composer: stricter context fidelity for pasted text only.
p = Path('src/services/textInputComposer.js')
s = p.read_text()
marker = "function duplicateSlideCopy(slide = {}) {"
helpers = r'''function escapeRegExp(value) {
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

'''
if 'function extractTypedEntities(sourceText)' not in s:
    s = replace_once(s, marker, helpers + marker, 'context helpers')

old = """      slide.points.forEach((point, pointIndex) => {\n        const count = words(point).length;\n        if (count < 3 || count > 7) {\n          errors.push(`slide ${index + 1} bullet ${pointIndex + 1}: target 3–7 kata`);\n        }\n      });"""
new = """      slide.points.forEach((point, pointIndex) => {\n        const count = words(point).length;\n        if (count < 3 || count > 7) {\n          errors.push(`slide ${index + 1} bullet ${pointIndex + 1}: target 3–7 kata`);\n        }\n        if (attributionOnlyPoint(point)) {\n          errors.push(`slide ${index + 1} bullet ${pointIndex + 1}: sumber/publisher tidak boleh dijadikan bullet isi`);\n        }\n      });"""
s = replace_once(s, old, new, 'publisher bullet guard')

old = """  const extraModifiers = validateGroundedModifiers({ ...result, slides }, sourceText);\n  if (extraModifiers.length) {\n    errors.push(`kata atau penegasan baru yang tidak ada di teks input: ${extraModifiers.join(', ')}`);\n  }\n\n  return { errors: [...new Set(errors)], slides, caption, hashtags };"""
new = """  const extraModifiers = validateGroundedModifiers({ ...result, slides }, sourceText);\n  if (extraModifiers.length) {\n    errors.push(`kata atau penegasan baru yang tidak ada di teks input: ${extraModifiers.join(', ')}`);\n  }\n\n  errors.push(...validateEntityContext({ ...result, slides }, sourceText));\n  errors.push(...validateComparisonCompleteness({ ...result, slides }, sourceText));\n\n  return { errors: [...new Set(errors)], slides, caption, hashtags };"""
s = replace_once(s, old, new, 'context validators')

old = '- Bullet tidak boleh mengulang body atau bullet lain pada slide yang sama.\\n- Semua judul antar-slide harus berbeda.'
new = '- Bullet tidak boleh mengulang body atau bullet lain pada slide yang sama.\\n- Nama media/publisher yang hanya menjadi sumber berita jangan dijadikan bullet seperti "Diklaim oleh X"; bullet harus berisi substansi berita.\\n- Jika TEXT_INPUT menamai sebuah mode, gunakan urutan Bahasa Indonesia "Mode [nama]", bukan "[nama] Mode".\\n- Jika sumber menyebut perbandingan lengkap seperti "14 kali lebih cepat", jangan memotongnya menjadi "14 kali".\\n- Jangan memberi judul seperti "Manfaat/Kemampuan/Aplikasi [mode]" lalu mengisinya dengan fakta yang sebenarnya milik MODEL.\\n- Semua judul antar-slide harus berbeda.'
s = replace_once(s, old, new, 'main prompt context rules')

old = 'Bullet harus berupa fakta/konteks konkret dari TEXT_INPUT, bukan filler generik. Pertahankan subjek asli: kemampuan model tetap milik model dan jangan dipindah ke mode/fitur.'
new = 'Bullet harus berupa fakta/konteks konkret dari TEXT_INPUT, bukan filler generik atau atribusi publisher seperti "Diklaim oleh X". Pertahankan subjek asli: kemampuan model tetap milik model dan jangan dipindah ke mode/fitur. Gunakan urutan "Mode [nama]", bukan "[nama] Mode". Pertahankan perbandingan lengkap seperti "14 kali lebih cepat".'
s = replace_once(s, old, new, 'repair prompt context rules')

old = """  genericSlideTitle,\n  duplicateSlideCopy,"""
new = """  genericSlideTitle,\n  extractTypedEntities,\n  attributionOnlyPoint,\n  validateEntityContext,\n  validateComparisonCompleteness,\n  duplicateSlideCopy,"""
s = replace_once(s, old, new, 'exports')
p.write_text(s)

# Regression test for the exact production failures seen in the screenshots.
p = Path('test/text-input-context-render-regression.test.js')
p.write_text(r'''const test = require('node:test');
const assert = require('node:assert/strict');
const composer = require('../src/services/textInputComposer');
const images = require('../src/services/images');

const source = 'OpenAI memperkenalkan mode baru bernama Ultrafast untuk GPT-5.6 Sol. Mode ini membuat GPT-5.6 Sol bekerja hingga 14 kali lebih cepat dibanding penggunaan biasa. GPT-5.6 Sol sendiri merupakan model unggulan untuk coding, riset, keamanan siber, sains, dan desain.';

test('context guard catches publisher bullet, mode/model swap, and cut comparison', () => {
  assert.equal(composer.attributionOnlyPoint('Diklaim oleh TechCrunch'), true);
  const bad = {
    topic: 'Ultrafast', caption: '', slides: [
      { title: 'Ultrafast Mode Mempercepat GPT-5.6 Sol 14 Kali', body: '', points: [] },
      { title: 'Aplikasi dan Manfaat Ultrafast', body: 'Untuk pekerjaan kompleks.', points: ['Model dirancang untuk keamanan siber'] },
      { title: 'Persaingan AI', body: 'Kecepatan model Ultrafast semakin penting.', points: [] }
    ]
  };
  const issues = [
    ...composer.validateEntityContext(bad, source),
    ...composer.validateComparisonCompleteness(bad, source)
  ].join(' | ');
  assert.match(issues, /Mode Ultrafast|bukan model|mencampur fakta model/i);
  assert.match(issues, /14 kali lebih cepat/i);
});

test('text-input renderer raises hook and preserves bullet semantics', () => {
  const slides = [
    { section: 'HOOK', title: 'Mode Ultrafast Bikin GPT-5.6 Sol Lebih Cepat', body: '', points: [] },
    { section: 'FAKTA UTAMA', title: 'Kecepatan Mode Ultrafast', body: 'Mode ini mempercepat GPT-5.6 Sol pada tugas kompleks.', points: ['14 kali lebih cepat', 'Untuk coding dan riset'] },
    { section: 'DETAIL', title: 'Respons untuk Tugas Kompleks', body: 'Kecepatan membantu pekerjaan kompleks terasa lebih responsif.', points: ['Agen AI butuh respons cepat', 'Riset termasuk contoh penggunaan'] },
    { section: 'PENUTUP', title: 'Kecepatan Makin Penting', body: 'Kecepatan menjalankan model semakin penting bagi aplikasi dan agen AI yang membutuhkan respons hampir real-time.', points: [] }
  ];
  const textLayouts = images.buildSlideLayouts({ slides, contentFormat: 'Tutorial langkah', verificationStatus: 'text_input_only' });
  assert.equal(textLayouts[0].textInputHook, true);
  assert.equal(textLayouts[1].content.points[0].text, '• 14 kali lebih cepat');
  assert.equal(textLayouts[1].content.points[1].text, '• Untuk coding dan riset');
  const hookSvg = images.renderLayout(textLayouts[0], 1, 4, { enabled: false }, {});
  assert.match(hookSvg, /y="680"/);

  const urlLayouts = images.buildSlideLayouts({ slides, contentFormat: 'Tutorial langkah', verificationStatus: 'source_based' });
  assert.equal(urlLayouts[0].textInputHook, false);
  assert.match(urlLayouts[1].content.points[0].text, /^1\./);
});
''')
