// TANPA URL / AUTO SOURCE ONLY.
// Strengthen claim evidence without changing visible copy or crossing source boundaries.

const STOPWORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','ini','itu','adalah','merupakan','akan','bisa','dapat',
  'di','ke','oleh','dalam','sebagai','lebih','juga','telah','sudah','sebuah','para','the','and','or','to','of','in','on',
  'for','with','from','is','are','was','were','will','can','could','has','have','had','a','an'
]);

const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '')
  .toLocaleLowerCase('id-ID')
  .replace(/[^a-z0-9%\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function numberTokens(value) {
  return [...new Set(String(value || '').match(/\b\d+(?:[.,]\d+)?%?\b/g) || [])];
}

function meaningfulTokens(value) {
  return [...new Set(normalize(value).split(/\s+/).filter(token => (token.length > 2 || token === 'ai') && !STOPWORDS.has(token)))];
}

function sourceForClaim(claim, sources = []) {
  const match = String(claim?.sourceId || '').match(/^source-(\d+)$/);
  return match ? sources[Number(match[1]) - 1] || null : null;
}

function sentenceWindows(source) {
  const raw = String(source?.text || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!raw) return [];
  const sentences = raw
    .split(/(?<=[.!?])\s+|\n+/)
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const windows = [];
  for (let index = 0; index < sentences.length; index += 1) {
    for (const size of [1, 2]) {
      if (index + size > sentences.length) continue;
      const candidate = sentences.slice(index, index + size).join(' ').replace(/\s+/g, ' ').trim();
      const count = words(candidate).length;
      if (count >= 4 && count <= 32) windows.push(candidate);
    }
  }
  return [...new Set(windows)];
}

function supportScore(claimText, candidate) {
  const wanted = meaningfulTokens(claimText);
  if (!wanted.length) return 0;
  const available = new Set(meaningfulTokens(candidate));
  const matches = wanted.filter(token => available.has(token)).length;
  return matches / wanted.length;
}

function numbersSupported(claimText, candidate) {
  const wanted = numberTokens(claimText);
  if (!wanted.length) return true;
  const available = new Set(numberTokens(candidate));
  return wanted.every(token => available.has(token));
}

function bestEvidenceForClaim(claim, source) {
  if (!claim || !source || !String(claim.text || '').trim()) return null;
  const current = String(claim.evidence || '').replace(/\s+/g, ' ').trim();
  const currentScore = supportScore(claim.text, current);
  const currentNumbers = numbersSupported(claim.text, current);
  const candidates = sentenceWindows(source)
    .map(evidence => ({ evidence, score: supportScore(claim.text, evidence), numbers: numbersSupported(claim.text, evidence) }))
    .filter(item => item.numbers)
    .sort((a, b) => b.score - a.score || words(a.evidence).length - words(b.evidence).length);
  const best = candidates[0];
  if (!best) return null;

  // Keep already-strong evidence. Replace only when the source offers a materially better window,
  // or when a numeric claim's current evidence omits its number/ordinal.
  if (currentNumbers && currentScore >= 0.8) return null;
  if (!currentNumbers && best.score >= 0.35) return best.evidence;
  if (best.score >= Math.max(0.55, currentScore + 0.15)) return best.evidence;
  return null;
}

function repairClaimEvidenceWindows(content, sources = []) {
  if (!content || !Array.isArray(content.slides)) return content;
  let changed = false;
  const slides = content.slides.map(slide => {
    if (!Array.isArray(slide?.claims)) return slide;
    const claims = slide.claims.map(claim => {
      const source = sourceForClaim(claim, sources);
      const replacement = bestEvidenceForClaim(claim, source);
      if (!replacement || normalize(replacement) === normalize(claim?.evidence)) return { ...claim };
      changed = true;
      return { ...claim, evidence: replacement };
    });
    return { ...slide, points: Array.isArray(slide?.points) ? [...slide.points] : [], claims };
  });
  return changed ? { ...content, slides } : content;
}

module.exports = {
  repairClaimEvidenceWindows,
  bestEvidenceForClaim,
  sentenceWindows,
  supportScore,
  numbersSupported
};
