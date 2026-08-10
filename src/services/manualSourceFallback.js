const HARD_METADATA = /(?:baca\s+juga|read\s+also|cookie\s+policy|privacy\s+(?:policy|notice|statement)|kebijakan\s+privasi|syarat\s+dan\s+ketentuan|terms\s+of\s+use|copyright|hak\s+cipta|newsletter|subscribe\b|ikuti\s+kami|follow\s+(?:me|us)|contact\s+us|hubungi\s+kami)/i;
const STOP = new Set(['yang','dan','atau','dari','untuk','dengan','tentang','cara','adalah','pada','itu','ini','sebagai','dapat','bisa','lebih','juga','sumber','fakta','artikel','bagian']);

const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '').trim().toLocaleLowerCase('id-ID').replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
const factKey = fact => `${String(fact?.sourceId || '').trim()}::${normalize(fact?.evidence)}`;
const visibleParts = slide => [slide?.body, ...(Array.isArray(slide?.points) ? slide.points : [])].map(value => String(value || '').trim()).filter(Boolean);
const allVisibleParts = slide => [slide?.title, ...visibleParts(slide)].map(value => String(value || '').trim()).filter(Boolean);
const meaningfulTokens = value => [...new Set(normalize(value).split(' ').filter(token => token.length > 2 && !STOP.has(token)))];

function boundedChunks(value, target = 24) {
  const text = String(value || '').trim();
  if (!text || HARD_METADATA.test(text)) return [];
  const tokens = words(text);
  if (tokens.length < 6) return [];
  if (tokens.length <= 26) return [text];
  const parts = Math.ceil(tokens.length / target);
  const size = Math.ceil(tokens.length / parts);
  const out = [];
  for (let start = 0; start < tokens.length; start += size) {
    const chunk = tokens.slice(start, start + size).join(' ').trim();
    if (words(chunk).length >= 6 && !HARD_METADATA.test(chunk)) out.push(chunk);
  }
  return out;
}

