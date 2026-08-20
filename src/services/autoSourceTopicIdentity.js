// TANPA URL / AUTO SOURCE ONLY.
// Extracts a strong model/version identity from the requested topic so discovery
// and fact selection cannot drift to a sibling version or unrelated article.

const ACTION_WORDS = new Set([
  'memperkenalkan','memperkenal','menghadirkan','hadirkan','meluncurkan','merilis','rilis','launch','launches','launched',
  'introduce','introduces','introduced','release','releases','released','baru','terbaru','new','latest','resmi','official'
]);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rawTokens(value) {
  return clean(value).match(/[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*/g) || [];
}

function isVersionToken(value) {
  return /^v?\d+(?:\.\d+)+[a-z0-9-]*$/i.test(String(value || ''));
}

function embeddedModelVersion(value) {
  const token = String(value || '');
  return /^[a-z][a-z0-9]*[-.]v?\d+(?:\.\d+)+[a-z0-9-]*$/i.test(token);
}

function specificIdentities(topic = '') {
  const tokens = rawTokens(topic);
  const identities = [];
  const seen = new Set();

  tokens.forEach((token, index) => {
    if (embeddedModelVersion(token)) {
      const phrase = normalize(token);
      if (phrase && !seen.has(phrase)) { seen.add(phrase); identities.push({ phrase, tokens: [phrase] }); }
      return;
    }
    if (!isVersionToken(token) || index === 0) return;

    const previous = tokens[index - 1];
    const previousKey = normalize(previous);
    if (!previousKey || ACTION_WORDS.has(previousKey) || /^\d/.test(previousKey)) return;

    const phraseTokens = [previousKey, normalize(token)];
    const before = tokens[index - 2];
    if (before && /^[A-Z][A-Za-z0-9-]*$/.test(before) && /^[A-Z][A-Za-z0-9-]*$/.test(previous)) {
      const beforeKey = normalize(before);
      if (beforeKey && !ACTION_WORDS.has(beforeKey)) phraseTokens.unshift(beforeKey);
    }
    const phrase = phraseTokens.join(' ');
    if (!seen.has(phrase)) { seen.add(phrase); identities.push({ phrase, tokens: phraseTokens }); }
  });

  return identities;
}

function hasSpecificIdentity(topic = '') {
  return specificIdentities(topic).length > 0;
}

function identityMatches(topic = '', value = '') {
  const identities = specificIdentities(topic);
  if (!identities.length) return true;
  const haystack = ` ${normalize(value)} `;
  return identities.some(identity => identity.tokens.every(token => haystack.includes(` ${token} `)));
}

function identityQuery(topic = '') {
  const identities = specificIdentities(topic);
  return identities[0]?.phrase || '';
}

function relativeTimeMetadata(value = '') {
  return /\b\d+\s*(?:menit|jam|hari|minggu|bulan|minute|minutes|hour|hours|day|days|week|weeks|month|months)\s*(?:lalu|ago)\b/i.test(String(value || ''));
}

module.exports = {
  specificIdentities,
  hasSpecificIdentity,
  identityMatches,
  identityQuery,
  relativeTimeMetadata,
  normalize
};
