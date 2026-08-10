const OpenAI = require('openai');
const config = require('../config');
const sourceFilter = require('./sourceFilter');
const manualSourceDedupe = require('./manualSourceDedupe');
const { sourceFacts, validateSourceContent, requestedListicleCount, sourceRichness } = require('./manualSourceFallback');

const MAX_FINALIZE_ATTEMPTS = 3;
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean);
const normalize = value => String(value || '').trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
const visibleCount = slide => [slide?.title, slide?.body, ...(Array.isArray(slide?.points) ? slide.points : [])]
  .reduce((sum, value) => sum + words(value).length, 0);

function defaultSections(format, count) {
  const normalized = String(format || '').trim().toLocaleLowerCase('id-ID');
  if (normalized === 'listicle') return Array.from({ length: count }, (_, index) => `ITEM ${index + 1}`);
  if (normalized === 'tutorial langkah') {
    const middle = Array.from({ length: Math.max(2, count - 2) }, (_, index) => `LANGKAH ${index + 1}`);
    return ['PEMBUKA', ...middle, 'HASIL/PENUTUP'].slice(0, count);
  }
  if (normalized === 'masalah dan solusi') {
    return ['MASALAH', ...Array.from({ length: Math.max(2, count - 2) }, () => 'SOLUSI'), 'PENUTUP'].slice(0, count);
  }
  if (normalized === 'tips cepat') {
    const middle = Array.from({ length: Math.max(2, count - 2) }, (_, index) => `TIPS ${index + 1}`);
    return ['PEMBUKA', ...middle, 'PENUTUP'].slice(0, count);
  }
  if (normalized === 'before-after') {
    const base = ['BEFORE', 'PERUBAHAN', 'AFTER', 'PENUTUP'];
    if (count === 5) base.splice(2, 0, 'KONTEKS');
    return base.slice(0, count);
  }
  const middle = ['FAKTA UTAMA', 'PENJELASAN', 'KONTEKS'];
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return 'PEMBUKA';
    if (index === count - 1) return 'KESIMPULAN';
    return middle[Math.min(index - 1, middle.length - 1)];
  });
}

function targetSections(generated, format, facts, sources = [], topic = '') {
  const normalizedFormat = String(format || '').trim().toLocaleLowerCase('id-ID');
  if (normalizedFormat === 'listicle') {
    const explicitCount = requestedListicleCount(sources, topic);
    if (explicitCount) return defaultSections(format, explicitCount);
  }
  const current = Array.isArray(generated?.slides) ? generated.slides : [];
  if (current.length >= 4 && current.length <= 5 && current.every(slide => String(slide?.section || '').trim())) {
    return current.map(slide => String(slide.section).trim());
  }
  const count = facts.length >= 9 ? 5 : 4;
  return defaultSections(format, count);
}

function groupedFacts(sources, facts) {
  return (sources || []).map((source, index) => {
    const sourceId = `source-${index + 1}`;
    return {
      sourceId,
      title: String(source?.title || '').trim(),
      url: String(source?.finalUrl || source?.url || '').trim(),
      facts: facts.filter(fact => fact.sourceId === sourceId).slice(0, 24).map(fact => fact.evidence)
    };
  });
}

function contentShapeGoalErrors(content, facts) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const profile = sourceRichness(facts, slides.length || 4);
  return slides.flatMap((slide, index) => {
    const errors = [];
    const bodyCount = words(slide?.body).length;
    const points = Array.isArray(slide?.points) ? slide.points : [];
    const count = visibleCount(slide);
    if (bodyCount < 10) errors.push(`slide:${index}:shape-goal: body baru ${bodyCount} kata; perkaya menjadi sekitar 10–18 kata dari evidence yang sama.`);
    if (points.length < profile.targetPoints) errors.push(`slide:${index}:shape-goal: baru ${points.length} bullet; target ${profile.targetPoints} bullet fakta berbeda jika fact bank mendukung.`);
    if (count < profile.visibleGoal) errors.push(`slide:${index}:shape-goal: baru ${count} kata visible; perkaya menuju sekitar ${profile.visibleGoal} tanpa filler.`);
    return errors;
  });
}

