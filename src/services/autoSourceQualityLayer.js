const strict = require('./autoSourceStrictFinalizer');
const sourceUrlFinalizer = require('./sourceUrlFinalizer');

// TANPA URL / AUTO SOURCE ONLY.
// autoSourcePatch installs this layer only after Pakai URL has been excluded.
let installed = false;
let originalStrictPrompt = null;
let originalValidateStrictCandidate = null;

function normalize(value) {
  return String(value || '').toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9%\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
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

function buildCoherentPlan(sources = [], facts = [], slideCount = 4) {
  const groups = groupedBySource(facts);
  const sourceIds = sources.map((_, index) => `source-${index + 1}`).filter(id => groups.get(id)?.length);
  if (!sourceIds.length || !slideCount) return [];

  const queues = new Map(sourceIds.map(id => [id, [...groups.get(id)]]));
  const assignedCount = new Map(sourceIds.map(id => [id, 0]));
  const owners = [];

  // First guarantee that every selected source owns at least one slide when the
  // slide count allows it. Remaining slides go to the source with the largest
  // unused topic-scoped fact queue.
  for (const id of sourceIds) {
    if (owners.length >= slideCount) break;
    owners.push(id);
    assignedCount.set(id, (assignedCount.get(id) || 0) + 1);
  }
  while (owners.length < slideCount) {
    const ranked = [...sourceIds].sort((a, b) => {
      const aRemaining = (queues.get(a)?.length || 0) - (assignedCount.get(a) || 0) * 4;
      const bRemaining = (queues.get(b)?.length || 0) - (assignedCount.get(b) || 0) * 4;
      return bRemaining - aRemaining;
    });
    const id = ranked[0] || sourceIds[owners.length % sourceIds.length];
    owners.push(id);
    assignedCount.set(id, (assignedCount.get(id) || 0) + 1);
  }

  const plan = [];
  for (let slideIndex = 0; slideIndex < owners.length; slideIndex += 1) {
    const sourceId = owners[slideIndex];
    const queue = queues.get(sourceId) || [];
    const evidence = queue.splice(0, 4);
    plan.push({ slide: slideIndex + 1, primarySourceId: sourceId, evidence });
  }
  return plan;
}

function substantiveClaims(slide) {
  return (Array.isArray(slide?.claims) ? slide.claims : []).filter(claim =>
    /^slide:\d+:(?:body|point:\d+)$/.test(String(claim?.field || '').trim())
  );
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
    for (const claim of claims) {
      const sourceId = String(claim?.sourceId || '').trim();
      if (!sourceId || sourceId === primary) continue;
      errors.push(`${claim.field}: AUTO_SOURCE_COHERENCE: slide ${slideIndex + 1} mencampur ${primary} dengan ${sourceId}; satu slide harus satu sumber utama dan satu subtopik.`);
    }
  }
  return errors;
}

function topicEvidenceErrors(content = {}, facts = []) {
  const allowed = groupedBySource(facts);
  const errors = [];
  for (const slide of content?.slides || []) {
    for (const claim of substantiveClaims(slide)) {
      const sourceId = String(claim?.sourceId || '').trim();
      const evidence = normalize(claim?.evidence);
      const bank = allowed.get(sourceId) || [];
      if (!sourceId || !evidence || !bank.length) continue;
      const supported = bank.some(item => {
        const candidate = normalize(item.evidence);
        return candidate && (candidate === evidence || evidence.includes(candidate) || candidate.includes(evidence));
      });
      if (!supported) {
        errors.push(`${claim.field}: AUTO_SOURCE_CONTEXT: evidence tidak termasuk fact bank yang relevan dengan topik untuk ${sourceId}.`);
      }
    }
  }
  return errors;
}

function forcedDensityErrors(content = {}, facts = []) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  if (!slides.length || facts.length < slides.length * 4) return [];
  return slides.flatMap((slide, slideIndex) => {
    const points = Array.isArray(slide?.points) ? slide.points : [];
    return points.length === 3
      ? []
      : [`slide:${slideIndex}:body: AUTO_SOURCE_DENSITY: fact bank cukup kaya; slide ${slideIndex + 1} wajib body + tepat 3 bullet fakta berbeda.`];
  });
}

function coherentPrompt(args = {}) {
  const scopedFacts = topicScopedFacts(args.sources, args.facts, args.topic);
  const sections = sourceUrlFinalizer.targetSections(
    args.generated,
    args.format,
    scopedFacts,
    args.sources,
    args.topic
  );
  const plan = buildCoherentPlan(args.sources, scopedFacts, sections.length);
  const base = originalStrictPrompt({ ...args, facts: scopedFacts });
  return `${base}\n\nAUTO SOURCE COHERENCE CONTRACT — MENGALAHKAN FACT PLAN ROUND-ROBIN DI ATAS:\nCOHERENT SOURCE PLAN PER SLIDE:\n${JSON.stringify(plan)}\n\nATURAN TAMBAHAN WAJIB:\n- SATU SLIDE = SATU SUBTOPIK = SATU primarySourceId dari COHERENT SOURCE PLAN.\n- Body dan semua bullet pada slide yang sama WAJIB memakai primarySourceId yang sama. DILARANG mencampur artikel/sumber berbeda dalam satu slide.\n- Gunakan evidence yang dialokasikan pada slide itu sebagai prioritas. Jika perlu mengganti, pilih evidence LAIN dari primarySourceId yang sama, masih relevan dengan TOPIK USER, dan belum dipakai slide lain.\n- Jangan memasukkan fakta sampingan dari artikel yang hanya kebetulan mengandung kata AI/Indonesia/perusahaan tetapi tidak menjelaskan topik user.\n- Setiap slide harus koheren seperti contoh editorial: judul menjawab satu pertanyaan/subtopik, body menjelaskan inti, lalu 3 bullet menambah detail tentang inti yang sama.\n- Bila fact bank relevan memiliki sedikitnya 4 fakta unik per slide, hasil minimal WAJIB body 10-20 kata + tepat 3 bullet 3-7 kata.\n- Semua sumber terpilih tetap WAJIB terwakili, tetapi penyebarannya dilakukan antar-slide, BUKAN dicampur dalam satu slide.\n- Jangan gunakan fakta dari sourceId lain hanya untuk mengejar kepadatan. Akurasi konteks lebih penting daripada filler.`;
}

function coherentValidate(args = {}) {
  const scopedFacts = topicScopedFacts(args.sources, args.facts, args.topic);
  const result = originalValidateStrictCandidate({ ...args, facts: scopedFacts });
  const errors = [
    ...(result.errors || []),
    ...slideSourceCoherenceErrors(result.candidate),
    ...topicEvidenceErrors(result.candidate, scopedFacts),
    ...forcedDensityErrors(result.candidate, scopedFacts)
  ];
  return { candidate: result.candidate, errors: [...new Set(errors)] };
}

function install() {
  if (installed) return false;
  originalStrictPrompt = strict.strictPrompt;
  originalValidateStrictCandidate = strict.validateStrictCandidate;
  strict.strictPrompt = coherentPrompt;
  strict.validateStrictCandidate = coherentValidate;
  installed = true;
  return true;
}

module.exports = {
  install,
  topicScopedFacts,
  buildCoherentPlan,
  slideSourceCoherenceErrors,
  topicEvidenceErrors,
  forcedDensityErrors,
  isInstalled: () => installed
};