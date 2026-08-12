const NUMBER_WORDS = new Map([
  ['nol','0'],['zero','0'],['satu','1'],['one','1'],['pertama','1'],['first','1'],
  ['dua','2'],['two','2'],['kedua','2'],['second','2'],['tiga','3'],['three','3'],['ketiga','3'],['third','3'],
  ['empat','4'],['four','4'],['keempat','4'],['fourth','4'],['lima','5'],['five','5'],['kelima','5'],['fifth','5'],
  ['enam','6'],['six','6'],['keenam','6'],['sixth','6'],['tujuh','7'],['seven','7'],['ketujuh','7'],['seventh','7'],
  ['delapan','8'],['eight','8'],['kedelapan','8'],['eighth','8'],['sembilan','9'],['nine','9'],['kesembilan','9'],['ninth','9'],
  ['sepuluh','10'],['ten','10'],['kesepuluh','10'],['tenth','10'],['sebelas','11'],['eleven','11'],['kesebelas','11'],['eleventh','11'],
  ['dua belas','12'],['twelve','12'],['kedua belas','12'],['twelfth','12']
]);

const FILLER = new Set([
  'yang','dan','atau','untuk','dengan','dari','di','ke','pada','ini','itu','adalah','merupakan','akan','bisa','dapat',
  'the','and','or','to','of','in','on','for','with','from','is','are','was','were','will','can','could'
]);
const COPY_FILLER = new Set([...FILLER, 'fakta', 'utama', 'baru', 'resmi', 'model', 'produk', 'fitur', 'slide', 'bagian']);

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9%.,/-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function numericConcepts(value) {
  const raw = String(value || '');
  const concepts = new Set((raw.match(/\b\d+(?:[.,]\d+)?%?/g) || []).map(number => number.replace(/(?<=\d),(?=\d)/g, '.')));
  const normalized = normalize(raw);
  for (const [word, concept] of NUMBER_WORDS) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(normalized)) concepts.add(concept);
  }
  for (const match of normalized.matchAll(/\b(\d+)(?:st|nd|rd|th)\b/g)) concepts.add(match[1]);
  for (const match of normalized.matchAll(/\bke-?(\d+)\b/g)) concepts.add(match[1]);
  return concepts;
}

function rawNumberTokens(value) {
  return String(value || '').match(/\b\d+(?:[.,]\d+)?%?\b/g) || [];
}

function sourceForClaim(sources, sourceId) {
  const match = String(sourceId || '').match(/^source-(\d+)$/);
  if (!match) return null;
  return sources?.[Number(match[1]) - 1] || null;
}

function sourceText(source) {
  return normalize(`${source?.title || ''} ${source?.text || ''}`);
}