const densityGoalErrors = contentShapeGoalErrors;

function qualityScore(content) {
  return (content?.slides || []).reduce((sum, slide) => {
    const points = Array.isArray(slide?.points) ? slide.points.length : 0;
    return sum + visibleCount(slide) + (points * 8);
  }, 0);
}

const densityScore = qualityScore;

function finalizerPrompt({ generated, sources, facts, format, topic, errors }) {
  const sections = targetSections(generated, format, facts, sources, topic);
  const sourceGroups = groupedFacts(sources, facts);
  const profile = sourceRichness(facts, sections.length);
  return `FINAL AI REWRITE — SEMUA URL WAJIB DIPAKAI.\n\nTOPIK: ${JSON.stringify(topic)}\nFORMAT EFEKTIF: ${JSON.stringify(format)}\nSECTION WAJIB: ${JSON.stringify(sections)}\nTARGET BENTUK SLIDE: title ringkas + body 10–18 kata + target ${profile.targetPoints} bullet fakta (hard minimum ${profile.minPoints} bila fact bank cukup)\nTARGET KEPADATAN NATURAL: sekitar ${profile.visibleGoal} kata visible; hard floor ${profile.hardFloor}\nERROR SEBELUMNYA: ${JSON.stringify(errors || [])}\n\nSUMBER DAN FACT BANK PER URL:\n${JSON.stringify(sourceGroups)}\n\nDRAF SAAT INI:\n${JSON.stringify(generated?.slides || [])}\n\nATURAN KERAS:\n- Tulis ulang seluruh carousel dalam Bahasa Indonesia yang natural, enak dibaca, informatif, dan tetap sesuai konteks sumber.\n- SETIAP sourceId yang tercantum WAJIB menyumbang minimal satu fakta yang terlihat pada body atau bullet. Jangan ada URL yang diabaikan.\n- HANYA gunakan fakta dari FACT BANK. Jangan memakai pengetahuan luar, asumsi, filler, atau klaim yang tidak dinyatakan sumber.\n- Setiap body dan setiap bullet WAJIB mempunyai claim dengan field yang tepat, text PERSIS sama dengan copy yang terlihat, sourceId yang benar, dan evidence PERSIS salah satu fakta pada sourceId tersebut.\n- Jika title membuat klaim faktual spesifik, beri claim title juga. Jika tidak perlu, gunakan title natural yang merangkum ide slide tanpa menambah fakta baru.\n- Evidence boleh berbahasa Inggris, tetapi copy terlihat harus diparafrase/diterjemahkan natural ke Bahasa Indonesia tanpa mengubah makna, angka, modalitas, subjek, sebab-akibat, atau tingkat kepastian.\n- JANGAN memakai evidence canonical yang sama dua kali, baik dalam satu slide maupun lintas slide. Jangan mengulang ide dengan wording berbeda.\n- POLA ISI yang dituju untuk setiap slide: title singkat; satu kalimat body yang menjelaskan konteks utama; lalu 2–3 bullet fakta pendek. Untuk source kaya, PAKSA 3 bullet jika tersedia tiga evidence berbeda dan relevan.\n- Body ideal 10–18 kata, boleh sampai 24 hanya jika perlu menjaga fakta. Bullet masing-masing 3–7 kata. Maksimal 3 bullet.\n- Bullet harus menambah informasi baru terhadap body dan bullet lain, bukan mengulang kalimat body.\n- Jika ERROR SEBELUMNYA berisi shape-goal/richness, prioritaskan menambah fakta BERBEDA dari FACT BANK pada slide itu. Jangan menambah kata kosong hanya untuk mengejar jumlah kata.\n- Satu slide = satu ide utama yang koheren. Jangan mencampur fakta dari item/topik berbeda hanya demi memenuhi bullet.\n- Pertahankan section PERSIS sesuai SECTION WAJIB. Jika Listicle sumber secara eksplisit menyebut 4 atau 5 item, jumlah slide harus mengikuti jumlah itu.\n- Untuk LANGKAH/SOLUSI/TIPS, hanya tulis tindakan pengguna bila evidence memang mendukung tindakan itu. Jangan mengubah fitur, risiko, atau tindakan pihak lain menjadi instruksi palsu.\n- Untuk BEFORE/AFTER/HASIL, hubungan perubahan atau outcome hanya boleh ditulis jika evidence mendukung hubungan tersebut.\n- Jangan masukkan Baca Juga, rekomendasi artikel, cookie/privacy policy, newsletter, copyright, sidebar, teaser, atau metadata situs.\n\nKembalikan HANYA JSON:\n{"slides":[{"section":"...","title":"...","body":"...","points":["...","...","..."],"claims":[{"field":"slide:0:body","text":"...","sourceId":"source-1","evidence":"..."},{"field":"slide:0:point:0","text":"...","sourceId":"source-1","evidence":"..."}]}]}`;
}

