const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const storyFocus = require('./autoSourceStoryFocus');

// TANPA URL / AUTO SOURCE ONLY.
// Simple production path:
// discovery -> clean facts -> writer -> fact-check/editor -> deterministic factual gate -> output.
const SLIDE_COUNT = 4;
const MAX_POINTS = 3;
const MAX_FACTS_PER_SOURCE = 8;
const STRICT_FACT_SIMILARITY = 0.58;
const RELAXED_FACT_SIMILARITY = 0.76;
const CRITICAL_FACT_ANGLES = new Set(['timing', 'availability', 'scope', 'language', 'regulation', 'choice']);

const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '')
  .toLocaleLowerCase('id-ID')
  .replace(/[^a-z0-9%\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const STOPWORDS = new Set([
  'yang','dan','atau','dari','untuk','dengan','tentang','pada','dalam','ini','itu','adalah','merupakan','akan','bisa','dapat',
  'di','ke','oleh','sebagai','lebih','juga','telah','sudah','sebuah','para','the','and','or','to','of','in','on','for','with',
  'from','is','are','was','were','will','can','could','has','have','had','a','an'
]);

const QUESTION_START = /^(?:faq\s*[:.-]?\s*)?(?:apa(?:kah)?|siapa|kapan|mengapa|kenapa|bagaimana|bisakah|dapatkah|benarkah|what|who|when|why|how)\b/i;
const ANNOUNCEMENT = /\b(?:announce(?:d|s|ment|ments|ing)?|plan(?:ned|s|ning)?|start(?:ed|s|ing)?|begin(?:s|ning)?|introduc(?:e|ed|es|ing)|launch(?:ed|es|ing)?|roll(?:ed|s|ing)?\s+out|add(?:ed|s|ing)?|embed(?:ded|s|ding)?|insert(?:ed|s|ing)?|apply|applies|applied|applying|mengumumkan|diumumkan|berencana|rencana|akan\s+mulai|mulai|memperkenalkan|diperkenalkan|menghadirkan|dihadirkan|hadirkan|meluncurkan|diluncurkan|menambahkan|ditambahkan|menyisipkan|disisipkan|menerapkan|diterapkan)\b|\b(?:memberi(?:kan)?|diberi(?:kan)?)\s+(?:watermark|tanda\s+air)\b/i;
const DANGLING_END = new Set([
  'yang','dan','atau','dengan','untuk','dari','di','ke','pada','dalam','oleh','sebagai','karena','agar','jika','bila','saat','ketika',
  'bahwa','namun','tetapi','serta','hingga','hanya','menurut','menunjukkan','menyatakan','mengatakan','menjelaskan','mencakup','termasuk',
  'that','which','who','and','or','with','for','from','to','in','on','by','because','if','when','while','although','including','shows','showed',
  'says','said','states','stated','explains','explained','according'
]);

const SEMANTIC_ALIASES = new Map([
  ['cloude','claude'],
  ['announced','announce'],['announces','announce'],['announcement','announce'],['mengumumkan','announce'],['diumumkan','announce'],
  ['plans','announce'],['planned','announce'],['planning','announce'],['rencana','announce'],['berencana','announce'],
  ['started','start'],['starts','start'],['starting','start'],['mulai','start'],
  ['introduced','introduce'],['introduces','introduce'],['memperkenalkan','introduce'],['diperkenalkan','introduce'],
  ['menghadirkan','introduce'],['dihadirkan','introduce'],['hadirkan','introduce'],
  ['launched','release'],['launches','release'],['released','release'],['releases','release'],['meluncurkan','release'],['diluncurkan','release'],['dirilis','release'],
  ['add','apply'],['adds','apply'],['added','apply'],['adding','apply'],['embed','apply'],['embedded','apply'],['embedding','apply'],['embeds','apply'],
  ['insert','apply'],['inserted','apply'],['inserts','apply'],['inserting','apply'],['include','apply'],['including','apply'],
  ['incorporate','apply'],['incorporating','apply'],['menyisipkan','apply'],['disisipkan','apply'],['menambahkan','apply'],['ditambahkan','apply'],
  ['menerapkan','apply'],['diterapkan','apply'],['menanamkan','apply'],['memasukkan','apply'],['beri','apply'],
  ['mark','watermark'],['marks','watermark'],['marked','watermark'],['marking','watermark'],['watermarks','watermark'],['watermarking','watermark'],
  ['menandai','watermark'],['ditandai','watermark'],['penandaan','watermark'],
  ['generated','generate'],['generates','generate'],['generating','generate'],['dihasilkan','generate'],['menghasilkan','generate'],
  ['contents','content'],['konten','content'],['texts','text'],['teks','text'],['images','image'],['gambar','image'],
  ['models','model'],['produk','product'],['products','product'],['services','service'],['layanan','service'],
  ['available','availability'],['tersedia','availability'],['ketersediaan','availability'],
  ['detecting','detect'],['detected','detect'],['detection','detect'],['mendeteksi','detect'],['terdeteksi','detect'],['deteksi','detect'],
  ['persists','persist'],['persisted','persist'],['persisting','persist'],['bertahan','persist'],['menetap','persist'],
  ['copied','copy'],['copying','copy'],['disalin','copy'],['menyalin','copy'],['salinan','copy'],
  ['pasted','paste'],['pasting','paste'],['ditempel','paste'],['menempelkan','paste'],
  ['edited','edit'],['editing','edit'],['diedit','edit'],['mengedit','edit'],
  ['applications','application'],['apps','application'],['aplikasi','application'],
  ['latest','latest'],['terbaru','latest'],['after','after'],['setelah','after'],
  ['januari','january'],['februari','february'],['maret','march'],['mei','may'],['juni','june'],['juli','july'],['agustus','august'],['oktober','october'],['desember','december'],
  ['european','eu'],['europe','eu'],['eropa','eu'],['ue','eu'],
  ['compliance','comply'],['compliant','comply'],['mematuhi','comply'],['kepatuhan','comply'],
  ['rules','rule'],['regulations','rule'],['regulation','rule'],['aturan','rule'],
  ['supports','support'],['supported','support'],['mendukung','support'],['didukung','support'],
  ['globally','global'],['deployments','deployment'],['deployed','deployment'],['penerapan','deployment']
]);

const GENERIC_FACT_TOKENS = new Set([
  'announce','start','introduce','release','apply','watermark','generate','content','text','image','model','ai',
  'new','plan','company','product','service','support','availability'
]);

const MONTH_PATTERNS = [
  ['january', /\b(?:january|januari)\b/i],
  ['february', /\b(?:february|februari)\b/i],
  ['march', /\b(?:march|maret)\b/i],
  ['april', /\bapril\b/i],
  // English "may" is usually a modal verb in article copy. Treat it as a
  // month only when capitalized; Indonesian "Mei" remains unambiguous.
  ['may', /(?:\bMay\b|\b[Mm]ei\b)/],
  ['june', /\b(?:june|juni)\b/i],
  ['july', /\b(?:july|juli)\b/i],
  ['august', /\b(?:august|agustus)\b/i],
  ['september', /\bseptember\b/i],
  ['october', /\b(?:october|oktober)\b/i],
  ['november', /\bnovember\b/i],
  ['december', /\b(?:december|desember)\b/i]
];

function meaningfulTokens(value) {
  return [...new Set(normalize(value).split(' ').filter(token => token && !STOPWORDS.has(token) && (token.length > 2 || token === 'ai')))];
}

function similarity(left, right) {
  const a = meaningfulTokens(left);
  const b = meaningfulTokens(right);
  if (!a.length || !b.length) return 0;
  const shared = a.filter(token => b.includes(token)).length;
  return shared / Math.min(a.length, b.length);
}

function cleanEvidence(value) {
  return storyFocus.cleanArticleFact(value);
}

function questionOnlyEvidence(value) {
  const text = cleanEvidence(value);
  if (!text) return false;
  return /\?\s*$/.test(text) || /^(?:faq|faqs|frequently\s+asked\s+questions?)\b/i.test(text) || QUESTION_START.test(text);
}

function endsWithDanglingFragment(value) {
  const raw = cleanEvidence(value);
  if (!raw || /[,;:\-–—]\s*$/.test(raw)) return true;
  const last = normalize(raw).split(' ').filter(Boolean).at(-1);
  return Boolean(last && DANGLING_END.has(last));
}

function semanticBase(value) {
  return normalize(value)
    .replace(/\b(?:tanda\s+air)\b/g, ' watermark ')
    .replace(/\b(?:tak|tidak)\s+terlihat\b/g, ' invisible ')
    .replace(/\bmachine\s+readable\b/g, ' machinereadable ')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticTokens(value, topic = '') {
  const topicTokens = new Set(semanticBase(topic).split(' ').map(token => SEMANTIC_ALIASES.get(token) || token).filter(Boolean));
  return [...new Set(semanticBase(value).split(' ').map(token => SEMANTIC_ALIASES.get(token) || token).filter(token =>
    token && !STOPWORDS.has(token) && !topicTokens.has(token) && (token.length > 2 || token === 'ai' || /^\d/.test(token))
  ))];
}

function semanticSimilarity(left, right, topic = '') {
  const a = semanticTokens(left, topic);
  const b = semanticTokens(right, topic);
  if (!a.length || !b.length) return 0;
  const shared = a.filter(token => b.includes(token)).length;
  return shared / Math.min(a.length, b.length);
}

function distinctiveEvidenceTokens(value, topic = '') {
  return semanticTokens(value, topic).filter(token => !GENERIC_FACT_TOKENS.has(token));
}

function genericAnnouncement(value, topic = '') {
  return ANNOUNCEMENT.test(value) && distinctiveEvidenceTokens(value, topic).length <= 1;
}

function explicitMonthAnchors(value) {
  const text = String(value || '');
  return MONTH_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([month]) => month);
}

function mainEvidenceCovered(copy, packet = {}) {
  const evidence = cleanEvidence(packet?.mainEvidence);
  const visible = cleanEvidence(copy);
  if (!evidence || !visible) return false;
  if (normalize(evidence) === normalize(visible)) return true;

  // Preserve the factual angle, not literal English words. This stays safe for
  // arbitrary topics whose evidence must be translated to Indonesian while
  // still blocking the production failure where timing/mechanism/scope was
  // flattened into four copies of the same generic announcement.
  const evidenceAngles = factAngles(evidence, packet?.topic || '').filter(angle => angle !== 'announcement');
  if (!evidenceAngles.length) return true;
  const visibleAngles = new Set(factAngles(visible, packet?.topic || '').filter(angle => angle !== 'announcement'));
  if (!evidenceAngles.some(angle => visibleAngles.has(angle))) return false;

  // Timing, availability, scope, language, regulation, and user choice change
  // the meaning of a claim. They may not be flattened merely because another
  // softer angle (for example "personalization") is still mentioned.
  if (evidenceAngles.some(angle => CRITICAL_FACT_ANGLES.has(angle) && !visibleAngles.has(angle))) return false;

  if (evidenceAngles.includes('timing')) {
    const visibleNumbers = new Set(canonicalNumbers(visible));
    if (canonicalNumbers(evidence).some(number => !visibleNumbers.has(number))) return false;
    const evidenceMonths = explicitMonthAnchors(evidence);
    const visibleMonths = new Set(explicitMonthAnchors(visible));
    if (evidenceMonths.some(month => !visibleMonths.has(month))) return false;
  }
  return true;
}

function factAngles(value, topic = '') {
  const text = semanticBase(value);
  const tokens = new Set(semanticTokens(value, topic));
  const angles = new Set();
  if (ANNOUNCEMENT.test(value)) angles.add('announcement');
  if (explicitMonthAnchors(value).length
    || /(?:\b(?:before|after|since|until|launch|rollout|rolling\s+out|progress|existing|future|coming|sebelum|setelah|sejak|hingga|peluncuran|bertahap|model\s+lama|model\s+baru)\b|\b\d{4}\b)/i.test(text)) angles.add('timing');
  if (tokens.has('persist') || tokens.has('copy') || tokens.has('paste') || tokens.has('edit')
    || /\b(?:surviv(?:e|es|ed|ing)|resize|follows?|bertahan|menetap|disalin|salin|tempel|diedit|ubah\s+ringan)\b/i.test(text)) angles.add('durability');
  if (/\b(?:invisible|machinereadable|machine\s+readable|metadata|provenance|c2pa|pixels?|model\s+level|tak\s+terlihat|tidak\s+terlihat|tingkat\s+model)\b/i.test(text)) angles.add('mechanism');
  if (/\b(?:global|globally|across|deployments?|aws|google\s+cloud|microsoft\s+foundry|regions?|countries?|platforms?|products?|worldwide|indonesia|secara\s+global|lintas|wilayah|negara|platform|produk)\b/i.test(text)) angles.add('scope');
  if (tokens.has('comply') || tokens.has('eu') || /\b(?:law|laws|act|regulation|regulations|rules|legal|undang-undang|aturan|regulasi|kepatuhan)\b/i.test(text)) angles.add('regulation');
  if (tokens.has('detect') || /\b(?:identify|identifying|verify|verification|prove|proof|clues?|mendeteksi|mengidentifikasi|memverifikasi|membuktikan|petunjuk)\b/i.test(text)) angles.add('detection');
  if (/\b(?:available|availability|accessible|accessed|launch(?:ed|es|ing)|rolling\s+out|rollout|tersedia|ketersediaan|hadir|hadirkan|menghadirkan|dihadirkan|diluncurkan|digulirkan|dapat\s+diakses|bisa\s+diakses|mulai\s+tersedia)\b/i.test(text)) angles.add('availability');
  if (/\b(?:languages?|english|indonesian|bahasa\s+(?:indonesia|inggris|lokal)|dukungan\s+bahasa)\b/i.test(text)) angles.add('language');
  if (/\b(?:personal\s+intelligence|personalized|personalised|personalization|personalisation|preferences?|reservations?|gmail|calendar|personalisasi|dipersonalisasi|preferensi|reservasi)\b/i.test(text)) angles.add('personalization');
  if (/\b(?:choose|chooses|chosen|decide|decides|optional|opt(?:ed)?[ -]?in|opt(?:ed)?[ -]?out|off\s+by\s+default|permission|consent|in\s+control|pilih|memilih|dipilih|opsional|izin|persetujuan|kendali|kontrol|nonaktif\s+secara\s+default)\b/i.test(text)) angles.add('choice');
  return [...angles];
}

function angleNovelty(candidate, selected = [], topic = '') {
  const angles = factAngles(candidate?.evidence, topic).filter(angle => angle !== 'announcement');
  if (!angles.length) return 0;
  const seen = new Set(selected.flatMap(item => factAngles(item?.evidence, topic).filter(angle => angle !== 'announcement')));
  const fresh = angles.filter(angle => !seen.has(angle)).length;
  return fresh ? fresh * 0.9 : -0.55;
}

function sameFactContext(left, right, topic = '') {
  if (normalize(left) === normalize(right)) return true;
  if (genericAnnouncement(left, topic) && genericAnnouncement(right, topic)) return true;
  const score = Math.max(semanticSimilarity(left, right, topic), semanticSimilarity(left, right));
  const bothAnnouncements = ANNOUNCEMENT.test(left) && ANNOUNCEMENT.test(right);
  if (bothAnnouncements) {
    const leftAngles = new Set(factAngles(left, topic).filter(angle => CRITICAL_FACT_ANGLES.has(angle)));
    const rightAngles = new Set(factAngles(right, topic).filter(angle => CRITICAL_FACT_ANGLES.has(angle)));
    const distinctCriticalDetail = [...leftAngles].some(angle => !rightAngles.has(angle))
      || [...rightAngles].some(angle => !leftAngles.has(angle));
    const leftNumbers = new Set(canonicalNumbers(left));
    const rightNumbers = new Set(canonicalNumbers(right));
    const distinctNumber = [...leftNumbers].some(number => !rightNumbers.has(number))
      || [...rightNumbers].some(number => !leftNumbers.has(number));
    if (distinctCriticalDetail || distinctNumber) return false;
  }
  if (score >= 0.68) return true;
  return bothAnnouncements && score >= 0.3;
}

function sectionsForFormat(format = 'Fakta singkat') {
  const structures = {
    'Tutorial langkah': ['PEMBUKA', 'LANGKAH 1', 'LANGKAH 2', 'HASIL/PENUTUP'],
    'Masalah dan solusi': ['MASALAH', 'SOLUSI', 'SOLUSI', 'PENUTUP'],
    'Fakta singkat': ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'],
    Listicle: ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4'],
    'Tips cepat': ['PEMBUKA', 'TIPS 1', 'TIPS 2', 'PENUTUP'],
    'Before-after': ['BEFORE', 'PERUBAHAN', 'AFTER', 'PENUTUP']
  };
  return structures[format] || structures['Fakta singkat'];
}

function sourceIdForIndex(index) { return `source-${index + 1}`; }
function sourceIndexFromId(sourceId) {
  const match = String(sourceId || '').match(/^source-(\d+)$/);
  return match ? Number(match[1]) - 1 : -1;
}
function sourceForId(sources, sourceId) {
  const index = sourceIndexFromId(sourceId);
  return index >= 0 ? sources?.[index] || null : null;
}

function collectFactGroups(sources = [], topic = '') {
  const ranked = sourceFilter.extractFactBank(sources, topic);
  const plan = { rawTopic: topic, canonicalTopic: topic, marketIntent: false };
  // Keep whole article sentences as the fallback fact bank. The generic manual
  // source fallback intentionally chunks long prose, but those chunks can end in
  // the middle of a claim and are unsafe for visible Auto Source carousel copy.
  const fallback = sources.flatMap((source, index) => storyFocus.atomicFacts(source?.text || '', plan).map(evidence => ({
    sourceId: sourceIdForIndex(index),
    evidence
  })));
  const groups = new Map(sources.map((_, index) => [sourceIdForIndex(index), []]));
  const seen = new Map([...groups.keys()].map(id => [id, new Set()]));

  for (const fact of [...ranked, ...fallback]) {
    const sourceId = String(fact?.sourceId || '').trim();
    const evidence = cleanEvidence(fact?.evidence);
    if (!groups.has(sourceId)
      || !evidence
      || questionOnlyEvidence(evidence)
      || endsWithDanglingFragment(evidence)
      || storyFocus.sourceArtifactNoise(evidence, plan)
      || storyFocus.editorialNoise(evidence, plan)) continue;
    const key = normalize(evidence);
    if (!key || seen.get(sourceId).has(key) || groups.get(sourceId).length >= MAX_FACTS_PER_SOURCE) continue;
    seen.get(sourceId).add(key);
    groups.get(sourceId).push(evidence);
  }
  return groups;
}

function buildFactCandidates(sources = [], topic = '') {
  const groups = collectFactGroups(sources, topic);
  const rows = [];
  const maxDepth = Math.max(0, ...[...groups.values()].map(evidence => evidence.length));
  let order = 0;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    for (const [sourceId, evidence] of groups.entries()) {
      const value = evidence[depth];
      if (!value) continue;
      const source = sourceForId(sources, sourceId) || {};
      const detail = semanticTokens(value, topic).length;
      const distinctive = distinctiveEvidenceTokens(value, topic).length;
      const evidenceWeight = source?.discovery?.evidenceMode === 'search-snippet' ? -0.45 : 0.25;
      rows.push({
        sourceId,
        evidence: value,
        sourceTitle: cleanEvidence(source.title),
        publishedAt: source.publishedAt || source.discovery?.publishedAt || null,
        order,
        score: Math.max(0, 8 - depth * 0.45 - order * 0.015)
          + Math.min(detail, 12) * 0.04
          + Math.min(distinctive, 8) * 0.08
          + evidenceWeight
          + (genericAnnouncement(value, topic) ? -0.25 : ANNOUNCEMENT.test(value) ? 0.05 : 0)
      });
      order += 1;
    }
  }
  return rows.sort((a, b) => b.score - a.score || a.order - b.order);
}

function selectDistinctFacts(sources = [], topic = '', count = SLIDE_COUNT) {
  const candidates = buildFactCandidates(sources, topic);
  if (!candidates.length) return [];
  const selected = [];
  const sourceUses = new Map();
  // An overview is useful only when it is already among the strongest lead
  // facts. Do not pull a vague "this update was announced" sentence from the
  // bottom of an article ahead of a concrete lead fact.
  const leading = candidates.slice(0, Math.max(count, sources.length));
  const overview = leading.find(candidate => genericAnnouncement(candidate.evidence, topic))
    || leading.find(candidate => ANNOUNCEMENT.test(candidate.evidence));
  const first = overview || candidates[0];
  selected.push(first);
  sourceUses.set(first.sourceId, 1);

  for (const threshold of [STRICT_FACT_SIMILARITY, RELAXED_FACT_SIMILARITY, 0.88]) {
    while (selected.length < count) {
      let best = null;
      for (const candidate of candidates) {
        if (selected.includes(candidate)) continue;
        if (selected.some(existing => sameFactContext(existing.evidence, candidate.evidence, topic))) continue;
        const maxSimilarity = Math.max(0, ...selected.map(existing => semanticSimilarity(existing.evidence, candidate.evidence, topic)));
        if (maxSimilarity >= threshold) continue;
        const uses = sourceUses.get(candidate.sourceId) || 0;
        const adjusted = candidate.score
          + (uses === 0 ? 0.55 : 0)
          - uses * 0.12
          + (1 - maxSimilarity) * 0.3
          + angleNovelty(candidate, selected, topic);
        if (!best || adjusted > best.adjusted) best = { candidate, adjusted };
      }
      if (!best) break;
      selected.push(best.candidate);
      sourceUses.set(best.candidate.sourceId, (sourceUses.get(best.candidate.sourceId) || 0) + 1);
    }
    if (selected.length >= count) break;
  }

  // Search-snippet fallback can legitimately expose fewer than four unique
  // sentences even though the topic itself is valid. Keep the universal topic
  // acceptance contract by filling only after every strict diversity pass has
  // been exhausted. Rich articles never enter this branch.
  if (selected.length < count) {
    const remaining = candidates
      .filter(candidate => !selected.includes(candidate))
      .map(candidate => ({
        candidate,
        similarity: Math.max(0, ...selected.map(existing => semanticSimilarity(existing.evidence, candidate.evidence, topic)))
      }))
      .sort((a, b) => a.similarity - b.similarity || b.candidate.score - a.candidate.score);
    for (const row of remaining) {
      if (selected.length >= count) break;
      selected.push({ ...row.candidate, sparseFallback: true });
    }
  }
  for (let index = 0; selected.length < count && candidates.length; index += 1) {
    selected.push({ ...candidates[index % candidates.length], sparseFallback: true });
  }
  return selected.slice(0, count);
}

function buildSlidePackets(sources = [], topic = '', format = 'Fakta singkat') {
  const selected = selectDistinctFacts(sources, topic, SLIDE_COUNT);
  const sections = sectionsForFormat(format);
  return selected.map((fact, slideIndex) => ({
    slideIndex,
    section: sections[slideIndex],
    primarySourceId: fact.sourceId,
    sourceTitle: fact.sourceTitle,
    publishedAt: fact.publishedAt,
    topic,
    mainEvidence: fact.evidence,
    sparseFallback: fact.sparseFallback === true,
    evidence: [fact.evidence]
  }));
}

function writerPrompt({ topic, format, packets }) {
  return `AUTO SOURCE SEDERHANA — TANPA URL.

TOPIK: ${JSON.stringify(topic)}
FORMAT: ${JSON.stringify(format)}
EMPAT FAKTA UNIK PER SLIDE:
${JSON.stringify(packets)}

TUGAS:
Tulis carousel Bahasa Indonesia 4 slide langsung dari fakta unik di atas.

ATURAN:
- Slide N WAJIB menjelaskan mainEvidence slide N dan mempertahankan detail pembeda utamanya, misalnya waktu, cakupan, mekanisme, batasan, atau dampak yang memang tertulis. Jangan menggantinya dengan headline umum atau fakta slide lain.
- Empat mainEvidence sudah dideduplikasi lintas sumber. Pertahankan empat sudut berbeda; jangan mengulang pengumuman yang sama dengan wording lain.
- Gunakan hanya evidence yang ada pada paket slide. Jangan memakai pengetahuan luar.
- Jangan jadikan komentar, lelucon, harapan, spekulasi, atau reaksi pembaca/pengguna sebagai fakta berita, kecuali TOPIK memang secara eksplisit meminta reaksi publik.
- Jangan menjadikan heading FAQ atau kalimat pertanyaan sebagai isi fakta. Body wajib pernyataan lengkap yang menjawab pembaca.
- Judul harus natural, spesifik, ringkas, dan Bahasa Indonesia; nama produk, model, perusahaan, singkatan, atau istilah teknis boleh tetap dalam bentuk aslinya.
- Body harus padat dan informatif, sekitar 10-16 kata. Letakkan detail pembeda mainEvidence sebelum keterangan umum agar tidak terpotong saat dirender. Jangan membuat body filler atau pertanyaan kosong.
- Bullet TIDAK wajib. Gunakan 0-3 bullet hanya jika mainEvidence memuat detail tambahan yang benar-benar berbeda dari judul/body. Setiap bullet harus utuh dan dapat dipahami sendiri.
- Jangan mengulang ide/konteks yang sama di body, bullet, atau slide lain.
- Jangan menambahkan sebab-akibat, manfaat, tujuan, strategi, implikasi, angka, versi, tanggal, lokasi, atau kepastian yang tidak dinyatakan evidence.
- Untuk body dan setiap bullet, WAJIB sertakan claim dengan field yang tepat, text sama persis dengan copy visible, sourceId sama dengan primarySourceId slide, dan evidence VERBATIM dari paket slide.
- Title tidak perlu claim jika hanya merangkum body secara editorial. Title tidak boleh menambahkan fakta baru yang tidak ada di body/evidence.

Kembalikan HANYA JSON:
{"slides":[{"title":"...","body":"...","points":["..."],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
}

function checkerPrompt({ topic, format, packets, candidate, errors = [] }) {
  return `FACT CHECK + EDITOR FINAL AUTO SOURCE.

TOPIK: ${JSON.stringify(topic)}
FORMAT: ${JSON.stringify(format)}
PAKET FAKTA TERPERCAYA:
${JSON.stringify(packets)}

DRAFT:
${JSON.stringify(candidate?.slides || [])}
${errors.length ? `
MASALAH DARI CEK FAKTA SEDERHANA YANG WAJIB DIPERBAIKI:
${errors.map(error => `- ${error}`).join('\n')}
` : ''}

PERIKSA DAN PERBAIKI LANGSUNG:
- Slide N harus tetap menjelaskan mainEvidence slide N dan mempertahankan detail pembeda utamanya; jangan mengubah semua slide menjadi pengumuman umum yang sama.
- Setiap body/bullet harus benar-benar dibuktikan satu evidence pada paket slide yang sama.
- Jika satu body salah/terlalu luas, tulis ulang secara konservatif dari evidence slide itu. Body harus berupa pernyataan lengkap, bukan FAQ/pertanyaan.
- Jika satu bullet salah, meragukan, terpotong, bergantung pada lanjutan kalimat, atau mengulang konteks, perbaiki atau HAPUS bullet tersebut. Jangan menggagalkan seluruh carousel.
- Jangan memaksa jumlah bullet; 0-3 bullet boleh.
- Jangan mencampur primarySourceId antar-slide.
- Jangan menambah fakta baru. Pertahankan angka, persentase, model, versi, nama, tanggal, lokasi, modalitas, dan ketidakpastian sesuai evidence.
- Jangan pertahankan komentar, lelucon, harapan, spekulasi, atau reaksi pembaca/pengguna sebagai fakta berita, kecuali TOPIK memang meminta reaksi publik.
- Body final sekitar 10-16 kata dan meletakkan detail pembeda di bagian awal.
- Judul harus natural Bahasa Indonesia, tetapi nama produk/model/istilah teknis boleh tetap asli. Judul hanya merangkum isi slide dan tidak boleh menambah klaim baru.
- Untuk body dan bullet final, claim.text harus sama persis dengan copy; sourceId harus primarySourceId slide; evidence harus VERBATIM dari paket slide.
- Hasil akhir harus padat, natural, tidak double context, dan tetap 4 slide.

Kembalikan HANYA JSON final dengan schema yang sama: {"slides":[...]}`;
}

function parseJsonResponse(response) {
  const value = response?.choices?.[0]?.message?.content;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const raw = Array.isArray(value) ? value.map(part => part?.text || '').join('') : value;
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Provider tidak mengembalikan JSON Auto Source.');
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1].trim() : trimmed);
}

function copyForField(slide, field) {
  const match = String(field || '').match(/^slide:\d+:(body|point:(\d+))$/);
  if (!match) return '';
  if (match[1] === 'body') return String(slide?.body || '').replace(/\s+/g, ' ').trim();
  return String(slide?.points?.[Number(match[2])] || '').replace(/\s+/g, ' ').trim();
}

function cleanupSlide(slide = {}, slideIndex = 0, packet = {}) {
  const title = String(slide.title || '').replace(/\s+/g, ' ').trim();
  const body = String(slide.body || '').replace(/\s+/g, ' ').trim();
  const keptPoints = [];
  const pointMap = new Map();
  for (const [oldIndex, raw] of (Array.isArray(slide.points) ? slide.points : []).entries()) {
    const point = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!point
      || keptPoints.length >= MAX_POINTS
      || questionOnlyEvidence(point)
      || endsWithDanglingFragment(point)
      || storyFocus.audienceReactionNoise(point, { rawTopic: packet?.topic, canonicalTopic: packet?.topic })) continue;
    if (similarity(point, body) >= 0.88 || similarity(point, title) >= 0.92) continue;
    if (keptPoints.some(existing => similarity(existing, point) >= 0.88)) continue;
    pointMap.set(oldIndex, keptPoints.length);
    keptPoints.push(point);
  }

  const claims = [];
  const seenFields = new Set();
  for (const original of Array.isArray(slide.claims) ? slide.claims : []) {
    let field = String(original?.field || '').trim();
    const pointMatch = field.match(new RegExp(`^slide:${slideIndex}:point:(\\d+)$`));
    if (pointMatch) {
      const newIndex = pointMap.get(Number(pointMatch[1]));
      if (newIndex === undefined) continue;
      field = `slide:${slideIndex}:point:${newIndex}`;
    }
    if (field !== `slide:${slideIndex}:body` && !new RegExp(`^slide:${slideIndex}:point:\\d+$`).test(field)) continue;
    if (seenFields.has(field)) continue;
    const copy = copyForField({ body, points: keptPoints }, field);
    if (!copy) continue;
    claims.push({
      field,
      text: copy,
      sourceId: String(original?.sourceId || '').trim(),
      evidence: String(original?.evidence || '').replace(/\s+/g, ' ').trim()
    });
    seenFields.add(field);
  }

  return {
    section: packet.section,
    title,
    body,
    points: keptPoints,
    claims
  };
}

function normalizeCandidate(parsed = {}, packets = []) {
  const rawSlides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  return {
    slides: packets.map((packet, index) => cleanupSlide(rawSlides[index] || {}, index, packet))
  };
}

function canonicalNumbers(value) {
  const out = [];
  const pattern = /\b(\d+(?:[.,]\d+)?)(?:\s*(%|persen|percent|per\s+cent))?/gi;
  for (const match of String(value || '').matchAll(pattern)) {
    let number = String(match[1]).replace(',', '.');
    if (/^\d+\.\d+$/.test(number)) number = number.replace(/0+$/, '').replace(/\.$/, '');
    out.push(`${number}${match[2] ? '%' : ''}`);
  }
  return out;
}

function numbersSupported(copy, evidence) {
  const wanted = canonicalNumbers(copy);
  if (!wanted.length) return true;
  const available = new Set(canonicalNumbers(evidence));
  return wanted.every(value => available.has(value));
}

function evidenceLiteralInSource(evidence, source) {
  const needle = normalize(evidence);
  if (!needle) return false;
  return normalize(`${source?.title || ''} ${source?.text || ''}`).includes(needle);
}

function evidenceAllowedByPacket(evidence, packet) {
  const key = normalize(evidence);
  return Boolean(key) && (packet?.evidence || []).some(value => normalize(value) === key);
}

function claimMap(slide = {}) {
  return new Map((Array.isArray(slide.claims) ? slide.claims : []).map(claim => [String(claim?.field || '').trim(), claim]));
}

function bestEvidenceForCopy(copy, packet = {}) {
  const copyTokens = meaningfulTokens(copy);
  const ranked = (packet.evidence || []).map(evidence => {
    const evidenceTokens = new Set(meaningfulTokens(evidence));
    const shared = copyTokens.filter(token => evidenceTokens.has(token)).length;
    const score = copyTokens.length ? shared / copyTokens.length : 0;
    return { evidence, score, numeric: numbersSupported(copy, evidence) };
  }).filter(item => item.numeric).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return null;
  if (best.score >= 0.2 || canonicalNumbers(copy).length) return best.evidence;
  return null;
}

function repairClaimMetadata(candidate, packets, sources) {
  const slides = candidate.slides.map((slide, slideIndex) => {
    const packet = packets[slideIndex];
    const map = claimMap(slide);
    const repaired = [];
    const fields = [
      [`slide:${slideIndex}:body`, slide.body],
      ...slide.points.map((point, pointIndex) => [`slide:${slideIndex}:point:${pointIndex}`, point])
    ];
    for (const [field, copy] of fields) {
      if (!copy) continue;
      const current = map.get(field);
      const currentSource = sourceForId(sources, current?.sourceId);
      const currentValid = current
        && current.sourceId === packet.primarySourceId
        && evidenceAllowedByPacket(current.evidence, packet)
        && evidenceLiteralInSource(current.evidence, currentSource)
        && numbersSupported(copy, current.evidence);
      if (currentValid) {
        repaired.push({ ...current, field, text: copy });
        continue;
      }
      const evidence = bestEvidenceForCopy(copy, packet);
      if (evidence) repaired.push({ field, text: copy, sourceId: packet.primarySourceId, evidence });
    }
    return { ...slide, claims: repaired };
  });
  return { ...candidate, slides };
}

function factualErrors(candidate, packets, sources) {
  const errors = [];
  if (!Array.isArray(candidate?.slides) || candidate.slides.length !== SLIDE_COUNT) {
    errors.push(`slides: wajib tepat ${SLIDE_COUNT} slide.`);
    return errors;
  }

  const previousFacts = [];
  candidate.slides.forEach((slide, slideIndex) => {
    const packet = packets[slideIndex];
    if (!packet) { errors.push(`slide:${slideIndex}: paket fakta tidak tersedia.`); return; }
    const plan = { rawTopic: packet?.topic, canonicalTopic: packet?.topic, marketIntent: false };
    if (!String(slide.title || '').trim()) errors.push(`slide:${slideIndex}:title kosong.`);
    if (!String(slide.body || '').trim()) errors.push(`slide:${slideIndex}:body kosong.`);
    if (storyFocus.sourceArtifactNoise(slide.title, plan)) {
      errors.push(`slide:${slideIndex}:title mengandung metadata atau kartu artikel terkait.`);
    }
    if (storyFocus.unsupportedHype(slide.title, packet?.mainEvidence)) {
      errors.push(`slide:${slideIndex}:title memakai klaim promosi yang tidak didukung sumber.`);
    }
    if (storyFocus.audienceReactionNoise(slide.title, plan)) {
      errors.push(`slide:${slideIndex}:title memakai komentar/reaksi audiens sebagai fakta berita.`);
    }
    if (storyFocus.marketingActivationNoise(slide.title, plan)) {
      errors.push(`slide:${slideIndex}:title memakai aktivasi pemasaran yang bukan inti topik.`);
    }
    if (questionOnlyEvidence(slide.body)) errors.push(`slide:${slideIndex}:body berupa FAQ/pertanyaan tanpa jawaban.`);
    if (endsWithDanglingFragment(slide.body)) errors.push(`slide:${slideIndex}:body terpotong atau berakhir pada kata gantung.`);
    if (storyFocus.sourceArtifactNoise(slide.body, plan)) {
      errors.push(`slide:${slideIndex}:body mengandung metadata atau kartu artikel terkait.`);
    }
    if (storyFocus.unsupportedHype(slide.body, packet?.mainEvidence)) {
      errors.push(`slide:${slideIndex}:body memakai klaim promosi yang tidak didukung sumber.`);
    }
    if (storyFocus.audienceReactionNoise(slide.body, plan)) {
      errors.push(`slide:${slideIndex}:body memakai komentar/reaksi audiens sebagai fakta berita.`);
    }
    if (storyFocus.marketingActivationNoise(slide.body, plan)) {
      errors.push(`slide:${slideIndex}:body memakai aktivasi pemasaran yang bukan inti topik.`);
    }
    const visibleSlideCopy = [slide.title, slide.body, ...(slide.points || [])].filter(Boolean).join(' ');
    if (!mainEvidenceCovered(visibleSlideCopy, packet)) {
      errors.push(`slide:${slideIndex}: detail pembeda mainEvidence tidak masuk ke copy visible.`);
    }
    if ((slide.points || []).length > MAX_POINTS) errors.push(`slide:${slideIndex}: terlalu banyak bullet.`);

    const map = claimMap(slide);
    const fields = [
      [`slide:${slideIndex}:body`, String(slide.body || '').trim()],
      ...(slide.points || []).map((point, pointIndex) => [`slide:${slideIndex}:point:${pointIndex}`, String(point || '').trim()])
    ];
    for (const [field, copy] of fields) {
      if (!copy) continue;
      const claim = map.get(field);
      if (!claim) { errors.push(`${field}: claim/evidence tidak ada.`); continue; }
      if (normalize(claim.text) !== normalize(copy)) errors.push(`${field}: claim.text tidak sama dengan copy.`);
      if (claim.sourceId !== packet.primarySourceId) errors.push(`${field}: sourceId tidak sesuai sumber slide.`);
      if (!evidenceAllowedByPacket(claim.evidence, packet)) errors.push(`${field}: evidence tidak berasal dari paket fakta slide.`);
      const source = sourceForId(sources, claim.sourceId);
      if (!evidenceLiteralInSource(claim.evidence, source)) errors.push(`${field}: evidence tidak ditemukan pada sumber.`);
      if (!numbersSupported(copy, claim.evidence)) errors.push(`${field}: angka/persentase tidak didukung evidence.`);
    }

    const substantive = [
      { field: `slide:${slideIndex}:body`, value: slide.body },
      ...(slide.points || []).map((value, pointIndex) => ({ field: `slide:${slideIndex}:point:${pointIndex}`, value }))
    ].filter(item => item.value);
    for (const item of substantive) {
      if (storyFocus.sourceArtifactNoise(item.value, plan)) {
        errors.push(`${item.field}: metadata atau kartu artikel terkait tidak boleh menjadi fakta.`);
        continue;
      }
      if (storyFocus.unsupportedHype(item.value, packet?.mainEvidence)) {
        errors.push(`${item.field}: klaim promosi tidak didukung evidence.`);
        continue;
      }
      if (storyFocus.audienceReactionNoise(item.value, plan)) {
        errors.push(`${item.field}: komentar/reaksi audiens tidak boleh dijadikan fakta berita.`);
        continue;
      }
      const duplicate = previousFacts.find(previous => sameFactContext(previous.value, item.value, packet?.topic || ''));
      if (duplicate) {
        errors.push(item.field.includes(':point:')
          ? `${item.field}: konteks/fakta mengulang copy sebelumnya.`
          : `slide:${slideIndex}: konteks/fakta mengulang slide sebelumnya.`);
        break;
      }
      previousFacts.push({ ...item, slideIndex });
    }
  });
  return [...new Set(errors)];
}

function sentence(value) {
  const text = cleanEvidence(value).replace(/[\s,;:]+$/g, '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function buildCaption(slides = [], fallback = '', topic = '') {
  const plan = { rawTopic: topic, canonicalTopic: topic };
  const selected = [];
  for (const slide of slides) {
    const body = cleanEvidence(slide?.body);
    if (!body
      || questionOnlyEvidence(body)
      || endsWithDanglingFragment(body)
      || storyFocus.audienceReactionNoise(body, plan)
      || storyFocus.marketingActivationNoise(body, plan)) continue;
    if (selected.some(existing => sameFactContext(existing, body, topic))) continue;
    selected.push(body);
    if (selected.length >= 2) break;
  }
  const safeFallback = cleanEvidence(fallback);
  if (!selected.length && safeFallback && !storyFocus.audienceReactionNoise(safeFallback, plan)) {
    selected.push(safeFallback);
  }
  return selected.map(sentence).filter(Boolean).join(' ');
}

function invalidPointCoordinates(errors = []) {
  const coordinates = new Set();
  errors.forEach(error => {
    const match = String(error || '').match(/^slide:(\d+):point:(\d+):/);
    if (match) coordinates.add(`${Number(match[1])}:${Number(match[2])}`);
  });
  return coordinates;
}

function dropInvalidPoints(candidate, errors = [], packets = []) {
  const invalid = invalidPointCoordinates(errors);
  if (!invalid.size) return candidate;
  const slides = candidate.slides.map((slide, slideIndex) => {
    const kept = [];
    const indexMap = new Map();
    slide.points.forEach((point, oldIndex) => {
      if (invalid.has(`${slideIndex}:${oldIndex}`)) return;
      indexMap.set(oldIndex, kept.length);
      kept.push(point);
    });
    const claims = [];
    for (const claim of slide.claims || []) {
      const pointMatch = String(claim.field || '').match(new RegExp(`^slide:${slideIndex}:point:(\\d+)$`));
      if (!pointMatch) { claims.push(claim); continue; }
      const next = indexMap.get(Number(pointMatch[1]));
      if (next === undefined) continue;
      claims.push({ ...claim, field: `slide:${slideIndex}:point:${next}`, text: kept[next] });
    }
    return cleanupSlide({ ...slide, points: kept, claims }, slideIndex, packets[slideIndex]);
  });
  return { ...candidate, slides };
}

function deriveSafeTitle(slide = {}) {
  const title = String(slide.title || '').trim();
  const body = String(slide.body || '').trim();
  if (title && !canonicalNumbers(title).some(value => !canonicalNumbers(body).includes(value)) && similarity(title, body) >= 0.15) return title;
  const tokens = words(body.replace(/[.!?]+$/g, ''));
  const fallback = tokens.slice(0, Math.min(7, tokens.length)).join(' ').replace(/[,;:\-–—]+$/g, '').trim();
  return fallback ? fallback.charAt(0).toLocaleUpperCase('id-ID') + fallback.slice(1) : (title || 'Fakta utama');
}

function groundedEvidenceCandidate(packets = []) {
  return {
    slides: packets.map((packet, slideIndex) => {
      const body = cleanEvidence(packet?.mainEvidence);
      return {
        section: packet?.section,
        title: deriveSafeTitle({ body }),
        body,
        points: [],
        claims: body ? [{
          field: `slide:${slideIndex}:body`,
          text: body,
          sourceId: packet?.primarySourceId,
          evidence: body
        }] : []
      };
    })
  };
}

function strictBlockingErrors(errors = []) {
  return errors.filter(error => !/:point:\d+:/.test(error));
}

function editorialOnlyError(error = '') {
  return /(?:detail pembeda mainEvidence tidak masuk ke copy visible|konteks\/fakta mengulang)/i.test(String(error || ''));
}

function unsafeBlockingErrors(errors = []) {
  return strictBlockingErrors(errors).filter(error => !editorialOnlyError(error));
}

function finalizeVisibleCopy(candidate, packets, sources) {
  let result = {
    ...candidate,
    slides: candidate.slides.map((slide, index) => ({ ...slide, title: deriveSafeTitle(slide), section: packets[index]?.section || slide.section }))
  };
  result = repairClaimMetadata(result, packets, sources);
  let errors = factualErrors(result, packets, sources);
  result = dropInvalidPoints(result, errors, packets);
  result = repairClaimMetadata(result, packets, sources);
  errors = factualErrors(result, packets, sources);
  return { candidate: result, errors };
}

function syncTop(candidate, topic, format, discovery) {
  const slides = candidate.slides || [];
  const first = slides[0] || {};
  const middle = slides.find((slide, index) => index > 0 && index < slides.length - 1 && slide.body) || first;
  const last = slides.at(-1) || first;
  return {
    topic,
    hook: String(first.title || topic).trim(),
    body: String(middle.body || first.body || topic).trim(),
    caption: buildCaption(slides, middle.body || first.body || topic, topic),
    hashtags: [],
    cta: String(last.title || 'Ringkasan').trim(),
    trendKeywordsUsed: [],
    content_angle: `ringkasan faktual terbaru tentang ${topic}`,
    primary_tool: 'tanpa tool',
    hook_pattern: 'auto-source-simple',
    verificationStatus: 'source_based',
    unsupportedClaims: [],
    effectiveContentFormat: format,
    slides,
    sourceMode: 'auto',
    sourceDiscovery: discovery ? {
      searchedAt: discovery.searchedAt,
      queries: discovery.queries || [],
      providers: discovery.providers || []
    } : undefined
  };
}

async function callJson(openai, system, user) {
  const response = await openai.chat.completions.create({
    model: config.aiModel,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' }
  });
  return parseJsonResponse(response);
}

async function compose({ options = {}, sources = [], discovery = null, client } = {}) {
  if (!sources.length) throw Object.assign(new Error('Auto Source tidak menemukan sumber yang dapat dibaca.'), { status: 422 });
  const topic = String(options.requestedTopic || discovery?.topic || sources[0]?.title || 'Topik sumber').trim();
  const format = options.contentFormat || 'Fakta singkat';
  const packets = buildSlidePackets(sources, topic, format);
  if (packets.length !== SLIDE_COUNT) {
    throw Object.assign(new Error('Auto Source belum menemukan fakta yang cukup untuk membentuk 4 slide.'), { status: 422 });
  }

  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let writerRaw;
  try {
    writerRaw = await callJson(
      openai,
      'Anda penulis carousel AI Ads Lab. Tulis hanya dari paket fakta yang diberikan; jangan mengarang dan jangan mencampur konteks.',
      writerPrompt({ topic, format, packets })
    );
  } catch (error) {
    throw Object.assign(new Error(`Auto Source gagal menulis draft: ${error.message}`), { status: 502 });
  }

  const writerCandidate = normalizeCandidate(writerRaw, packets);
  let checkerRaw;
  try {
    checkerRaw = await callJson(
      openai,
      'Anda fact-checker sekaligus editor final. Perbaiki bagian yang tidak didukung dan hapus bullet yang meragukan; jangan menggagalkan seluruh carousel.',
      checkerPrompt({ topic, format, packets, candidate: writerCandidate })
    );
  } catch {
    checkerRaw = writerRaw;
  }

  const checkedCandidate = normalizeCandidate(checkerRaw, packets);
  let finalized = finalizeVisibleCopy(checkedCandidate, packets, sources);

  // If the checker damaged a body/claim, prefer the writer version for that slide
  // when the original is factually cleaner. This keeps one bad correction from
  // destroying an otherwise usable carousel.
  if (finalized.errors.some(error => /:body:|body kosong/.test(error))) {
    const original = finalizeVisibleCopy(writerCandidate, packets, sources);
    const mergedSlides = finalized.candidate.slides.map((slide, index) => {
      const currentBodyErrors = finalized.errors.filter(error => error.startsWith(`slide:${index}:body`) || error === `slide:${index}:body kosong.`).length;
      const originalBodyErrors = original.errors.filter(error => error.startsWith(`slide:${index}:body`) || error === `slide:${index}:body kosong.`).length;
      return originalBodyErrors < currentBodyErrors ? original.candidate.slides[index] : slide;
    });
    finalized = finalizeVisibleCopy({ slides: mergedSlides }, packets, sources);
  }

  let blocking = strictBlockingErrors(finalized.errors);
  if (blocking.length) {
    try {
      // Give the last editor a clean, source-literal seed instead of asking it
      // to repair an already flattened/repeated draft. This makes the rescue
      // useful for arbitrary topics and keeps every slide tied to its packet.
      const groundedSeed = groundedEvidenceCandidate(packets);
      const rescueRaw = await callJson(
        openai,
        'Anda editor recovery terakhir. Perbaiki hanya masalah cek fakta yang disebut, pertahankan empat fakta berbeda, dan jangan menambah pengetahuan luar.',
        checkerPrompt({ topic, format, packets, candidate: groundedSeed, errors: blocking })
      );
      const rescued = finalizeVisibleCopy(normalizeCandidate(rescueRaw, packets), packets, sources);
      const rescuedBlocking = strictBlockingErrors(rescued.errors);
      if (rescuedBlocking.length < blocking.length) {
        finalized = rescued;
        blocking = rescuedBlocking;
      }
    } catch {}
  }

  // The AI writer must never turn a valid free-form topic into a user-facing
  // validation error merely because it flattened a distinguishing detail or
  // repeated an angle after the final editor pass. Rebuild from the four
  // already-selected source sentences instead. This candidate is conservative:
  // each visible body is literal evidence from its own source and contains no
  // generated bullet. The Indonesian-output layer translates it afterwards.
  if (blocking.length) {
    const grounded = finalizeVisibleCopy(groundedEvidenceCandidate(packets), packets, sources);
    const unsafe = unsafeBlockingErrors(grounded.errors);
    if (!unsafe.length) {
      finalized = grounded;
      blocking = [];
    }
  }

  if (blocking.length) {
    throw Object.assign(new Error(`Auto Source belum bisa membuktikan isi utama: ${blocking[0]}`), {
      status: 422,
      validationErrors: blocking
    });
  }

  return syncTop(finalized.candidate, topic, format, discovery);
}

module.exports = {
  compose,
  sectionsForFormat,
  collectFactGroups,
  buildFactCandidates,
  selectDistinctFacts,
  buildSlidePackets,
  normalizeCandidate,
  factualErrors,
  numbersSupported,
  evidenceLiteralInSource,
  repairClaimMetadata,
  dropInvalidPoints,
  groundedEvidenceCandidate,
  strictBlockingErrors,
  editorialOnlyError,
  unsafeBlockingErrors,
  finalizeVisibleCopy,
  similarity,
  semanticSimilarity,
  distinctiveEvidenceTokens,
  genericAnnouncement,
  explicitMonthAnchors,
  mainEvidenceCovered,
  factAngles,
  angleNovelty,
  sameFactContext,
  questionOnlyEvidence,
  endsWithDanglingFragment,
  buildCaption,
  SLIDE_COUNT,
  MAX_POINTS,
  STRICT_FACT_SIMILARITY,
  RELAXED_FACT_SIMILARITY
};