function sourceFacts(sources = []) {
  const queues = (sources || []).map((source, index) => {
    const sentences = String(source?.text || '').replace(/\r/g, '\n')
      .split(/(?<=[.!?])\s+|\n+/).map(value => value.trim()).filter(Boolean);
    const facts = sentences.flatMap(sentence => {
      if (HARD_METADATA.test(sentence)) return [];
      const clauses = sentence.split(/(?<=[;:])\s+|\s+[—–]\s+|,\s+(?=(?:sedangkan|sementara|tetapi|namun|dan)\s+)/i)
        .map(value => value.trim()).filter(Boolean);
      return clauses.flatMap(value => boundedChunks(value));
    });
    if (!facts.length) facts.push(...boundedChunks(String(source?.text || ''), 16));
    const seen = new Set();
    return facts.map(evidence => ({ sourceId: `source-${index + 1}`, evidence }))
      .filter(fact => {
        const key = factKey(fact);
        if (!normalize(fact.evidence) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  });
  const out = [];
  const seen = new Set();
  while (out.length < 48 && queues.some(queue => queue.length)) {
    for (const queue of queues) {
      const fact = queue.shift();
      if (!fact) continue;
      const key = factKey(fact);
      if (!seen.has(key)) { seen.add(key); out.push(fact); }
      if (out.length >= 48) break;
    }
  }
  return out;
}

function sourceCoverageErrors(content, sources = []) {
  const errors = [];
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const covered = new Set();
  const normalizedSources = (sources || []).map(source => normalize(source?.text || ''));
  slides.forEach((slide, slideIndex) => {
    const claims = Array.isArray(slide?.claims) ? slide.claims : [];
    const claimByField = new Map(claims.map(claim => [String(claim?.field || '').trim(), claim]));
    const fields = [
      [`slide:${slideIndex}:body`, String(slide?.body || '').trim()],
      ...(Array.isArray(slide?.points) ? slide.points.map((point, pointIndex) => [`slide:${slideIndex}:point:${pointIndex}`, String(point || '').trim()]) : [])
    ];
    for (const [field, value] of fields) {
      if (!value) continue;
      const claim = claimByField.get(field);
      if (!claim || normalize(claim.text) !== normalize(value)) {
        errors.push(`${field}: copy substantif tidak memiliki claim field/text yang cocok.`);
        continue;
      }
      const sourceIndex = Number(String(claim.sourceId || '').match(/^source-(\d+)$/)?.[1]) - 1;
      const sourceText = normalizedSources[sourceIndex];
      const evidence = normalize(claim.evidence);
      if (!sourceText || !evidence || !sourceText.includes(evidence)) {
        errors.push(`${field}: evidence tidak ditemukan pada URL sumber yang dirujuk.`);
        continue;
      }
      covered.add(`source-${sourceIndex + 1}`);
    }
  });
  (sources || []).forEach((_, index) => {
    const sourceId = `source-${index + 1}`;
    if (!covered.has(sourceId)) errors.push(`coverage:source: ${sourceId} belum menyumbang fakta ke konten final.`);
  });
  return [...new Set(errors)];
}

function densityTarget(facts = [], slideCount = 4) {
  const totalWords = facts.reduce((sum, fact) => sum + Math.min(26, words(fact?.evidence).length), 0);
  if (!totalWords) return 10;
  return Math.max(12, Math.min(22, Math.floor((totalWords / Math.max(1, slideCount)) * 0.72)));
}

function duplicateErrors(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  const factOwner = new Map();
  const copies = [];
  slides.forEach((slide, slideIndex) => {
    for (const claim of Array.isArray(slide?.claims) ? slide.claims : []) {
      const key = factKey(claim);
      if (!key || key.endsWith('::')) continue;
      if (factOwner.has(key) && factOwner.get(key) !== slideIndex) errors.push(`slide:${slideIndex}:duplicate: fakta canonical mengulang slide sebelumnya.`);
      else factOwner.set(key, slideIndex);
    }
    const copy = normalize(allVisibleParts(slide).join(' '));
    for (const previous of copies) {
      if (copy && copy === previous.copy) {
        errors.push(`slide:${slideIndex}:duplicate: isi sama dengan slide ${previous.slideIndex + 1}.`);
        break;
      }
    }
    copies.push({ slideIndex, copy });
  });
  return [...new Set(errors)];
}

function presentationErrors(content, facts = []) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const errors = [];
  const minWords = densityTarget(facts, slides.length || 4);
  if (slides.length < 4 || slides.length > 5) errors.push('layout: carousel sumber harus 4–5 slide.');
  slides.forEach((slide, slideIndex) => {
    const titleWords = words(slide?.title).length;
    const bodyCount = words(slide?.body).length;
    const points = Array.isArray(slide?.points) ? slide.points : [];
    const visibleCount = allVisibleParts(slide).reduce((sum, value) => sum + words(value).length, 0);
    if (!titleWords || titleWords > 12) errors.push(`slide:${slideIndex}:layout: title harus ringkas dan rapi (1–12 kata).`);
    if (!bodyCount || bodyCount > 26) errors.push(`slide:${slideIndex}:layout: body harus ada dan maksimal 26 kata.`);
    if (points.length > 2) errors.push(`slide:${slideIndex}:layout: maksimal 2 point agar slide tetap rapi.`);
    points.forEach((point, pointIndex) => {
      const count = words(point).length;
      if (count < 3 || count > 10) errors.push(`slide:${slideIndex}:point:${pointIndex}: point harus 3–10 kata.`);
    });
    if (visibleCount < minWords) errors.push(`slide:${slideIndex}:density: hanya ${visibleCount} kata; target aman minimal ${minWords} kata source-backed.`);
    if (HARD_METADATA.test(visibleParts(slide).join(' '))) errors.push(`slide:${slideIndex}:metadata: boilerplate website masuk ke konten.`);
  });
  return [...new Set(errors)];
}

function validateSourceContent(content, sources = []) {
  const facts = sourceFacts(sources);
  return [...sourceCoverageErrors(content, sources), ...presentationErrors(content, facts), ...duplicateErrors(content)];
}

function requestedListicleCount(sources = [], topic = '') {
  const cue = '(?:daftar|cara|tips?|hal|alasan|buah|makanan|fitur|fakta|langkah|tanda|jenis|kesalahan|manfaat|strategi|rekomendasi|pilihan|kebiasaan|trik|aplikasi|tools?|contoh|ide|poin|metode|teknik|produk|sayuran|minuman|ways?|things?|reasons?|features?|facts?|steps?|mistakes?|benefits?|foods?|fruits?|ideas?|methods?|types?|signs?)';
  const pattern = new RegExp(`(?:^|[^\\d])([45])\\s+${cue}\\b`, 'iu');
  for (const value of [...(sources || []).map(source => source?.title), topic]) {
    const match = String(value || '').replace(/\s+/g, ' ').trim().match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function excerpt(value, maxWords = 10) {
  return words(value).slice(0, maxWords).join(' ').trim();
}

function buildDeterministicSourceFallback({ generated = {}, sources = [], topic = '', requestedFormat = 'Fakta singkat' } = {}) {
  const facts = sourceFacts(sources);
  const groups = new Map((sources || []).map((_, index) => [`source-${index + 1}`, []]));
  facts.forEach(fact => groups.get(fact.sourceId)?.push(fact));
  const missing = [...groups.entries()].filter(([, entries]) => !entries.length).map(([sourceId]) => sourceId);
  if (missing.length) throw Object.assign(new Error(`URL sumber tidak memiliki teks faktual yang cukup untuk dipakai: ${missing.join(', ')}`), { status: 422 });

  const explicit = String(requestedFormat || '').toLocaleLowerCase('id-ID') === 'listicle' ? requestedListicleCount(sources, topic) : null;
  const targetCount = explicit || (facts.length >= 10 ? 5 : 4);
  const selected = [];
  const used = new Set();
  for (const [, entries] of groups) {
    const fact = entries[0];
    if (!fact) continue;
    selected.push(fact); used.add(factKey(fact));
  }
  for (const fact of facts) {
    if (selected.length >= targetCount) break;
    const key = factKey(fact);
    if (used.has(key)) continue;
    selected.push(fact); used.add(key);
  }
  if (selected.length < 4) throw Object.assign(new Error('Sumber dapat dibaca tetapi belum menyediakan empat potongan fakta unik untuk carousel.'), { status: 422 });

  const remaining = facts.filter(fact => !used.has(factKey(fact)));
  const isListicle = String(requestedFormat || '').toLocaleLowerCase('id-ID') === 'listicle';
  const sections = isListicle
    ? selected.map((_, index) => `ITEM ${index + 1}`)
    : selected.map((_, index) => index === 0 ? 'PEMBUKA' : index === selected.length - 1 ? 'KESIMPULAN' : index === 1 ? 'FAKTA UTAMA' : index === 2 ? 'PENJELASAN' : 'KONTEKS');
  const minWords = densityTarget(facts, selected.length);
  const slides = selected.map((fact, index) => {
    const body = String(fact.evidence || '').trim();
    const points = [];
    const claims = [{ field: `slide:${index}:body`, text: body, sourceId: fact.sourceId, evidence: fact.evidence }];
    let total = words(body).length;
    while (total < minWords && remaining.length && points.length < 2) {
      const detail = remaining.shift();
      const point = excerpt(detail.evidence, Math.min(10, Math.max(6, minWords - total)));
      if (!point) continue;
      points.push(point);
      claims.push({ field: `slide:${index}:point:${points.length - 1}`, text: point, sourceId: detail.sourceId, evidence: detail.evidence });
      total += words(point).length;
    }
    return {
      section: sections[index],
      title: isListicle ? `Poin ${index + 1} dari sumber` : index === 0 ? 'Ringkasan dari sumber' : index === selected.length - 1 ? 'Kesimpulan dari sumber' : `Fakta sumber ${index + 1}`,
      body,
      points,
      claims
    };
  });
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
  duplicateErrors,
  sourceFacts,
  densityTarget
};