const ENGLISH_MARKERS = new Set([
  'a','an','the','and','or','but','is','are','was','were','be','been','being','of','to','in','on','for','with','from','as','by','that','this','these','those','its','their','his','her','has','have','had','will','would','can','could','should','may','might','during','about','over','amid','how','which','whether','than'
]);
const ENGLISH_CONTENT_MARKERS = new Set([
  'launches','launched','launching','published','publishes','presented','presents','speaks','spoke','announced','announces','released','releases','seeks','rival','powerful','developers','developer','essay','lengthy','utopian','vision','course','topics','related','included','datacenters','government','regulation','stance','sets','apart','frontier','labs','proprietary','several','plans','involved','creation','ongoing','debate','competitors','grown','wary','dominance','went','online','same','day','argue','itself'
]);
const INDONESIAN_MARKERS = new Set([
  'yang','dan','atau','adalah','merupakan','dari','untuk','dengan','pada','di','ke','ini','itu','sebagai','oleh','akan','bisa','dapat','telah','sudah','belum','lebih','juga','karena','agar','saat','ketika','dalam','menjadi','memiliki','menggunakan','dirilis','diluncurkan','tentang','baru','terbaru','pengguna'
]);
const TOPIC_ANCHOR_IGNORE = new Set([
  'ai','api','cara','tips','fakta','tentang','terbaru','baru','update','2025','2026','model','fitur','teknologi','edukasi','tutorial','langkah','mengamankan','keamanan'
]);
const REFERENTIAL_CONTINUATION = /^(?:it|its|this|these|those|the\s+(?:model|release|system|technology|product|service|tool|app|application|browser|platform|feature)|model\s+ini|rilis\s+ini|sistem\s+ini|teknologi\s+ini|produk\s+ini|fitur\s+ini)\b/i;
const HARD_SOURCE_BOILERPLATE = /(?:our\s+editorial\s+(?:standards|policy)|read\s+(?:more\s+about\s+)?our\s+editorial\s+(?:standards|policy)|maintains?\s+(?:its\s+)?editorial\s+independence|editorially\s+independent\s+from|work\s+has\s+appeared\s+in|works?\s+has\s+appeared\s+in|has\s+(?:also\s+)?written\s+for|previously\s+(?:worked|wrote|reported)\s+(?:at|for)|before\s+joining|more\s+by\s+[A-Z]|follow\s+(?:the\s+)?(?:author|reporter|writer)|contact\s+(?:the\s+)?(?:author|reporter|writer)|author\s+(?:bio|profile)|writer\s+(?:bio|profile)|contributor\s+(?:bio|profile)|about\s+the\s+author|tentang\s+penulis|menjaga\s+independensi\s+editorial|baca\s+(?:lebih\s+lanjut\s+)?(?:tentang\s+)?kebijakan\s+editorial|karya(?:nya)?\s+(?:pernah\s+)?(?:muncul|dimuat)\s+di|pernah\s+menulis\s+untuk)/iu;
const BAD_VISIBLE_TRANSLATION = /(?:\bberat\s+model\s+(?:di|dengan)\s+lisensi\b|\bdi\s+lisensi\s+(?:apache|mit|bsd|gpl)\b|\bindependen\s+editorial\s+terjaga\b|\bkarya(?:nya)?\s+(?:muncul|dimuat)\s+di\s+(?:forbes|bloomberg|reuters|techcrunch)\b)/iu;
const TERMINAL_DEMONSTRATIVES = new Set(['ini', 'itu']);

let installed = false;

function tokens(value) {
  return String(value || '').toLocaleLowerCase('id-ID').match(/[a-z0-9]+/g) || [];
}

function normalizedDisplay(value) {
  return tokens(value).join(' ');
}

function namedTopicAnchors(topic) {
  const raw = String(topic || '').match(/[A-Za-z][A-Za-z0-9.-]*/g) || [];
  const anchors = raw
    .filter(token => /^[A-Z]/.test(token))
    .map(token => token.toLocaleLowerCase('id-ID').replace(/[^a-z0-9]/g, ''))
    .filter(token => token.length > 2 && !TOPIC_ANCHOR_IGNORE.has(token));
  return [...new Set(anchors)];
}

