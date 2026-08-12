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

function words(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean);
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
      if (window.length < 2 || !phraseHasEntityLetters(window)) continue;
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
  const positions = ['.', '!', '?', '\n'].map(char => after.indexOf(char)).filter(index => index >= 0);
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
      const rawSource = titleSupportsMissing && !titleAlreadyInText ? `${rawTitle}. ${originalSourceText}` : originalSourceText;

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
        .sort((a, b) => words(a).length - words(b).length);

      const replacement = candidates.find(candidate => {
        const candidateNumbers = new Set(rawNumberTokens(candidate));
        const count = words(candidate).length;
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

function claimMeaningTokens(value) {
  return [...new Set(tokens(value).filter(token => (token.length > 2 || token === 'ai') && !COPY_FILLER.has(token)))];
}

function nearDuplicateClaimMeaning(left, right, { minShared = 3, ratio = 0.8 } = {}) {
  const leftNorm = normalize(left);
  const rightNorm = normalize(right);
  if (!leftNorm || !rightNorm) return false;
  if (leftNorm === rightNorm) return true;
  const a = claimMeaningTokens(left);
  const b = claimMeaningTokens(right);
  if (!a.length || !b.length) return false;
  const shared = a.filter(token => b.includes(token)).length;
  return shared >= minShared && shared / Math.min(a.length, b.length) >= ratio;
}

function filterFalsePositiveDuplicateErrors(errors = [], content = {}) {
  return errors.filter(error => {
    const text = String(error || '');
    let match = text.match(/^slide:(\d+):body:\s*copy mengulang title\.?$/i);
    if (match) {
      const slide = content?.slides?.[Number(match[1])];
      if (slide && words(slide.body).length >= 8 && substantiveExpansion(slide.title, slide.body, 4)) return false;
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

function autoSourceLayoutErrors(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  if (slides.length < 4 || slides.length > 5) errors.push('AUTO_SOURCE_LAYOUT: carousel harus 4–5 slide.');
  slides.forEach((slide, slideIndex) => {
    const titleCount = words(slide?.title).length;
    const bodyCount = words(slide?.body).length;
    const points = Array.isArray(slide?.points) ? slide.points : [];
    if (!titleCount || titleCount > 12) errors.push(`AUTO_SOURCE_LAYOUT: slide:${slideIndex}: title harus 1–12 kata.`);
    if (bodyCount < 8 || bodyCount > 24) errors.push(`AUTO_SOURCE_LAYOUT: slide:${slideIndex}: body harus 8–24 kata.`);
    if (points.length > 3) errors.push(`AUTO_SOURCE_LAYOUT: slide:${slideIndex}: maksimal 3 point.`);
    points.forEach((point, pointIndex) => {
      const count = words(point).length;
      if (count < 3 || count > 7) errors.push(`AUTO_SOURCE_LAYOUT: slide:${slideIndex}:point:${pointIndex}: point harus 3–7 kata.`);
    });
  });
  return [...new Set(errors)];
}

function autoSourceDuplicateErrors(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  const previousSubstantive = [];

  slides.forEach((slide, slideIndex) => {
    const title = String(slide?.title || '').trim();
    const body = String(slide?.body || '').trim();
    const points = Array.isArray(slide?.points) ? slide.points.map(value => String(value || '').trim()).filter(Boolean) : [];

    if (title && body && nearDuplicateClaimMeaning(title, body, { minShared: 3, ratio: 0.85 }) && !substantiveExpansion(title, body, 3)) {
      errors.push(`AUTO_SOURCE_DUPLICATE: slide:${slideIndex}: body mengulang title tanpa informasi baru.`);
    }

    points.forEach((point, pointIndex) => {
      if (title && nearDuplicateClaimMeaning(title, point, { minShared: 2, ratio: 0.9 }) && !substantiveExpansion(title, point, 2)) {
        errors.push(`AUTO_SOURCE_DUPLICATE: slide:${slideIndex}:point:${pointIndex}: point mengulang title.`);
      }
      if (body && nearDuplicateClaimMeaning(body, point, { minShared: 2, ratio: 0.9 }) && !substantiveExpansion(point, body, 3)) {
        errors.push(`AUTO_SOURCE_DUPLICATE: slide:${slideIndex}:point:${pointIndex}: point mengulang body.`);
      }
      for (let earlier = 0; earlier < pointIndex; earlier += 1) {
        if (nearDuplicateClaimMeaning(points[earlier], point, { minShared: 2, ratio: 0.9 })) {
          errors.push(`AUTO_SOURCE_DUPLICATE: slide:${slideIndex}:point:${pointIndex}: point mengulang point lain.`);
          break;
        }
      }
    });

    const current = [
      ...(body ? [{ kind: 'body', value: body }] : []),
      ...points.map((value, pointIndex) => ({ kind: `point:${pointIndex}`, value }))
    ];
    current.forEach(record => {
      const duplicate = previousSubstantive.some(previous => nearDuplicateClaimMeaning(previous.value, record.value, { minShared: 3, ratio: 0.82 }));
      if (duplicate) errors.push(`AUTO_SOURCE_DUPLICATE: slide:${slideIndex}:${record.kind}: pembahasan mengulang fakta slide sebelumnya.`);
    });
    previousSubstantive.push(...current.map(record => ({ ...record, slideIndex })));
  });

  return [...new Set(errors)];
}

function autoSourceStructureErrors(content) {
  return [...autoSourceLayoutErrors(content), ...autoSourceDuplicateErrors(content)];
}

function filterFalsePositives(errors = [], content = {}) {
  return filterFalsePositiveDuplicateErrors(errors, content);
}

module.exports = {
  numericConcepts,
  numericGroundingErrors,
  conceptSupportedByEntityContext,
  repairNearbyNumericEvidence,
  substantiveExpansion,
  nearDuplicateClaimMeaning,
  filterFalsePositiveDuplicateErrors,
  autoSourceLayoutErrors,
  autoSourceDuplicateErrors,
  autoSourceStructureErrors,
  filterFalsePositives
};
