// TANPA URL / AUTO SOURCE ONLY.
// Runs after factual composition and before the shared renderer.
// It only removes trailing detail so existing evidence remains a conservative
// superset of the visible claim. Pakai URL never loads this module.

const BODY_MAX_WORDS = 16;
const BODY_MAX_CHARS = 140;
const POINT_MAX_WORDS = 7;
const POINT_MAX_CHARS = 82;
const TITLE_MAX_WORDS = 10;
const TITLE_MAX_CHARS = 96;

const DANGLING = new Set([
  'yang','dan','atau','dengan','untuk','dari','di','ke','pada','dalam','oleh','sebagai','karena','agar','jika','bila','saat','ketika','namun','tetapi','serta','hingga'
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

function syncClaims(slide, slideIndex) {
  const byField = new Map((Array.isArray(slide?.claims) ? slide.claims : []).map(claim => [String(claim?.field || '').trim(), claim]));
  const claims = [];
  const bodyField = `slide:${slideIndex}:body`;
  const bodyClaim = byField.get(bodyField);
  if (slide.body && bodyClaim) claims.push({ ...bodyClaim, field: bodyField, text: slide.body });

  (slide.points || []).forEach((point, pointIndex) => {
    const field = `slide:${slideIndex}:point:${pointIndex}`;
    const claim = byField.get(field);
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
    minimum: 7,
    sentence: true
  });
  const points = (Array.isArray(slide.points) ? slide.points : [])
    .slice(0, 3)
    .map(point => compactCopy(point, {
      maxWords: POINT_MAX_WORDS,
      maxChars: POINT_MAX_CHARS,
      minimum: 2
    }))
    .filter(Boolean);

  const fitted = { ...slide, title, body, points };
  fitted.claims = syncClaims(fitted, slideIndex);
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
    caption: clean(middle.body || first.body || content.caption),
    cta: clean(last.title || content.cta)
  };
}

module.exports = {
  fitAutoSourceContent,
  fitSlide,
  compactCopy,
  within,
  BODY_MAX_WORDS,
  BODY_MAX_CHARS,
  POINT_MAX_WORDS,
  POINT_MAX_CHARS,
  TITLE_MAX_WORDS,
  TITLE_MAX_CHARS
};
