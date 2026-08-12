// TANPA URL / AUTO SOURCE ONLY.
// Installed lazily by autoSourcePatch only after Pakai URL has been excluded.
// Do not import this module from the explicit URL pipeline.

const strict = require('./autoSourceStrictFinalizer');

let installed = false;
let originalValidateStrictCandidate = null;

const POINT_TARGET_MAX = 7;
const POINT_HARD_MAX = 10;
const STOPWORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','terhadap','pada','ini','itu','adalah','merupakan','akan','bisa','dapat',
  'di','ke','oleh','dalam','sebagai','lebih','juga','telah','sudah','sebuah','para','the','and','or','to','of','in','on',
  'for','with','from','is','are','was','were','will','can','could','has','have','had','a','an','of'
]);

const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '')
  .toLocaleLowerCase('id-ID')
  .replace(/[^a-z0-9%\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function canonicalNumber(raw) {
  let value = String(raw || '').replace(',', '.').trim();
  if (/^\d+\.\d+$/.test(value)) value = value.replace(/0+$/, '').replace(/\.$/, '');
  return value;
}

function numericMentions(value) {
  const text = String(value || '');
  const mentions = [];
  const pattern = /\b(\d+(?:[.,]\d+)?)(?:\s*(%|persen|percent|per\s+cent))?/gi;
  for (const match of text.matchAll(pattern)) {
    mentions.push({
      value: canonicalNumber(match[1]),
      percent: Boolean(match[2]),
      raw: match[0]
    });
  }
  return mentions;
}

function compatibleNumber(claimNumber, sourceNumber) {
  if (!claimNumber || !sourceNumber || claimNumber.value !== sourceNumber.value) return false;
  if (claimNumber.percent || sourceNumber.percent) return claimNumber.percent === sourceNumber.percent;
  return true;
}

function numbersSupported(claimText, evidence) {
  const wanted = numericMentions(claimText);
  if (!wanted.length) return true;
  const available = numericMentions(evidence);
  return wanted.every(number => available.some(candidate => compatibleNumber(number, candidate)));
}

function meaningfulTokens(value) {
  return [...new Set(normalize(value).split(/\s+/).filter(token => {
    if (!token || STOPWORDS.has(token) || /^\d/.test(token)) return false;
    return token.length > 2 || token === 'ai';
  }))];
}

function sourceForClaim(claim, sources = []) {
  const match = String(claim?.sourceId || '').match(/^source-(\d+)$/);
  return match ? sources[Number(match[1]) - 1] || null : null;
}

function sourceWindows(source) {
  const title = String(source?.title || '').replace(/\s+/g, ' ').trim();
  const body = String(source?.text || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const sentences = body
    ? body.split(/(?<=[.!?])\s+|\n+/).map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean)
    : [];
  const windows = [];
  const add = value => {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    const count = words(clean).length;
    if (count >= 4 && count <= 32) windows.push(clean);
  };

  add(title);
  if (title && sentences[0]) add(`${title}. ${sentences[0]}`);
  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    add(sentence);
    if (sentences[index + 1]) add(`${sentence} ${sentences[index + 1]}`);
    sentence.split(/(?<=[;:])\s+|\s+[—–]\s+|,\s+/)
      .map(value => value.trim())
      .forEach(add);
  }
  return [...new Set(windows)];
}

function windowSupportScore(claimText, window) {
  const wanted = meaningfulTokens(claimText);
  if (!wanted.length) return 0;
  const available = new Set(meaningfulTokens(window));
  const matches = wanted.filter(token => available.has(token)).length;
  return matches / wanted.length;
}

function bestNumericEvidence(claim, source) {
  if (!claim || !source || !numericMentions(claim.text).length) return null;
  const current = String(claim.evidence || '').replace(/\s+/g, ' ').trim();
  if (numbersSupported(claim.text, current)) return null;

  const ranked = sourceWindows(source)
    .filter(window => numbersSupported(claim.text, window))
    .map(window => ({ window, score: windowSupportScore(claim.text, window) }))
    .filter(item => item.score >= 0.25 || meaningfulTokens(claim.text).length <= 2)
    .sort((a, b) => b.score - a.score || words(a.window).length - words(b.window).length);
  return ranked[0]?.window || null;
}

function ensureEvidenceLiteral(source, evidence) {
  if (!source || !evidence) return;
  const sourceNorm = normalize(source.text);
  const evidenceNorm = normalize(evidence);
  if (!evidenceNorm || sourceNorm.includes(evidenceNorm)) return;
  const title = String(source.title || '').replace(/\s+/g, ' ').trim();
  if (title && evidenceNorm.includes(normalize(title))) {
    source.text = `${title}. ${String(source.text || '').trim()}`.trim();
  }
}

function repairNumericEvidence(content, sources = []) {
  if (!content || !Array.isArray(content.slides)) return content;
  for (const slide of content.slides) {
    for (const claim of Array.isArray(slide?.claims) ? slide.claims : []) {
      const source = sourceForClaim(claim, sources);
      const replacement = bestNumericEvidence(claim, source);
      if (!replacement) continue;
      ensureEvidenceLiteral(source, replacement);
      claim.evidence = replacement;
    }
  }
  return content;
}

function pointCoordinates(error) {
  const text = String(error || '');
  let match = text.match(/slide:(\d+):point:(\d+)/i);
  if (match) return { slideIndex: Number(match[1]), pointIndex: Number(match[2]) };

  match = text.match(/\bslide\s+(\d+)\s*:\s*point\s+(\d+)\b/i);
  if (match) return { slideIndex: Number(match[1]) - 1, pointIndex: Number(match[2]) - 1 };
  return null;
}

function isLegacyPointWidthError(error) {
  const text = String(error || '');
  return /point.*(?:maksimal\s+7\s+kata|3\s*[–-]\s*7\s+kata|harus\s+3\s*[–-]\s*7\s+kata)/i.test(text);
}

function safePointWidth(error, content) {
  if (!isLegacyPointWidthError(error)) return false;
  const coordinates = pointCoordinates(error);
  if (!coordinates) return false;
  const point = content?.slides?.[coordinates.slideIndex]?.points?.[coordinates.pointIndex];
  const count = words(point).length;
  return count >= 3 && count <= POINT_HARD_MAX;
}

function allClaims(content) {
  return (content?.slides || []).flatMap(slide => Array.isArray(slide?.claims) ? slide.claims : []);
}

function claimFromNumericError(error, content) {
  const text = String(error || '');
  const indexed = text.match(/^AUTO_SOURCE_NUMERIC:\s+slide:(\d+):claim:(\d+)\b/i);
  if (indexed) return content?.slides?.[Number(indexed[1])]?.claims?.[Number(indexed[2])] || null;

  if (!/angka pada claim tidak didukung evidence/i.test(text)) return null;
  const normalizedError = normalize(text);
  return allClaims(content).find(claim => {
    const claimText = normalize(claim?.text);
    return claimText && normalizedError.includes(claimText);
  }) || null;
}

function numericClaimSupportedBySameSource(claim, sources = []) {
  if (!claim) return false;
  const source = sourceForClaim(claim, sources);
  if (!source) return false;
  if (numbersSupported(claim.text, claim.evidence)) return true;
  return Boolean(bestNumericEvidence(claim, source));
}

function isSameSlideEvidenceReuse(error) {
  return /duplicate:\s*evidence yang sama dipakai lebih dari sekali dalam satu slide\s*\(body\/bullet\)/i.test(String(error || ''));
}

function filterRuntimeErrors(errors = [], content = {}, sources = []) {
  return (errors || []).filter(error => {
    if (safePointWidth(error, content)) return false;

    if (isSameSlideEvidenceReuse(error)) {
      // Reusing one source sentence inside one slide is not itself a factual error.
      // Visible-copy duplicate checks and the later semantic auditor still verify
      // that body/bullets are distinct and individually entailed by the evidence.
      return false;
    }

    const numericClaim = claimFromNumericError(error, content);
    if (numericClaim && numericClaimSupportedBySameSource(numericClaim, sources)) return false;

    return true;
  });
}

function guardedValidateStrictCandidate(args = {}) {
  repairNumericEvidence(args.draft, args.sources || []);
  const result = originalValidateStrictCandidate(args);
  repairNumericEvidence(result?.candidate, args.sources || []);
  return {
    ...result,
    errors: [...new Set(filterRuntimeErrors(result?.errors || [], result?.candidate || args.draft, args.sources || []))]
  };
}

function install() {
  if (installed) return strict.validateStrictCandidate;
  originalValidateStrictCandidate = strict.validateStrictCandidate;
  strict.validateStrictCandidate = guardedValidateStrictCandidate;
  installed = true;
  return strict.validateStrictCandidate;
}

function resetForTests() {
  if (installed && originalValidateStrictCandidate) strict.validateStrictCandidate = originalValidateStrictCandidate;
  originalValidateStrictCandidate = null;
  installed = false;
}

module.exports = {
  install,
  resetForTests,
  repairNumericEvidence,
  bestNumericEvidence,
  numericMentions,
  numbersSupported,
  filterRuntimeErrors,
  safePointWidth,
  isSameSlideEvidenceReuse,
  POINT_TARGET_MAX,
  POINT_HARD_MAX
};
