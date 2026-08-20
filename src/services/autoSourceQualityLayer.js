const strict = require('./autoSourceStrictFinalizer');
const sourceUrlFinalizer = require('./sourceUrlFinalizer');

// TANPA URL / AUTO SOURCE ONLY.
// autoSourcePatch installs this layer only after Pakai URL has been excluded.
let installed = false;
let originalStrictPrompt = null;
let originalValidateStrictCandidate = null;
let originalStrictDensityProfile = null;

function normalize(value) {
  return String(value || '').toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function lexicalTokens(value) {
  return [...new Set(normalize(value).split(' ').filter(token => token.length > 2 || token === 'ai'))];
}

function evidenceRelated(left, right) {
  const a = lexicalTokens(left);
  const b = lexicalTokens(right);
  if (!a.length || !b.length) return false;
  const shared = a.filter(token => b.includes(token)).length;
  return shared >= 2 && shared / Math.min(a.length, b.length) >= 0.55;
}

function topicScopedFacts(sources = [], facts = [], topic = '') {
  const scoped = sourceUrlFinalizer.relevantSourceFacts(sources, facts, topic);
  return scoped.length ? scoped : facts;
}

function groupedBySource(facts = []) {
  const groups = new Map();
  for (const fact of facts) {
    const sourceId = String(fact?.sourceId || '').trim();
    const evidence = String(fact?.evidence || '').replace(/\s+/g, ' ').trim();
    const key = normalize(evidence);
    if (!sourceId || !key) continue;
    if (!groups.has(sourceId)) groups.set(sourceId, []);
    if (!groups.get(sourceId).some(item => normalize(item.evidence) === key)) {
      groups.get(sourceId).push({ sourceId, evidence });
    }
  }
  return groups;
}

function slideCapacityForPoints(facts = [], pointCount = 3) {
  const factsPerSlide = 1 + Math.max(0, pointCount); // one body + N optional bullets
  return [...groupedBySource(facts).values()]
    .reduce((sum, queue) => sum + Math.floor(queue.length / factsPerSlide), 0);
}

function coherentDensityProfile(facts = [], slideCount = 4) {
  const count = Math.max(1, Number(slideCount) || 4);
  let targetPoints = 0;
  for (const candidate of [3, 2, 1]) {
    if (slideCapacityForPoints(facts, candidate) >= count) {
      targetPoints = candidate;
      break;
    }
  }
  return {
    bodyMin: targetPoints >= 2 ? 10 : 8,
    bodyMax: 20,
    // targetPoints is planning capacity only. It is NOT a minimum visible bullet count.
    targetPoints,
    richEnoughForThree: targetPoints === 3
  };
}

function buildCoherentPlan(sources = [], facts = [], slideCount = 4) {
  const groups = groupedBySource(facts);
  const sourceIds = sources.map((_, index) => `source-${index + 1}`).filter(id => groups.get(id)?.length);
  if (!sourceIds.length || !slideCount) return [];

  const profile = coherentDensityProfile(facts, slideCount);
  const factsPerSlide = 1 + profile.targetPoints;
  const queues = new Map(sourceIds.map(id => [id, [...groups.get(id)]]));
  const owners = [];

  // Every selected source gets a slide first. Remaining slides go to a source
  // that can still support useful optional detail without borrowing facts from another source.
  for (const id of sourceIds) {
    if (owners.length >= slideCount) break;
    owners.push(id);
  }
  while (owners.length < slideCount) {
    const usedBySource = new Map(sourceIds.map(id => [id, owners.filter(owner => owner === id).length]));
    const ranked = [...sourceIds].sort((a, b) => {
      const aRemaining = (queues.get(a)?.length || 0) - (usedBySource.get(a) || 0) * factsPerSlide;
      const bRemaining = (queues.get(b)?.length || 0) - (usedBySource.get(b) || 0) * factsPerSlide;
      return bRemaining - aRemaining;
    });
    const capable = ranked.find(id => {
      const used = usedBySource.get(id) || 0;
      return (queues.get(id)?.length || 0) >= (used + 1) * factsPerSlide;
    });
    owners.push(capable || ranked[0] || sourceIds[owners.length % sourceIds.length]);
  }

  const plan = [];
  for (let slideIndex = 0; slideIndex < owners.length; slideIndex += 1) {
    const sourceId = owners[slideIndex];
    const queue = queues.get(sourceId) || [];
    const evidence = queue.splice(0, Math.max(1, factsPerSlide));
    plan.push({ slide: slideIndex + 1, primarySourceId: sourceId, evidence });
  }
  return plan;
}

function substantiveClaims(slide) {
  return (Array.isArray(slide?.claims) ? slide.claims : []).filter(claim =>
    /^slide:\d+:(?:body|point:\d+)$/.test(String(claim?.field || '').trim())
  );
}

function factualTitleClaim(slide) {
  return (Array.isArray(slide?.claims) ? slide.claims : []).find(claim =>
    /^slide:\d+:title$/.test(String(claim?.field || '').trim())
  ) || null;
}

function slideSourceCoherenceErrors(content = {}) {
  const errors = [];
  for (const [slideIndex, slide] of (content?.slides || []).entries()) {
    const claims = substantiveClaims(slide);
    if (!claims.length) continue;
    const body = claims.find(claim => String(claim.field).endsWith(':body'));
    const counts = new Map();
    for (const claim of claims) {
      const sourceId = String(claim?.sourceId || '').trim();
      if (sourceId) counts.set(sourceId, (counts.get(sourceId) || 0) + 1);
    }
    const primary = String(body?.sourceId || '').trim()
      || [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      || '';
    if (!primary) continue;
    const titleClaim = factualTitleClaim(slide);
    const checkedClaims = titleClaim ? [...claims, titleClaim] : claims;
    for (const claim of checkedClaims) {
      const sourceId = String(claim?.sourceId || '').trim();
      if (!sourceId || sourceId === primary) continue;
      errors.push(`${claim.field}: AUTO_SOURCE_COHERENCE: slide ${slideIndex + 1} mencampur ${primary} dengan ${sourceId}; judul, body, dan bullet faktual harus mengikuti satu sumber utama dan satu subtopik.`);
    }
  }
  return errors;
}

function sourceLiteralEvidence(sourceId, rawEvidence, sources = []) {
  const match = String(sourceId || '').match(/^source-(\d+)$/);
  if (!match) return false;
  const source = sources[Number(match[1]) - 1];
  if (!source) return false;
  const evidence = normalize(rawEvidence);
  if (!evidence) return false;
  const haystack = normalize(`${source?.title || ''} ${source?.text || ''}`);
  return Boolean(haystack) && haystack.includes(evidence);
}

function topicEvidenceErrors(content = {}, facts = [], sources = []) {
  const allowed = groupedBySource(facts);
  const errors = [];
  for (const slide of content?.slides || []) {
    const titleClaim = factualTitleClaim(slide);
    const claims = titleClaim ? [...substantiveClaims(slide), titleClaim] : substantiveClaims(slide);
    for (const claim of claims) {
      const sourceId = String(claim?.sourceId || '').trim();
      const rawEvidence = String(claim?.evidence || '').replace(/\s+/g, ' ').trim();
      const evidence = normalize(rawEvidence);
      const bank = allowed.get(sourceId) || [];
      if (!sourceId || !evidence) continue;
      const supportedByBank = bank.some(item => {
        const candidate = normalize(item.evidence);
        return candidate && (
          candidate === evidence
          || evidence.includes(candidate)
          || candidate.includes(evidence)
          || evidenceRelated(rawEvidence, item.evidence)
        );
      });
      // Evidence recovery may widen a valid quote beyond the topic-scoped fact-bank
      // fragment. If the widened quote is still literal in the same selected source,
      // keep it; plan ownership + semantic entailment remain the factual gates.
      const supported = supportedByBank || sourceLiteralEvidence(sourceId, rawEvidence, sources);
      if (!supported) {
        errors.push(`${claim.field}: AUTO_SOURCE_CONTEXT: evidence tidak termasuk fact bank yang relevan dengan topik untuk ${sourceId}.`);
      }
    }
  }
  return errors;
}

function capacityDensityErrors(content = {}, facts = []) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  if (!slides.length) return [];
  const profile = coherentDensityProfile(facts, slides.length);
  const errors = [];
  slides.forEach((slide, slideIndex) => {
    const bodyCount = String(slide?.body || '').trim().split(/\s+/).filter(Boolean).length;
    const points = Array.isArray(slide?.points) ? slide.points : [];
    if (bodyCount < 8 || bodyCount > 24) {
      errors.push(`slide:${slideIndex}:body: AUTO_SOURCE_DENSITY: body harus 8-24 kata agar padat dan tetap rapi.`);
    }
    if (points.length > 3) {
      errors.push(`slide:${slideIndex}:body: AUTO_SOURCE_DENSITY: maksimal 3 bullet; gunakan hanya detail tambahan yang unik.`);
    }
  });
  return [...new Set(errors)];
}

const forcedDensityErrors = capacityDensityErrors;

function coherentPrompt(args = {}) {
  const scopedFacts = topicScopedFacts(args.sources, args.facts, args.topic);
  const sections = sourceUrlFinalizer.targetSections(
    args.generated,
    args.format,
    scopedFacts,
    args.sources,
    args.topic
  );
  const profile = coherentDensityProfile(scopedFacts, sections.length);
  const plan = buildCoherentPlan(args.sources, scopedFacts, sections.length);
  const base = originalStrictPrompt({ ...args, facts: scopedFacts });
  const densityRule = 'Bullet bukan target jumlah: gunakan 0-3 bullet hanya untuk fakta tambahan yang unik. Body yang sudah padat boleh berdiri sendiri tanpa bullet.';
  return `${base}\n\nAUTO SOURCE COHERENCE CONTRACT — MENGALAHKAN FACT PLAN/DENSITY GLOBAL DI ATAS:\nCOHERENT SOURCE PLAN PER SLIDE:\n${JSON.stringify(plan)}\n\nATURAN TAMBAHAN WAJIB:\n- SATU SLIDE = SATU SUBTOPIK = SATU primarySourceId dari COHERENT SOURCE PLAN.\n- Body dan semua bullet pada slide yang sama WAJIB memakai primarySourceId yang sama. Jika title memiliki claim faktual, claim title juga WAJIB memakai primarySourceId yang sama. DILARANG mencampur artikel/sumber berbeda dalam satu slide.\n- Gunakan evidence yang dialokasikan pada slide itu sebagai prioritas. Jika perlu mengganti, pilih evidence LAIN dari primarySourceId yang sama, masih relevan dengan TOPIK USER, dan belum dipakai slide lain.\n- Jangan memasukkan fakta sampingan dari artikel yang hanya kebetulan mengandung kata AI/Indonesia/perusahaan tetapi tidak menjelaskan topik user.\n- Setiap slide harus koheren seperti contoh editorial: judul menjawab satu pertanyaan/subtopik, body menjelaskan inti, lalu bullet hanya menambah detail tentang inti yang sama.\n- ${densityRule}\n- Semua sumber terpilih tetap WAJIB terwakili, tetapi penyebarannya dilakukan antar-slide, BUKAN dicampur dalam satu slide.\n- Jangan gunakan fakta dari sourceId lain hanya untuk mengejar kepadatan. Akurasi konteks lebih penting daripada filler.`;
}

function coherentValidate(args = {}) {
  const scopedFacts = topicScopedFacts(args.sources, args.facts, args.topic);
  const result = originalValidateStrictCandidate({ ...args, facts: scopedFacts });
  const originalErrors = (result.errors || []).filter(error => !/^AUTO_SOURCE_DENSITY:/i.test(String(error || '').trim()));
  const errors = [
    ...originalErrors,
    ...slideSourceCoherenceErrors(result.candidate),
    ...topicEvidenceErrors(result.candidate, scopedFacts, args.sources || []),
    ...capacityDensityErrors(result.candidate, scopedFacts)
  ];
  return { candidate: result.candidate, errors: [...new Set(errors)] };
}

function install() {
  if (installed) return false;
  originalStrictPrompt = strict.strictPrompt;
  originalValidateStrictCandidate = strict.validateStrictCandidate;
  originalStrictDensityProfile = strict.strictDensityProfile;
  strict.strictPrompt = coherentPrompt;
  strict.validateStrictCandidate = coherentValidate;
  // Resilient finalizer reads this exported function dynamically. targetPoints is
  // retained only as planning capacity; output no longer has a bullet minimum.
  strict.strictDensityProfile = coherentDensityProfile;
  installed = true;
  return true;
}

module.exports = {
  install,
  topicScopedFacts,
  buildCoherentPlan,
  slideSourceCoherenceErrors,
  topicEvidenceErrors,
  capacityDensityErrors,
  forcedDensityErrors,
  evidenceRelated,
  sourceLiteralEvidence,
  slideCapacityForPoints,
  coherentDensityProfile,
  factualTitleClaim,
  isInstalled: () => installed,
  originalStrictDensityProfile: () => originalStrictDensityProfile
};
