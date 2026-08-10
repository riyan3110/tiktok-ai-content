const HARD_METADATA = /(?:baca\s+juga|read\s+also|cookie\s+policy|privacy\s+(?:policy|notice|statement)|kebijakan\s+privasi|syarat\s+dan\s+ketentuan|terms\s+of\s+use|copyright|hak\s+cipta|newsletter|subscribe\b|ikuti\s+kami|follow\s+(?:me|us)|contact\s+us|hubungi\s+kami|artikel\s+terkait|berita\s+terkait|recommended|rekomendasi)/i;
const GENERIC_TITLE = /^(?:ringkasan(?:\s+dari)?\s+sumber|kesimpulan(?:\s+dari)?\s+sumber|fakta\s+sumber(?:\s+\d+)?|poin\s+\d+\s+dari\s+sumber|draf\s+sumber|sorotan\s+utama\s+\d+|pokok\s+bahasan\s+\d+)$/i;
const SITE_META = /(?:\b(?:wib|wita|wit|gmt|utc)\b.*\b(?:url|link)\b|\b(?:url|link)\b.*\b(?:wib|wita|wit|gmt|utc)\b|^(?:oleh|by|editor|penulis|reporter|kontributor)\b|^(?:https?:\/\/|www\.)\S+)/i;
const BAD_FRAGMENT_END = new Set(['yang','dan','atau','di','ke','dari','dengan','oleh','pada','untuk','sebagai','secara','adalah','merupakan','berada','memiliki','menjadi','termasuk','maupun','karena','agar','jika','bila','saat','ketika','dalam','ini','itu']);
const LEADING_FILLER = /^(?:(?:selain|sementara|namun)\s+itu\s*,?\s*|hasilnya\s*,?\s*|melansir\s+[^,]{1,60},\s*|menurut\s+[^,]{1,60},\s*)/i;

const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '').trim().toLocaleLowerCase('id-ID').replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
const factKey = fact => `${String(fact?.sourceId || '').trim()}::${normalize(fact?.evidence)}`;
const visibleParts = slide => [slide?.body, ...(Array.isArray(slide?.points) ? slide.points : [])].map(value => String(value || '').trim()).filter(Boolean);
const allVisibleParts = slide => [slide?.title, ...visibleParts(slide)].map(value => String(value || '').trim()).filter(Boolean);

function endsWithFragment(value) {
  const raw = String(value || '').trim();
  if (!raw || /[,;:\-–—]$/.test(raw)) return true;
  return BAD_FRAGMENT_END.has(normalize(raw).split(' ').filter(Boolean).at(-1));
}

function isLowValueEvidence(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text || HARD_METADATA.test(text) || SITE_META.test(text)) return true;
  return /\b(?:senin|selasa|rabu|kamis|jumat|jum'at|sabtu|minggu)\b/i.test(text)
    && /\b\d{1,2}[:.]\d{2}\b/.test(text)
    && /\b(?:wib|wita|wit|gmt|utc)\b/i.test(text);
}

function boundedChunks(value, target = 22) {
  const text = String(value || '').trim();
  if (isLowValueEvidence(text)) return [];
  const tokens = words(text);
  if (tokens.length < 6) return [];
  if (tokens.length <= 24) return [text];
  const parts = Math.ceil(tokens.length / target);
  const size = Math.min(24, Math.ceil(tokens.length / parts));
  const out = [];
  for (let start = 0; start < tokens.length; start += size) {
    const chunk = tokens.slice(start, start + size).join(' ').trim();
    if (words(chunk).length >= 6 && words(chunk).length <= 24 && !isLowValueEvidence(chunk)) out.push(chunk);
  }
  return out;
}

function sourceFacts(sources = []) {
  const queues = (sources || []).map((source, index) => {
    const facts = String(source?.text || '').replace(/\r/g, '\n')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(value => value.trim()).filter(Boolean)
      .flatMap(sentence => {
        if (isLowValueEvidence(sentence)) return [];
        return sentence.split(/(?<=[;:])\s+|\s+[—–]\s+|,\s+(?=(?:sedangkan|sementara|tetapi|namun|dan)\s+)/i)
          .map(value => value.trim()).filter(Boolean).flatMap(value => boundedChunks(value));
      });
    if (!facts.length) facts.push(...boundedChunks(String(source?.text || ''), 18));
    const seen = new Set();
    return facts.map(evidence => ({ sourceId: `source-${index + 1}`, evidence })).filter(fact => {
      const key = factKey(fact);
      if (!normalize(fact.evidence) || seen.has(key) || isLowValueEvidence(fact.evidence)) return false;
      seen.add(key);
      return true;
    });
  });
  const out = [];
  const seen = new Set();
  while (out.length < 64 && queues.some(queue => queue.length)) {
    for (const queue of queues) {
      const fact = queue.shift();
      if (!fact) continue;
      const key = factKey(fact);
      if (!seen.has(key)) { seen.add(key); out.push(fact); }
      if (out.length >= 64) break;
    }
  }
  return out;
}