function parseSlides(response, sections) {
  const raw = response?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Final AI rewrite tidak mengembalikan konten.');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed?.slides) || parsed.slides.length !== sections.length) throw new Error('Final AI rewrite mengubah jumlah slide.');
  return parsed.slides.map((slide, index) => {
    const section = String(slide?.section || '').trim();
    if (normalize(section) !== normalize(sections[index])) throw new Error(`Final AI rewrite mengubah section slide ${index + 1}.`);
    return {
      section: sections[index],
      title: String(slide?.title || '').trim(),
      body: String(slide?.body || '').trim(),
      points: Array.isArray(slide?.points) ? slide.points.map(value => String(value || '').trim()).filter(Boolean) : [],
      claims: Array.isArray(slide?.claims) ? slide.claims.map(claim => ({
        field: String(claim?.field || '').trim(),
        text: String(claim?.text || '').trim(),
        sourceId: String(claim?.sourceId || '').trim(),
        evidence: String(claim?.evidence || '').trim()
      })).filter(claim => claim.field || claim.text || claim.sourceId || claim.evidence) : []
    };
  });
}

function syncTop(content) {
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  if (!slides.length) return content;
  const first = slides[0];
  const middle = slides.find((slide, index) => index > 0 && (slide.body || slide.points?.length)) || first;
  const last = slides.at(-1);
  const main = slide => String(slide?.body || '').trim() || (slide?.points || []).join(' ').trim() || String(slide?.title || '').trim();
  return {
    ...content,
    hook: String(first?.title || content?.hook || '').trim(),
    body: main(middle),
    caption: main(middle),
    cta: String(last?.title || content?.cta || '').trim()
  };
}

function localLayoutErrors(content) {
  const errors = [];
  (content?.slides || []).forEach((slide, slideIndex) => {
    if (words(slide?.title).length > 12) errors.push(`slide:${slideIndex}: title lebih dari 12 kata.`);
    if (!words(slide?.body).length || words(slide?.body).length > 24) errors.push(`slide:${slideIndex}: body harus 1–24 kata.`);
    if ((slide?.points || []).length > 3) errors.push(`slide:${slideIndex}: maksimal 3 point.`);
    (slide?.points || []).forEach((point, pointIndex) => {
      const count = words(point).length;
      if (count < 3 || count > 7) errors.push(`slide:${slideIndex}:point:${pointIndex}: harus 3–7 kata.`);
    });
  });
  return errors;
}

