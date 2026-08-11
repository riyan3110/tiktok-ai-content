const ENGLISH_MARKERS = new Set([
  'a','an','the','and','or','but','is','are','was','were','be','been','being','of','to','in','on','for','with','from','as','by','that','this','these','those','its','their','his','her','has','have','had','will','would','can','could','should','may','might','during','about','over','amid','how'
]);
const INDONESIAN_MARKERS = new Set([
  'yang','dan','atau','adalah','merupakan','dari','untuk','dengan','pada','di','ke','ini','itu','sebagai','oleh','akan','bisa','dapat','telah','sudah','belum','lebih','juga','karena','agar','saat','ketika','dalam','menjadi','memiliki','menggunakan','dirilis','diluncurkan','tentang'
]);
const TOPIC_ANCHOR_IGNORE = new Set([
  'ai','api','cara','tips','fakta','tentang','terbaru','baru','update','2025','2026','model','fitur','teknologi','edukasi','tutorial','langkah','mengamankan','keamanan'
]);
const REFERENTIAL_CONTINUATION = /\b(?:the model|this model|the release|this release|the system|this system|the technology|this technology|the product|this product|model ini|rilis ini|sistem ini|teknologi ini|produk ini|fitur ini)\b/i;

let installed = false;

function tokens(value) {
  return String(value || '').toLocaleLowerCase('id-ID').match(/[a-z0-9]+/g) || [];
}

function namedTopicAnchors(topic) {
  const raw = String(topic || '').match(/[A-Za-z][A-Za-z0-9.-]*/g) || [];
  const anchors = raw
    .filter(token => /^[A-Z]/.test(token))
    .map(token => token.toLocaleLowerCase('id-ID').replace(/[^a-z0-9]/g, ''))
    .filter(token => token.length > 2 && !TOPIC_ANCHOR_IGNORE.has(token));
  return [...new Set(anchors)];
}

function likelyEnglishDisplay(value) {
  const list = tokens(value);
  if (list.length < 5) return false;
  const english = list.filter(token => ENGLISH_MARKERS.has(token)).length;
  const indonesian = list.filter(token => INDONESIAN_MARKERS.has(token)).length;
  return english >= 2 && english > indonesian && english / list.length >= 0.2;
}

function visibleLanguageErrors(content) {
  const errors = [];
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  slides.forEach((slide, slideIndex) => {
    const fields = [
      ['title', slide?.title],
      ['body', slide?.body],
      ...(Array.isArray(slide?.points) ? slide.points.map((point, pointIndex) => [`point:${pointIndex}`, point]) : [])
    ];
    fields.forEach(([field, value]) => {
      if (likelyEnglishDisplay(value)) errors.push(`slide:${slideIndex}:${field}: copy tampil masih berupa kalimat bahasa Inggris; wajib dilokalkan ke bahasa Indonesia.`);
    });
  });
  [['hook', content?.hook], ['caption', content?.caption], ['cta', content?.cta]].forEach(([field, value]) => {
    if (likelyEnglishDisplay(value)) errors.push(`${field}: copy tampil masih berupa kalimat bahasa Inggris; wajib dilokalkan ke bahasa Indonesia.`);
  });
  return [...new Set(errors)];
}

function sentenceAnchorCount(sentence, anchors) {
  const set = new Set(tokens(sentence));
  return anchors.filter(anchor => set.has(anchor)).length;
}

function likelyPhotoCaption(sentence) {
  const text = String(sentence || '').trim();
  return /\b(?:speaks|speaking|appears|pictured|poses|stands|walks|arrives)\s+(?:during|at|on)\b/i.test(text)
    && /\b(?:conference|event|meeting|summit|headquarters|developer|california|new york|london)\b/i.test(text);
}

function sanitizeSourceTextForManualTopic(text, topic) {
  const anchors = namedTopicAnchors(topic);
  if (anchors.length < 2) return String(text || '');
  const segments = String(text || '').replace(/\r/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (segments.length < 3) return String(text || '');

  const strong = segments
    .map((segment, index) => ({ index, matches: sentenceAnchorCount(segment, anchors) }))
    .filter(item => item.matches >= Math.min(2, anchors.length))
    .map(item => item.index);
  if (!strong.length) return String(text || '');

  const keep = new Set();
  strong.forEach(index => {
    keep.add(index);
    if (index > 0) keep.add(index - 1);
    if (index + 1 < segments.length) keep.add(index + 1);
  });

  const selected = [...keep].sort((a, b) => a - b).map(index => ({
    index,
    text: segments[index],
    strong: strong.includes(index)
  })).filter(item => {
    if (item.strong) return true;
    if (likelyPhotoCaption(item.text)) return false;
    const matches = sentenceAnchorCount(item.text, anchors);
    if (matches === 0 && !REFERENTIAL_CONTINUATION.test(item.text)) return false;
    if (!/[.!?]$/.test(item.text) && matches === 0) return false;
    return true;
  }).map(item => item.text);

  const cleaned = selected.join('\n').trim();
  return cleaned.length >= 120 ? cleaned : String(text || '');
}

function sanitizeSourcesForManualTopic(sources, topic) {
  if (!Array.isArray(sources)) return sources;
  sources.forEach(source => {
    const cleaned = sanitizeSourceTextForManualTopic(source?.text, topic);
    if (source && cleaned && cleaned !== source.text) source.text = cleaned;
  });
  return sources;
}

function install() {
  if (installed) return;
  const fallback = require('./manualSourceFallback');
  const roleGuard = require('./manualSourceRoleGuard');

  const originalValidateSourceContent = fallback.validateSourceContent;
  const originalNaturalCopyErrors = fallback.naturalCopyErrors;
  const originalRepairManualSourceRoles = roleGuard.repairManualSourceRoles;

  fallback.validateSourceContent = (content, sources = []) => [
    ...new Set([...originalValidateSourceContent(content, sources), ...visibleLanguageErrors(content)])
  ];
  fallback.naturalCopyErrors = content => [
    ...new Set([...originalNaturalCopyErrors(content), ...visibleLanguageErrors(content)])
  ];
  roleGuard.repairManualSourceRoles = async args => {
    const topic = args?.options?.requestedTopic || args?.generated?.topic || '';
    sanitizeSourcesForManualTopic(args?.sources, topic);
    return originalRepairManualSourceRoles(args);
  };

  installed = true;
}

module.exports = {
  install,
  likelyEnglishDisplay,
  visibleLanguageErrors,
  namedTopicAnchors,
  sanitizeSourceTextForManualTopic,
  sanitizeSourcesForManualTopic
};
