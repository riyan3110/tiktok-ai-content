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
    for (let radius = 1; radius <= 2; radius += 1) {
      const start = Math.max(0, index - radius);
      const end = Math.min(parts.length, index + radius + 1);
      const window = parts.slice(start, end);
      if (window.length < 2) continue;
      const hasLetters = window.some(token => /[a-z]/i.test(token) && !FILLER.has(token));
      if (!hasLetters) continue;
      const phrase = window.join(' ');
      if (phrase.length >= 5 && sourceHaystack.includes(phrase)) return true;
    }
  }
  return false;
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

function filterFalsePositives(errors = [], content = {}) {
  return filterFalsePositiveDuplicateErrors(errors, content);
}

module.exports = {
  numericConcepts,
  numericGroundingErrors,
  conceptSupportedByEntityContext,
  substantiveExpansion,
  filterFalsePositiveDuplicateErrors,
  filterFalsePositives
};
