const dynamicScope = require('./autoSourceDynamicScope');

// TANPA URL / AUTO SOURCE ONLY.
// Clean the already topic-scoped article text before fact selection. The goal is
// deliberately simple: keep substantive story facts, drop editorial/promotional
// side-notes, split obvious compound clauses, and put the requested event first.

const HARD_PROMO = /\b(?:subscribe|subscription|newsletter|premium\s+(?:member|membership)|sign\s+up|free\s+trial|stock\s+advisor|join\s+now|daftar\s+sekarang|berlangganan)\b/i;
const STOCK_PICK_EDITORIAL = /(?:\b(?:best|top)\s+(?:\d+|ten|five|three)?\s*(?:stocks?|shares?)\b|\b(?:stocks?|shares?)\s+(?:to\s+buy|to\s+own)\b|\b(?:saham)\s+(?:terbaik|pilihan|untuk\s+dibeli)\b|\b(?:tidak\s+(?:menempatkan|memasukkan)|not\s+(?:among|included?)).{0,90}\b(?:stocks?|shares?|saham)\b|\b(?:rekomendasi|recommendation)\s+(?:saham|stock)\b)/i;
const LEGAL_DISCLAIMER = /(?:\b(?:disclaimer|penafian)\b|\b(?:tidak|tak)\s+bertanggung\s+jawab\b.{0,120}\b(?:kerugian|kerusakan)\b|\bnot\s+(?:be\s+)?responsible\b.{0,120}\b(?:loss|losses|damage|damages)\b|\b(?:bukan|not)\s+(?:merupakan\s+)?(?:nasihat|saran)\s+(?:keuangan|investasi)\b|\bnot\s+(?:financial|investment)\s+advice\b)/i;
const MARKET_SNAPSHOT = /\b(?:stock|stocks|shares?|saham|share\s+price|harga\s+saham)\b/i;
const MARKET_MOVE = /\b(?:rose|fell|jumped|surged|slid|gained|dropped|rallied|naik|turun|melonjak|anjlok|menguat|melemah)\b/i;
const RELATIVE_METADATA = /\b\d+\s*(?:menit|jam|hari|minggu|bulan|minute|minutes|hour|hours|day|days|week|weeks|month|months)\s*(?:lalu|ago)\b/i;
const AUDIENCE_ACTOR = /(?:\b(?:a|an|one|another|some)\s+(?:user|reader|commenter|customer|viewer)\b|\b(?:user|users|reader|readers|commenter|commenters|customer|customers|viewer|viewers|pengguna|pembaca|komentator|pelanggan|penonton|warganet|netizen)\b)/i;
const AUDIENCE_REACTION = /\b(?:wrote|posted|commented|joked|quipped|reacted|complained|praised|asked|tweeted|replied|tulis|menulis|mengunggah|berkomentar|bercanda|menanggapi|mengeluh|memuji|bertanya|membalas|ujar)\b/i;
const FIRST_PERSON_REACTION = /\b(?:i\s+(?:can(?:no|')?t\s+wait|hope|wish|love|hate|want)|we\s+(?:can(?:no|')?t\s+wait|hope|wish|love|hate|want)|(?:aku|saya|kami)\s+(?:tidak\s+sabar|berharap|ingin|suka|benci)|semoga)\b/i;
const REACTION_TOPIC = /\b(?:reaksi|tanggapan|komentar|respons\s+(?:pengguna|publik)|opini\s+publik|sentimen|user\s+reactions?|public\s+response|what\s+users\s+say)\b/i;
const MARKETING_ACTIVATION = /\b(?:campaign|campaigning|kampanye|mengampanyekan|dikampanyekan|promosi|promotional|marketing\s+activation|brand\s+activation|celebrat(?:e|es|ed|ing|ion)|merayakan|dirayakan|menyambut\s+perayaan)\b/i;
const MARKETING_TOPIC = /\b(?:campaign|kampanye|promosi|marketing|brand\s+activation|celebrat(?:e|es|ed|ing|ion)|merayakan|perayaan|hari\s+(?:kemerdekaan|nasional|raya))\b/i;
const SIDE_PROGRAM_ACTIVATION = /(?:\b(?:program|initiative|inisiatif)\s+(?:ini\s+)?(?:mengajak|mendorong|mengundang|merayakan|mempromosikan|mengampanyekan|invites?|encourages?|celebrates?|promotes?)\b|\b(?:jelajah\s+nusantara|kuliner\s+legendaris)\b)/i;
const PROGRAM_TOPIC = /\b(?:program|initiative|inisiatif|jelajah\s+nusantara|kuliner\s+legendaris)\b/i;
const RELATED_NAVIGATION = /(?:\b(?:baca|read)\s+(?:juga|also)\b|\b(?:artikel|berita|stories?|articles?)\s+(?:terkait|lainnya|lain|related|recommended)\b|\b(?:recommended|rekomendasi|selengkapnya|load\s+more|most\s+read|terpopuler)\b)/i;
const READ_TIME_METADATA = /(?:\b(?:waktu|durasi)\s+baca\b|\breading\s+time\b|\b\d+\s*(?:menit|minutes?)\s+(?:baca|read)\b)/i;
const EMBEDDED_CARD_TIMESTAMP = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\s+\d{1,2}[:.]\d{2}\b/;
const SITE_CHANNEL_METADATA = /\b(?:antara\s+(?:news|tekno)\s*){2,}|\bantara\s+(?:news|tekno)\b.{0,48}\b(?:waktu\s+baca|reading\s+time)\b/i;
const SOCIAL_CHROME = /^(?:bagikan|share|salin\s+tautan|copy\s+link|simpan|save|komentar|comments?|tayangan|views?)\b/i;
const MEDIA_CREDIT = /(?:\b(?:antara|reuters|associated\s+press|ap|afp|getty(?:\s+images)?)\s*\/\s*(?:ho[-\s]?)?[a-z0-9._-]+|\b(?:photo|foto)\s+(?:by|oleh)\b|©)/i;
const CAPTION_START = /^(?:ilustrasi|foto|gambar|image|photo)\b/i;
const CAPTION_FACT_VERB = /\b(?:menunjukkan|memperlihatkan|mengungkapkan|merekam|shows?|depicts?|reveals?|records?)\b/i;
const BYLINE_METADATA = /^(?:oleh|ditulis\s+oleh|disunting\s+oleh|penulis|reporter|editor|kontributor|author|written\s+by|edited\s+by)\b/i;
const UNSUPPORTED_HYPE = /\b(?:(?:lompatan|terobosan)\s+besar|game[- ]?changer|revolusioner|mengubah\s+(?:sepenuhnya\s+|total\s+)?cara\s+(?:kita|orang|pengguna)|masa\s+depan\s+(?:sudah\s+)?(?:tiba|dimulai))\b/i;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function words(value) {
  return clean(value).split(/\s+/).filter(Boolean);
}