function tokens(value) {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function phraseHasEntityLetters(parts) {
  return parts.some(part => /[a-z]/i.test(part) && !FILLER.has(part));
}

function conceptSupportedByEntityContext(claimText, concept, source) {
  if (!source) return false;
  const sourceHaystack = sourceText(source);
  if (!sourceHaystack) return false;
  const parts = tokens(claimText);
  const indexes = [];
  parts.forEach((token, index) => {
    if (numericConcepts(token).has(concept)) indexes.push(index);
  });
  for (const index of indexes) {
    const token = parts[index];
    if (/[a-z]/i.test(token) && /\d/.test(token) && token.length >= 4 && sourceHaystack.includes(token)) return true;

    const adjacentPairs = [
      parts.slice(Math.max(0, index - 1), index + 1),
      parts.slice(index, Math.min(parts.length, index + 2))
    ];
    for (const window of adjacentPairs) {
      if (window.length !== 2 || !phraseHasEntityLetters(window)) continue;
      const phrase = window.join(' ');
      if (phrase.length >= 4 && sourceHaystack.includes(phrase)) return true;
    }

    for (let radius = 1; radius <= 2; radius += 1) {
      const start = Math.max(0, index - radius);
      const end = Math.min(parts.length, index + radius + 1);
      const window = parts.slice(start, end);
      if (window.length < 2) continue;
      if (!phraseHasEntityLetters(window)) continue;
      const phrase = window.join(' ');
      if (phrase.length >= 5 && sourceHaystack.includes(phrase)) return true;
    }
  }
  return false;
}

function previousSentenceStart(text, evidenceStart) {
  const before = text.slice(0, evidenceStart);
  const lastBreak = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n'));
  if (lastBreak < 0) return 0;
  const earlier = before.slice(0, Math.max(0, lastBreak));
  const priorBreak = Math.max(earlier.lastIndexOf('.'), earlier.lastIndexOf('!'), earlier.lastIndexOf('?'), earlier.lastIndexOf('\n'));
  return priorBreak >= 0 ? priorBreak + 1 : 0;
}

function nextSentenceEnd(text, evidenceEnd) {
  const after = text.slice(evidenceEnd);
  const positions = ['.', '!', '?', '\n']
    .map(char => after.indexOf(char))
    .filter(index => index >= 0);
  if (!positions.length) return text.length;
  return evidenceEnd + Math.min(...positions) + 1;
}

function repairNearbyNumericEvidence(content, sources = []) {
  (content?.slides || []).forEach(slide => {
    (slide?.claims || []).forEach(claim => {
      const visibleNumbers = rawNumberTokens(claim?.text);
      const evidenceNumbers = new Set(rawNumberTokens(claim?.evidence));
      const missing = visibleNumbers.filter(number => !evidenceNumbers.has(number));
      if (!missing.length) return;

      const source = sourceForClaim(sources, claim?.sourceId);
      const originalSourceText = String(source?.text || '').trim();
      const rawTitle = String(source?.title || '').replace(/\s+/g, ' ').trim();
      const rawEvidence = String(claim?.evidence || '').trim();
      if (!source || !originalSourceText || !rawEvidence) return;

      const titleSupportsMissing = Boolean(rawTitle)
        && missing.every(number => conceptSupportedByEntityContext(claim?.text, number.replace(/(?<=\d),(?=\d)/g, '.'), source));
      const titleAlreadyInText = rawTitle && normalize(originalSourceText).includes(normalize(rawTitle));
      const rawSource = titleSupportsMissing && !titleAlreadyInText
        ? `${rawTitle}. ${originalSourceText}`
        : originalSourceText;

      const sourceLower = rawSource.toLocaleLowerCase('id-ID');
      const evidenceLower = rawEvidence.toLocaleLowerCase('id-ID');
      const evidenceStart = sourceLower.indexOf(evidenceLower);
      if (evidenceStart < 0) return;
      const evidenceEnd = evidenceStart + rawEvidence.length;
      const prevStart = previousSentenceStart(rawSource, evidenceStart);
      const nextEnd = nextSentenceEnd(rawSource, evidenceEnd);
      const candidates = [
        rawSource.slice(prevStart, evidenceEnd),
        rawSource.slice(evidenceStart, nextEnd),
        rawSource.slice(prevStart, nextEnd)
      ]
        .map(value => value.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .sort((a, b) => a.split(/\s+/).length - b.split(/\s+/).length);

      const replacement = candidates.find(candidate => {
        const candidateNumbers = new Set(rawNumberTokens(candidate));
        const count = candidate.split(/\s+/).filter(Boolean).length;
        return count >= 4 && count <= 32 && missing.every(number => candidateNumbers.has(number));
      });
      if (replacement) {
        claim.evidence = replacement;
        if (rawSource !== originalSourceText) source.text = rawSource;
      }
    });
  });
  return content;
}

function numericGroundingErrors(content, sources = []) {
  const errors = [];
  (content?.slides || []).forEach((slide, slideIndex) => {
    (slide?.claims || []).forEach((claim, claimIndex) => {
      const visible = numericConcepts(claim?.text);
      const evidence = numericConcepts(claim?.evidence);
      const source = sourceForClaim(sources, claim?.sourceId);
      for (const concept of visible) {
        if (evidence.has(concept)) continue;
        if (conceptSupportedByEntityContext(claim?.text, concept, source)) continue;
        errors.push(`AUTO_SOURCE_NUMERIC: slide:${slideIndex}:claim:${claimIndex} angka/ordinal "${concept}" tidak didukung evidence/sumber yang sama.`);
      }
    });
  });
  return [...new Set(errors)];
}

function meaningfulTokens(value) {
  return [...new Set(tokens(value).filter(token => token.length > 2 && !FILLER.has(token)))];
}

function substantiveExpansion(base, candidate, minimumNewTokens) {
  const baseNorm = normalize(base);
  const candidateNorm = normalize(candidate);
  if (!baseNorm || !candidateNorm || baseNorm === candidateNorm) return false;
  const baseSet = new Set(meaningfulTokens(base));
  const candidateTokens = meaningfulTokens(candidate);
  const additions = candidateTokens.filter(token => !baseSet.has(token));
  return additions.length >= minimumNewTokens;
}

function filterFalsePositiveDuplicateErrors(errors = [], content = {}) {
  return errors.filter(error => {
    const text = String(error || '');
    let match = text.match(/^slide:(\d+):body:\s*copy mengulang title\.?$/i);
    if (match) {
      const slide = content?.slides?.[Number(match[1])];
      if (slide && String(slide.body || '').trim().split(/\s+/).length >= 8 && substantiveExpansion(slide.title, slide.body, 4)) return false;
      return true;
    }

    match = text.match(/^slide:(\d+):point:(\d+):\s*copy mengulang title\.?$/i);
    if (match) {
      const slide = content?.slides?.[Number(match[1])];
      const point = slide?.points?.[Number(match[2])];
      if (slide && point && substantiveExpansion(slide.title, point, 2)) return false;
      return true;
    }

    match = text.match(/^slide:(\d+):point:(\d+):\s*copy mengulang body\.?$/i);
    if (match) {
      const slide = content?.slides?.[Number(match[1])];
      const point = slide?.points?.[Number(match[2])];
      if (slide && point && substantiveExpansion(slide.body, point, 2)) return false;
      return true;
    }

    return true;
  });
}

function claimMeaningTokens(value) {
  return [...new Set(tokens(value).filter(token => (token.length > 2 || token === 'ai') && !COPY_FILLER.has(token)))];
}

function nearDuplicateClaimMeaning(left, right) {
  const leftNorm = normalize(left);
  const rightNorm = normalize(right);
  if (!leftNorm || !rightNorm) return false;
  if (leftNorm === rightNorm) return true;
  const a = claimMeaningTokens(left);
  const b = claimMeaningTokens(right);
  if (!a.length || !b.length) return false;
  const shared = a.filter(token => b.includes(token)).length;
  return shared >= 2 && shared / Math.min(a.length, b.length) >= 0.5;
}

function canonicalClaimKey(claim) {
  const sourceId = String(claim?.sourceId || '').trim();
  const evidence = normalize(claim?.evidence);
  return sourceId && evidence ? `${sourceId}::${evidence}` : '';
}

function canonicalDuplicateIsDistinct(content, slideIndex) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const current = slides[slideIndex];
  if (!current) return false;
  const currentClaims = (Array.isArray(current.claims) ? current.claims : [])
    .filter(claim => !String(claim?.field || '').endsWith(':title'));
  const earlierClaims = slides.slice(0, slideIndex).flatMap(slide => (Array.isArray(slide?.claims) ? slide.claims : []))
    .filter(claim => !String(claim?.field || '').endsWith(':title'));
  const repeatedPairs = [];
  for (const claim of currentClaims) {
    const key = canonicalClaimKey(claim);
    if (!key) continue;
    for (const previous of earlierClaims) {
      if (canonicalClaimKey(previous) === key) repeatedPairs.push([previous, claim]);
    }
  }
  if (!repeatedPairs.length) return false;
  return repeatedPairs.every(([previous, claim]) => !nearDuplicateClaimMeaning(previous?.text, claim?.text));
}

function denseShortBody(content, slideIndex, requiredMin = 10) {
  const slide = content?.slides?.[slideIndex];
  if (!slide) return false;
  const bodyCount = String(slide?.body || '').trim().split(/\s+/).filter(Boolean).length;
  if (bodyCount < 8 || bodyCount >= requiredMin) return false;
  const points = Array.isArray(slide?.points) ? slide.points : [];
  if (points.length < 2) return false;
  const pointWords = points.reduce((sum, point) => sum + String(point || '').trim().split(/\s+/).filter(Boolean).length, 0);
  return bodyCount + pointWords >= requiredMin + (points.length * 3);
}

function filterFalsePositives(errors = [], content = {}) {
  return filterFalsePositiveDuplicateErrors(errors, content).filter(error => {
    const text = String(error || '');

    let match = text.match(/^slide:(\d+):duplicate:\s*fakta canonical mengulang slide sebelumnya\.?$/i);
    if (match && canonicalDuplicateIsDistinct(content, Number(match[1]))) return false;

    match = text.match(/^slide:(\d+):layout:\s*body harus (\d+)[–-]24 kata agar cukup menjelaskan konteks\.?$/i);
    if (match && denseShortBody(content, Number(match[1]), Number(match[2]))) return false;

    match = text.match(/^AUTO_SOURCE_RICHNESS:\s*slide\s+(\d+)\s+body terlalu tipis\s*\(\d+ kata\)\.?$/i);
    if (match && denseShortBody(content, Number(match[1]) - 1, 10)) return false;

    return true;
  });
}

module.exports = {
  numericConcepts,
  numericGroundingErrors,
  conceptSupportedByEntityContext,
  repairNearbyNumericEvidence,
  substantiveExpansion,
  filterFalsePositiveDuplicateErrors,
  canonicalDuplicateIsDistinct,
  denseShortBody,
  filterFalsePositives
};
