const ENGLISH_MARKERS = new Set([
  'a','an','the','and','or','but','is','are','was','were','be','been','being','of','to','in','on','for','with','from','as','by','that','this','these','those','its','their','his','her','has','have','had','will','would','can','could','should','may','might','during','about','over','amid','how','which','whether','than'
]);
const ENGLISH_CONTENT_MARKERS = new Set([
  'launches','launched','launching','published','publishes','presented','presents','speaks','spoke','announced','announces','released','releases','seeks','rival','powerful','developers','developer','essay','lengthy','utopian','vision','course','topics','related','included','datacenters','government','regulation','stance','sets','apart','frontier','labs','proprietary','several','plans','involved','creation','ongoing','debate','competitors','grown','wary','dominance','went','online','same','day','argue','itself'
]);
const INDONESIAN_MARKERS = new Set([
  'yang','dan','atau','adalah','merupakan','dari','untuk','dengan','pada','di','ke','ini','itu','sebagai','oleh','akan','bisa','dapat','telah','sudah','belum','lebih','juga','karena','agar','saat','ketika','dalam','menjadi','memiliki','menggunakan','dirilis','diluncurkan','tentang','baru','terbaru','pengguna'
]);
const TOPIC_ANCHOR_IGNORE = new Set([
  'ai','api','cara','tips','fakta','tentang','terbaru','baru','update','2025','2026','model','fitur','teknologi','edukasi','tutorial','langkah','mengamankan','keamanan'
]);
const REFERENTIAL_CONTINUATION = /^(?:it|its|this|these|those|the\s+(?:model|release|system|technology|product|service|tool|app|application|browser|platform|feature)|model\s+ini|rilis\s+ini|sistem\s+ini|teknologi\s+ini|produk\s+ini|fitur\s+ini)\b/i;

let installed = false;

function tokens(value) {
  return String(value || '').toLocaleLowerCase('id-ID').match(/[a-z0-9]+/g) || [];
}

function normalizedDisplay(value) {
  return tokens(value).join(' ');
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
  if (list.length < 3) return false;
  const english = list.filter(token => ENGLISH_MARKERS.has(token)).length;
  const englishContent = list.filter(token => ENGLISH_CONTENT_MARKERS.has(token)).length;
  const indonesian = list.filter(token => INDONESIAN_MARKERS.has(token)).length;
  if (indonesian > 0) return english >= 3 && english > indonesian * 2;
  if (english >= 2 && english / list.length >= 0.2) return true;
  return list.length >= 4 && englishContent >= 2 && (english + englishContent) / list.length >= 0.35;
}

function visibleFields(content) {
  const fields = [];
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  slides.forEach((slide, slideIndex) => {
    fields.push([`slide:${slideIndex}:title`, slide?.title], [`slide:${slideIndex}:body`, slide?.body]);
    if (Array.isArray(slide?.points)) slide.points.forEach((point, pointIndex) => fields.push([`slide:${slideIndex}:point:${pointIndex}`, point]));
  });
  fields.push(['hook', content?.hook], ['caption', content?.caption], ['cta', content?.cta]);
  return fields;
}

function visibleLanguageErrors(content) {
  return [...new Set(visibleFields(content).flatMap(([field, value]) =>
    likelyEnglishDisplay(value) ? [`${field}: copy tampil masih berupa kalimat bahasa Inggris; wajib dilokalkan ke bahasa Indonesia.`] : []
  ))];
}

function visibleSourceEchoErrors(content, sources = []) {
  const sourceText = (sources || []).map(source => normalizedDisplay(source?.text)).filter(Boolean).join(' ');
  if (!sourceText) return [];
  return [...new Set(visibleFields(content).flatMap(([field, value]) => {
    const list = tokens(value);
    const normalized = list.join(' ');
    const indonesian = list.filter(token => INDONESIAN_MARKERS.has(token)).length;
    if (list.length < 5 || indonesian > 0 || normalized.length < 20 || !sourceText.includes(normalized)) return [];
    return [`${field}: copy tampil menyalin frasa sumber non-Indonesia; wajib dilokalkan ke bahasa Indonesia.`];
  }))];
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

  const requiredMatches = Math.min(2, anchors.length);
  const firstStrong = segments.findIndex(segment => sentenceAnchorCount(segment, anchors) >= requiredMatches);
  if (firstStrong < 0) return String(text || '');

  const selected = [];
  let skipNextUnrelated = false;
  for (const segment of segments.slice(firstStrong)) {
    const matches = sentenceAnchorCount(segment, anchors);
    const referential = REFERENTIAL_CONTINUATION.test(segment);
    if (likelyPhotoCaption(segment)) continue;

    const punctuated = /[.!?]$/.test(segment);
    if (!punctuated && matches < requiredMatches && !referential) {
      skipNextUnrelated = true;
      continue;
    }
    if (skipNextUnrelated && matches === 0 && !referential) {
      skipNextUnrelated = false;
      continue;
    }
    skipNextUnrelated = false;
    selected.push(segment);
  }

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
    ...new Set([...originalValidateSourceContent(content, sources), ...visibleLanguageErrors(content), ...visibleSourceEchoErrors(content, sources)])
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
  visibleSourceEchoErrors,
  namedTopicAnchors,
  sanitizeSourceTextForManualTopic,
  sanitizeSourcesForManualTopic
};