function sourceCoverageErrors(content, sources = []) {
  const errors = [];
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const covered = new Set();
  const sourceTexts = (sources || []).map(source => normalize(source?.text || ''));
  slides.forEach((slide, slideIndex) => {
    const claims = Array.isArray(slide?.claims) ? slide.claims : [];
    const byField = new Map(claims.map(claim => [String(claim?.field || '').trim(), claim]));
    const fields = [
      [`slide:${slideIndex}:body`, String(slide?.body || '').trim()],
      ...(Array.isArray(slide?.points) ? slide.points.map((point, pointIndex) => [`slide:${slideIndex}:point:${pointIndex}`, String(point || '').trim()]) : [])
    ];
    for (const [field, value] of fields) {
      if (!value) continue;
      const claim = byField.get(field);
      if (!claim || normalize(claim.text) !== normalize(value)) { errors.push(`${field}: copy substantif tidak memiliki claim field/text yang cocok.`); continue; }
      const sourceIndex = Number(String(claim.sourceId || '').match(/^source-(\d+)$/)?.[1]) - 1;
      const evidence = normalize(claim.evidence);
      if (!sourceTexts[sourceIndex] || !evidence || !sourceTexts[sourceIndex].includes(evidence)) { errors.push(`${field}: evidence tidak ditemukan pada URL sumber yang dirujuk.`); continue; }
      covered.add(`source-${sourceIndex + 1}`);
    }
  });
  (sources || []).forEach((_, index) => { if (!covered.has(`source-${index + 1}`)) errors.push(`coverage:source: source-${index + 1} belum menyumbang fakta ke konten final.`); });
  return [...new Set(errors)];
}

function sourceRichness(facts = [], slideCount = 4) {
  const perSlide = facts.length / Math.max(1, slideCount);
  const targetPoints = perSlide >= 4 ? 3 : perSlide >= 3 ? 2 : perSlide >= 2 ? 1 : 0;
  const bodyMin = perSlide >= 3 ? 10 : perSlide >= 2 ? 8 : 6;
  const visibleGoal = targetPoints >= 3 ? 30 : targetPoints === 2 ? 24 : targetPoints === 1 ? 20 : 16;
  return { targetPoints, minPoints: targetPoints, bodyMin, visibleGoal, hardFloor: bodyMin + (targetPoints * 3) };
}
function densityGoal(facts = [], slideCount = 4) { return sourceRichness(facts, slideCount).visibleGoal; }
function densityTarget(facts = [], slideCount = 4) { return sourceRichness(facts, slideCount).hardFloor; }

function duplicateErrors(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  const factOwner = new Map();
  const copies = [];
  slides.forEach((slide, slideIndex) => {
    const slideFacts = new Set();
    for (const claim of Array.isArray(slide?.claims) ? slide.claims : []) {
      const field = String(claim?.field || '').trim();
      if (field.endsWith(':title')) continue;
      const key = factKey(claim);
      if (!key || key.endsWith('::')) continue;
      if (slideFacts.has(key)) errors.push(`slide:${slideIndex}:duplicate: evidence yang sama dipakai lebih dari sekali dalam satu slide (body/bullet).`);
      slideFacts.add(key);
      if (factOwner.has(key) && factOwner.get(key) !== slideIndex) errors.push(`slide:${slideIndex}:duplicate: fakta canonical mengulang slide sebelumnya.`);
      else factOwner.set(key, slideIndex);
    }
    const copy = normalize(allVisibleParts(slide).join(' '));
    if (copies.some(previous => copy && copy === previous.copy)) errors.push(`slide:${slideIndex}:duplicate: isi sama dengan slide sebelumnya.`);
    copies.push({ slideIndex, copy });
  });
  return [...new Set(errors)];
}