function likelyEnglishDisplay(value) {
  const list = tokens(value);
  if (list.length < 3) return false;
  const english = list.filter(token => ENGLISH_MARKERS.has(token)).length;
  const englishContent = list.filter(token => ENGLISH_CONTENT_MARKERS.has(token)).length;
  const indonesian = list.filter(token => INDONESIAN_MARKERS.has(token)).length;
  if (indonesian > 0) return english >= 3 && english > indonesian * 2;
  if (english >= 2 && english / list.length >= 0.2) return true;
  return list.length >= 4 && englishContent >= 2 && (english + englishContent) / list.length >= 0.35;
}

function visibleFields(content) {
  const fields = [];
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  slides.forEach((slide, slideIndex) => {
    fields.push([`slide:${slideIndex}:title`, slide?.title], [`slide:${slideIndex}:body`, slide?.body]);
    if (Array.isArray(slide?.points)) slide.points.forEach((point, pointIndex) => fields.push([`slide:${slideIndex}:point:${pointIndex}`, point]));
  });
  fields.push(['hook', content?.hook], ['caption', content?.caption], ['cta', content?.cta]);
  return fields;
}

function visibleLanguageErrors(content) {
  return [...new Set(visibleFields(content).flatMap(([field, value]) =>
    likelyEnglishDisplay(value) ? [`${field}: copy tampil masih berupa kalimat bahasa Inggris; wajib dilokalkan ke bahasa Indonesia.`] : []
  ))];
}

function visibleSourceEchoErrors(content, sources = []) {
  const sourceText = (sources || []).map(source => normalizedDisplay(source?.text)).filter(Boolean).join(' ');
  if (!sourceText) return [];
  return [...new Set(visibleFields(content).flatMap(([field, value]) => {
    const list = tokens(value);
    const normalized = list.join(' ');
    const indonesian = list.filter(token => INDONESIAN_MARKERS.has(token)).length;
    if (list.length < 5 || indonesian > 0 || normalized.length < 20 || !sourceText.includes(normalized)) return [];
    return [`${field}: copy tampil menyalin frasa sumber non-Indonesia; wajib dilokalkan ke bahasa Indonesia.`];
  }))];
}

function visibleNaturalErrors(content) {
  return [...new Set(visibleFields(content).flatMap(([field, value]) =>
    BAD_VISIBLE_TRANSLATION.test(String(value || ''))
      ? [`${field}: copy tampil masih berupa terjemahan rusak atau metadata situs; tulis ulang secara natural dari evidence.`]
      : []
  ))];
}

function sentenceAnchorCount(sentence, anchors) {
  const set = new Set(tokens(sentence));
  return anchors.filter(anchor => set.has(anchor)).length;
}

function likelyPhotoCaption(sentence) {
  const text = String(sentence || '').trim();
  return /\b(?:speaks|speaking|appears|pictured|poses|stands|walks|arrives)\s+(?:during|at|on)\b/i.test(text)
    && /\b(?:conference|event|meeting|summit|headquarters|developer|california|new york|london)\b/i.test(text);
}

function isSourceBoilerplate(value) {
  return HARD_SOURCE_BOILERPLATE.test(String(value || '').trim());
}

function sanitizeBoilerplateText(text) {
  const segments = String(text || '').replace(/\r/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!segments.length) return String(text || '');
  return segments.filter(segment => !isSourceBoilerplate(segment)).join('\n').trim();
}