function normalizedTerm(value) {
  return dynamicScope.looseNormalize(value);
}

function isSameTerm(left, right) {
  const a = normalizedTerm(left);
  const b = normalizedTerm(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function storyEventTerms(plan = {}) {
  const subjects = plan.subjects || [];
  return (plan.eventTerms || []).filter(term =>
    term && !subjects.some(subject => isSameTerm(term, subject))
  );
}

function eventHits(plan = {}, value = '') {
  const eventTerms = storyEventTerms(plan);
  return dynamicScope.eventHits({ ...plan, eventTerms }, value);
}

function requestedText(plan = {}) {
  return clean(`${plan.rawTopic || ''} ${plan.canonicalTopic || ''}`);
}

function cleanArticleFact(value = '') {
  let text = clean(value);
  if (!text) return '';

  // Keep the actual article sentence while removing datelines and image-credit
  // prefixes that some reader proxies concatenate into the first paragraph.
  text = text.replace(/^[A-ZÀ-Ý][\p{L} .'-]{1,45}\s*\((?:ANTARA|REUTERS|AP|AFP)\)\s*[-–—:]\s*/iu, '');
  text = text.replace(/^\s*(?:\(?\s*)?(?:ANTARA|REUTERS|AP|AFP)(?:\s*\/\s*(?:HO[-\s]?)?[A-Za-z0-9._-]+)+\)?\s*[-–—:]?\s*/i, '');
  text = text.replace(/\s+(?:ANTARA\s+(?:News|Tekno)\s*)+(?:waktu\s+baca.*)?$/i, '');
  if (/^ANTARA\s+(?:News|Tekno)[.!]?$/i.test(text)) return '';
  return clean(text);
}

function sourceArtifactNoise(value = '', plan = {}) {
  const raw = clean(value);
  const text = cleanArticleFact(raw);
  if (!text) return true;
  if (RELATED_NAVIGATION.test(text) || READ_TIME_METADATA.test(text) || SITE_CHANNEL_METADATA.test(text)) return true;
  if (EMBEDDED_CARD_TIMESTAMP.test(text)) return true;
  if (SOCIAL_CHROME.test(text) || BYLINE_METADATA.test(text)) return true;
  if (MEDIA_CREDIT.test(text) && words(text).length <= 18) return true;
  if (CAPTION_START.test(text) && !CAPTION_FACT_VERB.test(text)) return true;

  // A bare publication timestamp is page chrome. Dates expressed as prose
  // (for example "pada 12 Agustus") remain available as real story facts.
  if (/^(?:senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu),?\s+\d{1,2}\b/i.test(text)
    && /\b\d{1,2}[:.]\d{2}\s*(?:wib|wita|wit|gmt|utc)\b/i.test(text)
    && words(text).length <= 14) return true;

  const requested = requestedText(plan);
  if (/^(?:advertisement|iklan)$/i.test(text) && !/\b(?:advertisement|iklan)\b/i.test(requested)) return true;
  return false;
}

function unsupportedHype(value = '', evidence = '') {
  const copy = clean(value);
  if (!copy || !UNSUPPORTED_HYPE.test(copy)) return false;
  return !UNSUPPORTED_HYPE.test(clean(evidence));
}

function audienceReactionNoise(value = '', plan = {}) {
  const text = clean(value);
  if (!text || REACTION_TOPIC.test(requestedText(plan))) return false;
  const attributedReaction = AUDIENCE_ACTOR.test(text) && AUDIENCE_REACTION.test(text);
  const firstPersonAudienceQuote = AUDIENCE_ACTOR.test(text)
    && FIRST_PERSON_REACTION.test(text)
    && /["'“”‘’]/.test(text);
  return attributedReaction || firstPersonAudienceQuote;
}

function marketingActivationNoise(value = '', plan = {}) {
  const text = clean(value);
  if (!text) return false;
  const requested = requestedText(plan);
  if (MARKETING_ACTIVATION.test(text)) return !MARKETING_TOPIC.test(requested);
  if (SIDE_PROGRAM_ACTIVATION.test(text)) return !PROGRAM_TOPIC.test(requested) && !MARKETING_TOPIC.test(requested);
  return false;
}

function editorialNoise(value = '', plan = {}) {
  const text = cleanArticleFact(value);
  if (!text) return true;
  const requested = requestedText(plan);
  if (sourceArtifactNoise(text, plan)) return true;
  if (audienceReactionNoise(text, plan)) return true;
  if (marketingActivationNoise(text, plan)) return true;
  if (HARD_PROMO.test(text) && !HARD_PROMO.test(requested)) return true;
  if (!plan.marketIntent && STOCK_PICK_EDITORIAL.test(text) && !STOCK_PICK_EDITORIAL.test(requested)) return true;
  if (LEGAL_DISCLAIMER.test(text) && !LEGAL_DISCLAIMER.test(requested)) return true;
  if (RELATIVE_METADATA.test(text) && words(text).length <= 16 && !RELATIVE_METADATA.test(requested)) return true;
  return false;
}

function marketSnapshot(value = '', plan = {}) {
  if (plan.marketIntent) return false;
  const text = clean(value);
  return MARKET_SNAPSHOT.test(text)
    && MARKET_MOVE.test(text)
    && /\b\d+(?:[.,]\d+)?%\b/.test(text);
}

function sentenceRows(text = '') {
  return clean(text)
    .split(/(?<=[.!?])\s+/)
    .map(clean)
    .filter(Boolean);
}

function splitCompoundSentence(sentence = '') {
  const source = clean(sentence);
  if (!source) return [];

  const marked = source
    .replace(/;\s+/g, '.\n')
    .replace(/\s+[—–]\s+/g, '.\n')
    .replace(/,\s+(?=(?:while|whereas|but|however|meanwhile|sedangkan|sementara|tetapi|namun)\b)/gi, '.\n');

  const parts = marked.split(/\n+/).map(value => clean(value).replace(/^\.+\s*/, '')).filter(Boolean);
  if (parts.length <= 1) return [source];

  const usable = parts.filter(part => words(part).length >= 4);
  return usable.length >= 2 ? usable : [source];
}

function atomicFacts(text = '', plan = {}) {
  return sentenceRows(text)
    .flatMap(splitCompoundSentence)
    .map(cleanArticleFact)
    .filter(value => value && !sourceArtifactNoise(value, plan));
}

function focusScore(topic = '', evidence = '', source = {}, plan = {}) {
  if (editorialNoise(evidence, plan)) return -100;
  if (!dynamicScope.evidenceInScope(topic, evidence, source, plan)) return -100;

  const subjects = dynamicScope.subjectHits(plan, evidence).length;
  const events = eventHits(plan, evidence).length;
  const actions = dynamicScope.actionHits(plan, evidence).length;
  const contexts = dynamicScope.contextHits(plan, evidence).length;
  const titleEvents = eventHits(plan, source?.title || '').length;
  let score = dynamicScope.evidenceScore(topic, evidence, source, plan)
    + subjects * 1.5
    + events * 4
    + actions * 4
    + contexts * 2
    + (subjects && events ? 1.5 : 0)
    + (events && titleEvents ? 0.75 : 0)
    + (dynamicScope.eventLockSatisfied(plan, evidence) ? 6 : 0);

  const count = words(evidence).length;
  if (count >= 7 && count <= 30) score += 0.4;
  if (marketSnapshot(evidence, plan)) score -= 5;
  return score;
}

function focusSource(topic = '', source = {}, plan = {}, maxFacts = 14) {
  const originalFacts = atomicFacts(source?.text || '', plan);
  const facts = originalFacts
    .map((evidence, order) => ({
      evidence,
      order,
      score: focusScore(topic, evidence, source, plan),
      eventHits: eventHits(plan, evidence).length,
      eventLocked: dynamicScope.eventLockSatisfied(plan, evidence)
    }))
    .filter(row => row.score > -100)
    .sort((a, b) => Number(b.eventLocked) - Number(a.eventLocked) || b.eventHits - a.eventHits || b.score - a.score || a.order - b.order)
    .slice(0, maxFacts);

  return {
    ...source,
    text: facts.map(row => /[.!?]$/.test(row.evidence) ? row.evidence : `${row.evidence}.`).join(' '),
    storyFocus: {
      originalFactCount: originalFacts.length,
      keptFactCount: facts.length,
      eventFocusedCount: facts.filter(row => row.eventHits > 0 || row.eventLocked).length
    }
  };
}

function focusSources(topic = '', sources = [], plan = {}) {
  return (sources || []).map(source => focusSource(topic, source, plan));
}

module.exports = {
  storyEventTerms,
  eventHits,
  requestedText,
  cleanArticleFact,
  sourceArtifactNoise,
  unsupportedHype,
  audienceReactionNoise,
  marketingActivationNoise,
  editorialNoise,
  marketSnapshot,
  sentenceRows,
  splitCompoundSentence,
  atomicFacts,
  focusScore,
  focusSource,
  focusSources
};