function naturalCopyErrors(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  const titles = new Map();
  slides.forEach((slide, slideIndex) => {
    const title = String(slide?.title || '').trim();
    const body = String(slide?.body || '').trim();
    const titleKey = normalize(title);
    if (GENERIC_TITLE.test(title)) errors.push(`slide:${slideIndex}:natural: judul generik fallback dilarang; buat judul spesifik dari fakta slide.`);
    if (titleKey && titles.has(titleKey)) errors.push(`slide:${slideIndex}:natural: judul mengulang slide ${titles.get(titleKey) + 1}.`);
    else if (titleKey) titles.set(titleKey, slideIndex);
    if (isLowValueEvidence(body)) errors.push(`slide:${slideIndex}:natural: body mengandung metadata/related content.`);
    if (endsWithFragment(body)) errors.push(`slide:${slideIndex}:natural: body berakhir sebagai fragmen kalimat.`);
    (slide?.points || []).forEach((point, pointIndex) => {
      if (isLowValueEvidence(point)) errors.push(`slide:${slideIndex}:point:${pointIndex}: metadata/related content dilarang.`);
      if (endsWithFragment(point)) errors.push(`slide:${slideIndex}:point:${pointIndex}: bullet terpotong atau berakhir pada kata gantung.`);
    });
  });
  return [...new Set(errors)];
}

function presentationErrors(content, facts = []) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  const profile = sourceRichness(facts, slides.length || 4);
  if (slides.length < 4 || slides.length > 5) errors.push('layout: carousel sumber harus 4–5 slide.');
  slides.forEach((slide, slideIndex) => {
    const titleCount = words(slide?.title).length;
    const bodyCount = words(slide?.body).length;
    const points = Array.isArray(slide?.points) ? slide.points : [];
    if (!titleCount || titleCount > 12) errors.push(`slide:${slideIndex}:layout: title harus ringkas dan rapi (1–12 kata).`);
    if (bodyCount < profile.bodyMin || bodyCount > 24) errors.push(`slide:${slideIndex}:layout: body harus ${profile.bodyMin}–24 kata agar cukup menjelaskan konteks.`);
    if (points.length > 3) errors.push(`slide:${slideIndex}:layout: maksimal 3 point agar slide tetap rapi.`);
    if (points.length < profile.minPoints) errors.push(`slide:${slideIndex}:richness: hanya ${points.length} point; source cukup kaya untuk minimal ${profile.minPoints} point fakta berbeda.`);
    points.forEach((point, pointIndex) => { const count = words(point).length; if (count < 3 || count > 7) errors.push(`slide:${slideIndex}:point:${pointIndex}: point harus 3–7 kata.`); });
    if (HARD_METADATA.test(visibleParts(slide).join(' '))) errors.push(`slide:${slideIndex}:metadata: boilerplate website masuk ke konten.`);
  });
  return [...new Set(errors)];
}

function validateSourceContent(content, sources = []) {
  const facts = sourceFacts(sources);
  return [...sourceCoverageErrors(content, sources), ...presentationErrors(content, facts), ...naturalCopyErrors(content), ...duplicateErrors(content)];
}

function requestedListicleCount(sources = [], topic = '') {
  const cue = '(?:daftar|cara|tips?|hal|alasan|buah|makanan|fitur|fakta|langkah|tanda|jenis|kesalahan|manfaat|strategi|rekomendasi|pilihan|kebiasaan|trik|aplikasi|tools?|contoh|ide|poin|metode|teknik|produk|sayuran|minuman|ways?|things?|reasons?|features?|facts?|steps?|mistakes?|benefits?|foods?|fruits?|ideas?|methods?|types?|signs?)';
  const pattern = new RegExp(`(?:^|[^\\d])([45])\\s+${cue}\\b`, 'iu');
  for (const value of [...(sources || []).map(source => source?.title), topic]) { const match = String(value || '').replace(/\s+/g, ' ').trim().match(pattern); if (match) return Number(match[1]); }
  return null;
}

function excerpt(value, maxWords = 7) { return words(value).slice(0, maxWords).join(' ').trim(); }
function trimDangling(value, minWords = 3) {
  const tokens = words(String(value || '').replace(/[,:;\-–—]+$/g, '').trim());
  while (tokens.length > minWords && BAD_FRAGMENT_END.has(normalize(tokens.at(-1)))) tokens.pop();
  return tokens.join(' ').trim();
}