async function rewriteAllSourcesWithAi({ generated, sources = [], topic = '', format = 'Fakta singkat', mode = 'manual', contentService, client } = {}) {
  const facts = sourceFacts(sources);
  if (!sources.length || !facts.length) throw Object.assign(new Error('Tidak ada fakta sumber yang dapat dipakai final AI rewrite.'), { status: 422 });
  const missingSources = sources.map((_, index) => `source-${index + 1}`).filter(sourceId => !facts.some(fact => fact.sourceId === sourceId));
  if (missingSources.length) throw Object.assign(new Error(`URL berikut tidak memiliki fakta yang dapat dipakai: ${missingSources.join(', ')}`), { status: 422 });

  const effectiveFormat = generated?.effectiveContentFormat || format || 'Fakta singkat';
  const resolvedTopic = String(topic || generated?.topic || sources?.[0]?.title || 'Ringkasan sumber').trim();
  const sections = targetSections(generated, effectiveFormat, facts, sources, resolvedTopic);
  const openai = client || new OpenAI({ apiKey: config.aiApiKey, baseURL: config.aiBaseUrl });
  let draft = { ...generated, topic: resolvedTopic };
  let lastErrors = [];
  let bestValid = null;
  let bestValidScore = -1;

  for (let attempt = 0; attempt < MAX_FINALIZE_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await openai.chat.completions.create({
        model: config.aiModel,
        messages: [
          { role: 'system', content: 'Anda finalizer carousel source-grounded. Semua URL wajib dipakai. Setiap slide harus berupa title + penjelasan padat + bullet fakta, tanpa fakta di luar evidence.' },
          { role: 'user', content: finalizerPrompt({ generated: draft, sources, facts, format: effectiveFormat, topic: resolvedTopic, errors: lastErrors }) }
        ],
        response_format: { type: 'json_object' }
      });
      draft = syncTop({ ...draft, slides: parseSlides(response, sections), verificationStatus: 'source_based' });
    } catch (error) {
      lastErrors = [`Final AI rewrite gagal diproses: ${error.message}`];
      continue;
    }

    const checked = sourceFilter.validateVerifiedContent(draft, { slides: draft.slides }, {
      contentService,
      format: effectiveFormat,
      manualTopic: mode === 'manual' ? resolvedTopic : '',
      sources,
      autoSourceTopic: mode === 'ai'
    });
    const deterministicErrors = [
      ...checked.errors,
      ...validateSourceContent(checked.content || draft, sources),
      ...manualSourceDedupe.manualCrossSlideDuplicateErrors(checked.content || draft),
      ...localLayoutErrors(checked.content || draft)
    ];
    if (deterministicErrors.length) {
      lastErrors = [...new Set(deterministicErrors)];
      draft = checked.content || draft;
      continue;
    }

    const semanticErrors = await sourceFilter.auditClaimSemantics(openai, checked.content, resolvedTopic, effectiveFormat);
    if (semanticErrors.length) {
      lastErrors = semanticErrors;
      draft = checked.content;
      continue;
    }

    const candidate = syncTop(checked.content);
    const score = qualityScore(candidate);
    if (score > bestValidScore) {
      bestValid = candidate;
      bestValidScore = score;
    }

    const goalErrors = contentShapeGoalErrors(candidate, facts);
    if (!goalErrors.length) return candidate;
    if (attempt < MAX_FINALIZE_ATTEMPTS - 1) {
      lastErrors = goalErrors;
      draft = candidate;
      continue;
    }
  }

  if (bestValid) return syncTop(bestValid);

  throw Object.assign(new Error(`Final AI rewrite semua URL belum lolos: ${lastErrors[0] || 'validasi sumber gagal'}`), {
    status: 422,
    validationErrors: lastErrors
  });
}

module.exports = {
  rewriteAllSourcesWithAi,
  finalizerPrompt,
  parseSlides,
  targetSections,
  contentShapeGoalErrors,
  densityGoalErrors,
  qualityScore,
  densityScore,
  MAX_FINALIZE_ATTEMPTS
};