function sanitizeSourceTextForManualTopic(text, topic) {
  const base = sanitizeBoilerplateText(text);
  const anchors = namedTopicAnchors(topic);
  if (anchors.length < 2) return base;
  const segments = String(base || '').replace(/\r/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map(value => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (segments.length < 3) return base;

  const requiredMatches = Math.min(2, anchors.length);
  const firstStrong = segments.findIndex(segment => sentenceAnchorCount(segment, anchors) >= requiredMatches);
  if (firstStrong < 0) return base;

  const selected = [];
  for (const segment of segments.slice(firstStrong)) {
    const matches = sentenceAnchorCount(segment, anchors);
    const referential = REFERENTIAL_CONTINUATION.test(segment);
    if (likelyPhotoCaption(segment) || isSourceBoilerplate(segment)) continue;
    if (matches > 0 || referential) selected.push(segment);
  }

  const cleaned = selected.join('\n').trim();
  return selected.length >= 2 && cleaned.length >= 80 ? cleaned : base;
}

function sanitizeSourcesForManualTopic(sources, topic) {
  if (!Array.isArray(sources)) return sources;
  sources.forEach(source => {
    const cleaned = sanitizeSourceTextForManualTopic(source?.text, topic);
    if (source && cleaned && cleaned !== source.text) source.text = cleaned;
  });
  return sources;
}

function sanitizeFetchedSources(sources) {
  if (!Array.isArray(sources)) return sources;
  sources.forEach(source => {
    if (!source) return;
    const cleaned = sanitizeBoilerplateText(source.text);
    if (cleaned && cleaned !== source.text) source.text = cleaned;
  });
  return sources;
}

function terminalDemonstrative(value) {
  const list = tokens(value);
  return TERMINAL_DEMONSTRATIVES.has(list.at(-1));
}

function errorFieldValue(content, error) {
  const body = String(error || '').match(/^slide:(\d+):natural: body berakhir sebagai fragmen kalimat\.$/i);
  if (body) return String(content?.slides?.[Number(body[1])]?.body || '');
  const point = String(error || '').match(/^slide:(\d+):point:(\d+): bullet terpotong atau berakhir pada kata gantung\.$/i);
  if (point) return String(content?.slides?.[Number(point[1])]?.points?.[Number(point[2])] || '');
  return '';
}

function filterFalseFragmentErrors(errors, content) {
  return (errors || []).filter(error => {
    const value = errorFieldValue(content, error);
    return !value || !terminalDemonstrative(value);
  });
}

function semanticRelationErrors(content) {
  const errors = [];
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  slides.forEach((slide, slideIndex) => {
    (Array.isArray(slide?.claims) ? slide.claims : []).forEach(claim => {
      const field = String(claim?.field || `slide:${slideIndex}:unknown`).trim();
      const text = String(claim?.text || '').toLocaleLowerCase('id-ID');
      const evidence = String(claim?.evidence || '').toLocaleLowerCase('en-US');

      const lineageEvidence = /\b(?:distilled?\s+from|distillation\s+from|derived\s+from|trained\s+from|trained\s+using|didistilasi\s+dari|diturunkan\s+dari|dilatih\s+dari|dilatih\s+menggunakan)\b/.test(evidence);
      const lineageDrift = /\b(?:versi\s+(?:terbuka|open(?:-weight|-source)?)\s+dari|versi\s+open\s+dari|open\s+version\s+of|pengganti|successor)\b/.test(text);
      if (lineageEvidence && lineageDrift) {
        errors.push(`${field}: hubungan lineage berubah; evidence menyatakan distillation/derivation, bukan versi terbuka atau pengganti.`);
      }

      const evidenceOpenWeight = /\bopen[-\s]?weight\b/.test(evidence);
      const evidenceOpenSource = /\bopen[-\s]?source\b/.test(evidence);
      const claimOpenSource = /\b(?:open[-\s]?source|sumber\s+terbuka)\b/.test(text);
      const claimOpenWeight = /\bopen[-\s]?weight\b/.test(text);
      if (evidenceOpenWeight && claimOpenSource && !evidenceOpenSource) {
        errors.push(`${field}: open-weight tidak boleh diubah menjadi open-source/sumber terbuka.`);
      }
      if (evidenceOpenSource && claimOpenWeight && !evidenceOpenWeight) {
        errors.push(`${field}: open-source tidak boleh diubah menjadi open-weight.`);
      }

      const futureEvidence = /\b(?:plans?\s+to|intends?\s+to|expected\s+to|will\s+(?:release|launch|make|open)|set\s+to|berencana\s+untuk|akan\s+(?:merilis|meluncurkan|membuka)|diperkirakan\s+akan)\b/.test(evidence);
      const releasedClaim = /\b(?:sudah|telah)\s+(?:dirilis|diluncurkan|tersedia)|\b(?:dirilis|diluncurkan|tersedia)\s+(?:sekarang|resmi)\b/.test(text);
      if (futureEvidence && releasedClaim) {
        errors.push(`${field}: rencana/proyeksi pada evidence tidak boleh diubah menjadi sudah dirilis atau sudah tersedia.`);
      }

      const modalEvidence = /\b(?:can|could|may|might|designed\s+to|intended\s+to|helps?\s+to|potential(?:ly)?|dapat|bisa|mungkin|dirancang\s+untuk|berpotensi|membantu)\b/.test(evidence);
      const certaintyClaim = /\b(?:pasti|selalu|menjamin|dipastikan|tanpa\s+gagal)\b/.test(text);
      if (modalEvidence && certaintyClaim) {
        errors.push(`${field}: modalitas evidence lebih lemah daripada klaim final; jangan mengubah kemungkinan/kemampuan menjadi kepastian.`);
      }
    });
  });
  return [...new Set(errors)];
}

function shouldUseFactFinalizer(format) {
  return String(format || '').trim().toLocaleLowerCase('id-ID') === 'fakta singkat';
}

function install() {
  if (installed) return;
  const fallback = require('./manualSourceFallback');
  const roleGuard = require('./manualSourceRoleGuard');
  const sourceFetcher = require('./sourceFetcher');

  const originalValidateSourceContent = fallback.validateSourceContent;
  const originalNaturalCopyErrors = fallback.naturalCopyErrors;
  const originalRepairManualSourceRoles = roleGuard.repairManualSourceRoles;
  const originalFetchSources = sourceFetcher.fetchSources;

  sourceFetcher.fetchSources = async (...args) => sanitizeFetchedSources(await originalFetchSources.apply(sourceFetcher, args));

  fallback.validateSourceContent = (content, sources = []) => [
    ...new Set([
      ...filterFalseFragmentErrors(originalValidateSourceContent(content, sources), content),
      ...visibleLanguageErrors(content),
      ...visibleSourceEchoErrors(content, sources),
      ...visibleNaturalErrors(content),
      ...semanticRelationErrors(content)
    ])
  ];
  fallback.naturalCopyErrors = content => [
    ...new Set([
      ...filterFalseFragmentErrors(originalNaturalCopyErrors(content), content),
      ...visibleLanguageErrors(content),
      ...visibleNaturalErrors(content)
    ])
  ];
  roleGuard.repairManualSourceRoles = async args => {
    const topic = args?.options?.requestedTopic || args?.generated?.topic || '';
    sanitizeSourcesForManualTopic(args?.sources, topic);

    if (shouldUseFactFinalizer(args?.options?.contentFormat)) {
      const finalizer = require('./sourceUrlFinalizer');
      return finalizer.rewriteAllSourcesWithAi({
        generated: args?.generated,
        sources: args?.sources || [],
        topic,
        format: 'Fakta singkat',
        mode: 'manual',
        contentService: args?.contentService,
        client: args?.client
      });
    }
    return originalRepairManualSourceRoles(args);
  };

  installed = true;
}

module.exports = {
  install,
  likelyEnglishDisplay,
  visibleLanguageErrors,
  visibleSourceEchoErrors,
  visibleNaturalErrors,
  semanticRelationErrors,
  namedTopicAnchors,
  sanitizeBoilerplateText,
  sanitizeSourceTextForManualTopic,
  sanitizeSourcesForManualTopic,
  sanitizeFetchedSources,
  filterFalseFragmentErrors,
  terminalDemonstrative,
  shouldUseFactFinalizer
};
