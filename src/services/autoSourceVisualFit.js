// TANPA URL / AUTO SOURCE ONLY.
// Runs after factual composition and before the shared renderer.
// It only removes trailing detail so existing evidence remains a conservative
// superset of the visible claim. Pakai URL never loads this module.

const simple = require('./autoSourceSimpleComposer');

const BODY_MAX_WORDS = 20;
const BODY_MAX_CHARS = 170;
const POINT_MAX_WORDS = 7;
const POINT_MAX_CHARS = 82;
const TITLE_MAX_WORDS = 10;
const TITLE_MAX_CHARS = 96;

const DANGLING = new Set([
  'yang','dan','atau','dengan','untuk','dari','di','ke','pada','dalam','oleh','sebagai','karena','agar','jika','bila','saat','ketika','namun','tetapi','serta','hingga',
  'bahwa','hanya','menurut','menunjukkan','menyatakan','mengatakan','menjelaskan','mencakup','termasuk',
  'that','which','who','and','or','with','for','from','to','in','on','by','because','if','when','while','although','including','shows','showed',
  'says','said','states','stated','explains','explained','according'
]);

function words(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean);
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripTrailingPunctuation(value) {
  return clean(value).replace(/[\s,;:\-–—]+$/g, '').trim();
}

function trimDangling(tokens, minimum = 3) {
  const out = [...tokens];
  while (out.length > minimum) {
    const last = String(out.at(-1) || '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9%]/g, '');
    if (!DANGLING.has(last)) break;
    out.pop();
  }
  return out;
}

function endsWithDangling(value) {
  const text = clean(value);
  if (!text || /[,;:\-–—]\s*$/.test(text)) return true;
  const last = String(words(text).at(-1) || '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9%]/g, '');
  return DANGLING.has(last);
}

function questionOnly(value) {
  const text = clean(value);
  return /\?\s*$/.test(text) || /^(?:faq|faqs|frequently\s+asked\s+questions?)\b/i.test(text);
}

function within(value, maxWords, maxChars) {
  const text = clean(value);
  return words(text).length <= maxWords && text.length <= maxChars;
}

function compactCopy(value, { maxWords, maxChars, minimum = 3, sentence = false } = {}) {
  const original = clean(value);
  if (!original || within(original, maxWords, maxChars)) return original;

  // Prefer a complete leading clause when the model already supplied one.
  const clauseParts = original.split(/(?<=[,;:])\s+|\s+[—–]\s+/).map(stripTrailingPunctuation).filter(Boolean);
  let candidate = '';
  for (const part of clauseParts) {
    const joined = clean(candidate ? `${candidate} ${part}` : part);
    if (!within(joined, maxWords, maxChars)) break;
    candidate = joined;
  }

  if (words(candidate).length < minimum) {
    const selected = [];
    for (const token of words(original)) {
      const next = clean([...selected, token].join(' '));
      if (selected.length >= maxWords || next.length > maxChars) break;
      selected.push(token);
    }
    candidate = trimDangling(selected, minimum).join(' ');
  } else {
    candidate = trimDangling(words(candidate), minimum).join(' ');
  }

  candidate = stripTrailingPunctuation(candidate);
  if (!candidate) return original;
  if (sentence && /[.!?]$/.test(original) && !/[.!?]$/.test(candidate)) candidate += '.';
  return candidate;
}

function syncClaims(slide, slideIndex, keptPointIndexes = []) {
  const byField = new Map((Array.isArray(slide?.claims) ? slide.claims : []).map(claim => [String(claim?.field || '').trim(), claim]));
  const claims = [];
  const bodyField = `slide:${slideIndex}:body`;
  const bodyClaim = byField.get(bodyField);
  if (slide.body && bodyClaim) claims.push({ ...bodyClaim, field: bodyField, text: slide.body });

  (slide.points || []).forEach((point, pointIndex) => {
    const field = `slide:${slideIndex}:point:${pointIndex}`;
    const oldIndex = keptPointIndexes[pointIndex] ?? pointIndex;
    const claim = byField.get(`slide:${slideIndex}:point:${oldIndex}`);
    if (point && claim) claims.push({ ...claim, field, text: point });
  });
  return claims;
}

function fitSlide(slide = {}, slideIndex = 0) {
  const title = compactCopy(slide.title, {
    maxWords: TITLE_MAX_WORDS,
    maxChars: TITLE_MAX_CHARS,
    minimum: 2
  });
  const body = compactCopy(slide.body, {
    maxWords: BODY_MAX_WORDS,
    maxChars: BODY_MAX_CHARS,
    minimum: 10,
    sentence: true
  });
  const fittedPoints = (Array.isArray(slide.points) ? slide.points : [])
    .slice(0, 3)
    .map((point, oldIndex) => {
      const original = clean(point);
      if (!original || questionOnly(original) || endsWithDangling(original)) return null;
      const compact = compactCopy(original, {
        maxWords: POINT_MAX_WORDS,
        maxChars: POINT_MAX_CHARS,
        minimum: 2
      });
      if (!compact || questionOnly(compact) || endsWithDangling(compact)) return null;
      const boundedPrefixWords = Math.min(words(original).length, POINT_MAX_WORDS);
      if (!within(original, POINT_MAX_WORDS, POINT_MAX_CHARS)
        && boundedPrefixWords - words(compact).length >= 2) return null;
      return { value: compact, oldIndex };
    })
    .filter(Boolean);
  const points = fittedPoints.map(item => item.value);
  const keptPointIndexes = fittedPoints.map(item => item.oldIndex);

  const fitted = { ...slide, title, body, points };
  fitted.claims = syncClaims(fitted, slideIndex, keptPointIndexes);
  return fitted;
}

function fitAutoSourceContent(content = {}) {
  if (content?.sourceMode !== 'auto' || !Array.isArray(content?.slides)) return content;
  const slides = content.slides.map((slide, index) => fitSlide(slide, index));
  const first = slides[0] || {};
  const middle = slides.find((slide, index) => index > 0 && index < slides.length - 1 && slide.body) || first;
  const last = slides.at(-1) || first;
  return {
    ...content,
    slides,
    hook: clean(first.title || content.hook),
    body: clean(middle.body || first.body || content.body),
    caption: simple.buildCaption(slides, content.caption || middle.body || first.body, content.topic),
    cta: clean(last.title || content.cta)
  };
}

module.exports = {
  fitAutoSourceContent,
  fitSlide,
  compactCopy,
  endsWithDangling,
  within,
  BODY_MAX_WORDS,
  BODY_MAX_CHARS,
  POINT_MAX_WORDS,
  POINT_MAX_CHARS,
  TITLE_MAX_WORDS,
  TITLE_MAX_CHARS
};