function compactPoint(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().replace(LEADING_FILLER, '');
  if (isLowValueEvidence(text)) return '';
  const clauses = text.split(/[.;!?]+|\s+[—–]\s+|,\s+/).map(part => part.trim()).filter(Boolean);
  const direct = clauses.find(part => words(part).length >= 3 && words(part).length <= 7 && !endsWithFragment(part) && !isLowValueEvidence(part));
  if (direct) return trimDangling(direct, 3);
  for (const clause of clauses) {
    if (words(clause).length < 3 || isLowValueEvidence(clause)) continue;
    const candidate = trimDangling(excerpt(clause, 7), 3);
    if (words(candidate).length >= 3 && !endsWithFragment(candidate)) return candidate;
  }
  return '';
}

function naturalTitleFromEvidence(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim().replace(LEADING_FILLER, '');
  text = text.replace(/^[A-ZÀ-Ý][\p{L} .'-]{1,30},\s*[A-ZÀ-Ý][\p{L}0-9 .'-]{1,40}\s*--\s*/u, '').trim();
  const clauses = text.split(/[.!?]+|\s+[—–]\s+|,\s+/).map(part => part.trim()).filter(Boolean);
  let chosen = clauses.find(part => words(part).length >= 4 && words(part).length <= 9) || trimDangling(excerpt(text, 8), 3);
  chosen = trimDangling(chosen, 3).replace(/[,:;.!?]+$/g, '').trim();
  if (words(chosen).length < 3) chosen = trimDangling(excerpt(text, 8), 3);
  return chosen ? chosen.charAt(0).toLocaleUpperCase('id-ID') + chosen.slice(1) : '';
}

function tokenKey(value) { return normalize(value).split(' ').filter(Boolean); }
function expandEvidenceForBody(sourceText, preferredEvidence, minWords = 10, maxWords = 24) {
  const text = String(sourceText || '').replace(/\s+/g, ' ').trim();
  const preferred = String(preferredEvidence || '').replace(/\s+/g, ' ').trim();
  if (!text) return preferred;
  const sourceTokens = words(text);
  const preferredTokens = words(preferred);
  const sourceKeys = sourceTokens.map(token => tokenKey(token).join(' '));
  const preferredKeys = preferredTokens.map(token => tokenKey(token).join(' '));
  let start = -1;
  if (preferredKeys.length) {
    outer: for (let i = 0; i <= sourceKeys.length - preferredKeys.length; i += 1) {
      for (let j = 0; j < preferredKeys.length; j += 1) if (sourceKeys[i + j] !== preferredKeys[j]) continue outer;
      start = i; break;
    }
  }
  if (start < 0) return preferredTokens.length >= minWords ? excerpt(preferred, maxWords) : sourceTokens.slice(0, maxWords).join(' ');
  let left = start;
  let right = start + preferredTokens.length;
  while ((right - left) < minWords && (left > 0 || right < sourceTokens.length)) {
    if (right < sourceTokens.length) right += 1;
    if ((right - left) < minWords && left > 0) left -= 1;
  }
  while ((right - left) < maxWords && right < sourceTokens.length && BAD_FRAGMENT_END.has(normalize(sourceTokens[right - 1]))) right += 1;
  if ((right - left) > maxWords) right = left + maxWords;
  return sourceTokens.slice(left, right).join(' ').trim();
}

function completeBody(value, minWords = 10) {
  const tokens = words(value).slice(0, 24);
  while (tokens.length > minWords && BAD_FRAGMENT_END.has(normalize(tokens.at(-1)))) tokens.pop();
  return tokens.join(' ').trim();
}

function buildDeterministicSourceFallback({ generated = {}, sources = [], topic = '', requestedFormat = 'Fakta singkat' } = {}) {
  const facts = sourceFacts(sources);
  const groups = new Map((sources || []).map((_, index) => [`source-${index + 1}`, []]));
  facts.forEach(fact => groups.get(fact.sourceId)?.push(fact));
  const missing = [...groups.entries()].filter(([, entries]) => !entries.length).map(([sourceId]) => sourceId);
  if (missing.length) throw Object.assign(new Error(`URL sumber tidak memiliki teks faktual yang cukup untuk dipakai: ${missing.join(', ')}`), { status: 422 });

  const explicit = String(requestedFormat || '').toLocaleLowerCase('id-ID') === 'listicle' ? requestedListicleCount(sources, topic) : null;
  const targetCount = Math.min(5, explicit || (facts.length >= 10 ? 5 : 4));
  const selected = [];
  const used = new Set();
  for (const fact of facts) { if (selected.length >= targetCount) break; const key = factKey(fact); if (!used.has(key)) { used.add(key); selected.push(fact); } }
  if (selected.length < 4) throw Object.assign(new Error('Sumber dapat dibaca tetapi belum menyediakan empat potongan fakta unik untuk carousel.'), { status: 422 });

  const remaining = facts.filter(fact => !used.has(factKey(fact)));
  const isListicle = String(requestedFormat || '').toLocaleLowerCase('id-ID') === 'listicle';
  const sections = isListicle
    ? selected.map((_, index) => `ITEM ${index + 1}`)
    : selected.map((_, index) => index === 0 ? 'PEMBUKA' : index === selected.length - 1 ? 'KESIMPULAN' : index === 1 ? 'FAKTA UTAMA' : index === 2 ? 'PENJELASAN' : 'KONTEKS');
  const profile = sourceRichness(facts, selected.length);

  const slides = selected.map((fact, index) => {
    const sourceIndex = Number(String(fact.sourceId).match(/^source-(\d+)$/)?.[1]) - 1;
    const source = sources[sourceIndex] || {};
    const bodyEvidence = expandEvidenceForBody(source.text, fact.evidence, Math.max(10, profile.bodyMin), 24);
    const body = completeBody(bodyEvidence, Math.max(10, profile.bodyMin));
    const title = naturalTitleFromEvidence(fact.evidence || bodyEvidence);
    if (!title || GENERIC_TITLE.test(title)) throw Object.assign(new Error('Fallback sumber tidak dapat membentuk judul natural yang spesifik.'), { status: 422 });
    return {
      section: sections[index], title, body, points: [],
      claims: [
        { field: `slide:${index}:title`, text: title, sourceId: fact.sourceId, evidence: bodyEvidence },
        { field: `slide:${index}:body`, text: body, sourceId: fact.sourceId, evidence: bodyEvidence }
      ]
    };
  });

  const coveredSourceIds = new Set(slides.map((slide, index) => slide.claims.find(claim => claim.field === `slide:${index}:body`)?.sourceId).filter(Boolean));
  for (const [slideIndex, slide] of slides.entries()) {
    const bodySourceId = slide.claims.find(claim => claim.field === `slide:${slideIndex}:body`)?.sourceId;
    while (slide.points.length < profile.targetPoints && remaining.length) {
      let idx = remaining.findIndex(detail => !coveredSourceIds.has(detail.sourceId));
      if (idx < 0) idx = remaining.findIndex(detail => detail.sourceId === bodySourceId);
      if (idx < 0) idx = 0;
      const [detail] = remaining.splice(idx, 1);
      const point = compactPoint(detail.evidence);
      if (!point || endsWithFragment(point) || slide.points.some(existing => normalize(existing) === normalize(point))) continue;
      const pointIndex = slide.points.length;
      slide.points.push(point);
      slide.claims.push({ field: `slide:${slideIndex}:point:${pointIndex}`, text: point, sourceId: detail.sourceId, evidence: detail.evidence });
      coveredSourceIds.add(detail.sourceId);
    }
  }

  const first = slides[0];
  const last = slides.at(-1);
  const resolvedTopic = String(topic || generated?.topic || sources?.[0]?.title || 'Ringkasan sumber').trim();
  const result = {
    ...generated,
    topic: resolvedTopic,
    hook: first.title,
    body: first.body,
    caption: first.body,
    cta: last.title,
    content_angle: generated?.content_angle || `fakta sumber tentang ${resolvedTopic}`,
    primary_tool: generated?.primary_tool || 'tanpa tool',
    hook_pattern: generated?.hook_pattern || 'source-locked',
    verificationStatus: 'source_based',
    unsupportedClaims: [],
    slides,
    __deterministicSourceFallback: true
  };
  if (!isListicle) result.effectiveContentFormat = 'Fakta singkat';
  return result;
}

module.exports = {
  buildDeterministicSourceFallback,
  validateSourceContent,
  sourceCoverageErrors,
  presentationErrors,
  naturalCopyErrors,
  duplicateErrors,
  sourceFacts,
  sourceRichness,
  densityGoal,
  densityTarget,
  requestedListicleCount,
  expandEvidenceForBody,
  compactPoint,
  naturalTitleFromEvidence,
  isLowValueEvidence
};