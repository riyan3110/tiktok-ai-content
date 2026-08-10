const defaultContent = require('./content');
const defaultImages = require('./images');
const defaultTrending = require('./trendingTopics');
const { resolveCategory, resolveFormat } = require('./contentOptions');
const trendReferences = require('./trendReferences');
const defaultSourceFetcher = require('./sourceFetcher');
const defaultSourceFilter = require('./sourceFilter');
const defaultManualSourceRoleGuard = require('./manualSourceRoleGuard');
const { buildDeterministicSourceFallback, validateSourceContent } = require('./manualSourceFallback');

const MODES = new Set(['manual', 'ai', 'trending']);
const MAX_GENERATION_ATTEMPTS = 3;
const normalizeTopic = (topic) => String(topic || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');

function duplicateTopicError() {
  return Object.assign(new Error(`Topik duplikat setelah ${MAX_GENERATION_ATTEMPTS} percobaan`), { status: 409 });
}

function previousTopics(db) {
  return db.prepare('SELECT topic FROM contents ORDER BY id DESC LIMIT 50').all().map(({ topic }) => topic);
}

function recentContents(db, limit = 15) {
  return db.prepare('SELECT topic,content_angle,primary_tool,hook_pattern,hook,body,cta FROM contents ORDER BY id DESC LIMIT ?').all(limit);
}

function tokens(value) { return new Set(String(value || '').toLocaleLowerCase('id-ID').match(/[a-z0-9]+/g) || []); }
function textSimilarity(left, right) {
  const a = tokens(left); const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter(value => b.has(value)).length;
  return shared / (a.size + b.size - shared);
}
function similarityToHistory(generated, history) {
  const fields = [['content_angle'], ['hook_pattern'], ['body'], ['cta'], ['primary_tool']];
  return history.reduce((highest, old) => {
    const scores = fields.map(keys => textSimilarity(keys.map(key => generated[key]).join(' '), keys.map(key => old[key]).join(' ')));
    return Math.max(highest, scores.reduce((sum, value) => sum + value, 0) / scores.length);
  }, 0);
}

function isDuplicate(db, topic) {
  const normalized = normalizeTopic(topic);
  return db.prepare('SELECT topic FROM contents').all().some((row) => normalizeTopic(row.topic) === normalized);
}

function resolveManualSourceRoleGuard(override, content = defaultContent) {
  if (override) return override;
  return content === defaultContent ? defaultManualSourceRoleGuard : null;
}

function manualSourceSeed(topic, format) {
  const structures = {
    'Tutorial langkah': ['PEMBUKA', 'LANGKAH 1', 'LANGKAH 2', 'HASIL/PENUTUP'],
    'Masalah dan solusi': ['MASALAH', 'SOLUSI', 'SOLUSI', 'PENUTUP'],
    'Fakta singkat': ['PEMBUKA', 'FAKTA UTAMA', 'KONTEKS', 'KESIMPULAN'],
    Listicle: ['ITEM 1', 'ITEM 2', 'ITEM 3', 'ITEM 4'],
    'Tips cepat': ['PEMBUKA', 'TIPS 1', 'TIPS 2', 'PENUTUP'],
    'Before-after': ['BEFORE', 'PERUBAHAN', 'AFTER', 'PENUTUP']
  };
  const sections = structures[format] || ['PEMBUKA', 'ISI 1', 'ISI 2', 'PENUTUP'];
  const slides = sections.map(section => ({ section, title: 'Draf sumber', body: '', points: [], claims: [] }));
  return {
    focus: { masalah: 'Konteks dari sumber', penyebab: 'Fakta dari sumber', solusi: 'Poin utama dari sumber', hasil: 'Ringkasan dari sumber' },
    topic,
    hook: `Ringkasan sumber tentang ${topic}`,
    body: 'Konten dibangun dari fakta sumber.',
    caption: 'Konten dibangun dari fakta sumber.',
    hashtags: [],
    cta: 'Ringkasan akhir',
    trendKeywordsUsed: [],
    content_angle: `fakta sumber tentang ${topic}`,
    primary_tool: 'tanpa tool',
    hook_pattern: 'source-locked',
    verificationStatus: 'needs_review',
    unsupportedClaims: [],
    slides
  };
}

function deterministicFallback({ generated, sources, topic, requestedFormat }) {
  const fallback = buildDeterministicSourceFallback({ generated, sources, topic, requestedFormat });
  if (String(requestedFormat || '').toLocaleLowerCase('id-ID') === 'listicle') delete fallback.effectiveContentFormat;
  return fallback;
}

async function generateAndSave({ db, mode = 'ai', requestedTopic, category = 'Iklan & UGC', customCategory, format = 'Tutorial langkah', content = defaultContent, images = defaultImages, trending = defaultTrending, sourceFetcher = defaultSourceFetcher, sourceFilter = null, manualSourceRoleGuard = null, mainTopic = null, angle = null, useTrendReference = true, forceNewAngle = false, watermark, background, useSources = false, sourceUrls = [] }) {
  if (!MODES.has(mode)) throw Object.assign(new Error('Sumber topik tidak valid'), { status: 400 });
  const contentCategory = resolveCategory(category, customCategory);
  const contentFormat = resolveFormat(format);
  const trendReference = useTrendReference ? trendReferences.usable(db) : null;
  const manualTopic = String(requestedTopic || '').trim().replace(/\s+/g, ' ');
  if (mode === 'manual' && !manualTopic) throw Object.assign(new Error('Topik manual wajib diisi'), { status: 400 });
  if (mode === 'manual' && isDuplicate(db, manualTopic)) throw Object.assign(new Error('Topik tersebut sudah pernah dibuat'), { status: 409 });
  const shouldUseSources = useSources === true && (mode === 'manual' || mode === 'ai');
  let sources = [];
  let sourceContext = '';
  if (shouldUseSources) {
    const cleanSourceUrls = sourceFetcher.validateSourceUrls ? sourceFetcher.validateSourceUrls(sourceUrls) : sourceUrls;
    sources = await sourceFetcher.fetchSources(cleanSourceUrls);
    sourceContext = sourceFetcher.buildSourceContext ? sourceFetcher.buildSourceContext(sources) : '';
  }

  let trends = [];
  let trendingFallback = false;
  if (mode === 'trending') {
    try { trends = await trending.getLatest(contentCategory); } catch { trendingFallback = true; }
    if (!trends.length) trendingFallback = true;
  }

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const used = previousTopics(db);
    const history = recentContents(db);
    const availableTrend = trends.find((topic) => !used.some((old) => normalizeTopic(old) === normalizeTopic(topic)));
    const basis = mode === 'manual' ? manualTopic : mode === 'trending' ? availableTrend : undefined;
    const generationOptions = {
      topicSource: mode,
      requestedTopic: basis,
      trendingFallback: mode === 'trending' && (!basis || trendingFallback),
      date: new Date().toISOString().slice(0, 10),
      contentCategory,
      contentFormat,
      recentContents: history,
      rejectedAngle: attempt > 1 || forceNewAngle ? 'Angle sebelumnya gagal atau terlalu mirip; pilih kandidat lain dengan tool, hook, langkah, dan CTA berbeda.' : null,
      trendReference: trendReference ? { keywords: trendReference.keywords, keyword_categories: trendReference.keyword_categories, trend_hooks: trendReference.trend_hooks, trend_content_patterns: trendReference.trend_content_patterns, source: trendReference.source, region: trendReference.region, intensity: trendReference.intensity, notes: trendReference.notes } : null,
      useSources: shouldUseSources,
      sourceContext: shouldUseSources ? sourceContext : '',
      sources: shouldUseSources ? sources : []
    };
    let generated;
    if (shouldUseSources) {
      if (mode === 'manual') {
        const activeManualSourceRoleGuard = resolveManualSourceRoleGuard(manualSourceRoleGuard, content);
        if (activeManualSourceRoleGuard?.repairManualSourceRoles) {
          const seed = manualSourceSeed(basis, contentFormat);
          try {
            generated = await activeManualSourceRoleGuard.repairManualSourceRoles({
              contentService: content,
              generated: seed,
              options: generationOptions,
              sources
            });
          } catch (error) {
            if (content !== defaultContent) throw error;
            generated = deterministicFallback({ generated: seed, sources, topic: basis, requestedFormat: contentFormat });
          }
        } else {
          generated = await content.generateContent(used, generationOptions);
        }
      } else {
        const activeSourceFilter = sourceFilter || (content === defaultContent ? defaultSourceFilter : null);
        try {
          generated = activeSourceFilter
            ? await activeSourceFilter.generateFilteredContent({ content, previousTopics: used, options: generationOptions, sources })
            : await content.generateContent(used, generationOptions);
        } catch (error) {
          if (content !== defaultContent) throw error;
          const sourceTopic = String(sources[0]?.title || 'Ringkasan sumber').trim();
          generated = deterministicFallback({ generated: manualSourceSeed(sourceTopic, contentFormat), sources, topic: sourceTopic, requestedFormat: contentFormat });
        }
      }
    } else {
      generated = await content.generateContent(used, generationOptions);
    }
    if (shouldUseSources && content === defaultContent) {
      let sourceErrors = validateSourceContent(generated, sources);
      if (sourceErrors.length) {
        const sourceTopic = mode === 'manual'
          ? manualTopic
          : String(generated?.topic || sources[0]?.title || 'Ringkasan sumber').trim();
        generated = deterministicFallback({ generated, sources, topic: sourceTopic, requestedFormat: contentFormat });
        sourceErrors = validateSourceContent(generated, sources);
        if (sourceErrors.length) throw Object.assign(new Error(`Konten URL belum memenuhi final source gate: ${sourceErrors[0]}`), { status: 422, validationErrors: sourceErrors });
      }
    }
    generated.content_angle ||= angle || generated.topic;
    generated.primary_tool ||= 'tanpa tool';
    generated.hook_pattern ||= generated.hook;
    if (shouldUseSources) {
      generated.verificationStatus = content === defaultContent ? 'source_based' : (generated.verificationStatus === 'needs_review' ? 'needs_review' : 'source_based');
      generated.sources = sources.map(({ url, finalUrl, title, fetchedAt }) => ({ url, finalUrl, title, fetchedAt }));
      generated.sourceCount = generated.sources.length;
    }
    const finalContentFormat = generated.effectiveContentFormat || contentFormat;
    const similarityScore = similarityToHistory(generated, history);
    const sameToolCount = recentContents(db, 10).filter(item => normalizeTopic(item.primary_tool) === normalizeTopic(generated.primary_tool) && normalizeTopic(generated.primary_tool) !== 'tanpa tool').length;
    const failsHistoryDiversity = mode !== 'manual' && (similarityScore > 0.55 || sameToolCount >= 2);
    if (failsHistoryDiversity && attempt < MAX_GENERATION_ATTEMPTS) continue;
    if (failsHistoryDiversity) throw Object.assign(new Error('Konten terlalu mirip dengan 15 konten terakhir setelah 2 kali pembuatan ulang angle.'), { status: 422 });
    if (isDuplicate(db, generated.topic)) {
      if (mode === 'manual' || attempt === MAX_GENERATION_ATTEMPTS) throw duplicateTopicError();
      trends = trends.filter((topic) => normalizeTopic(topic) !== normalizeTopic(basis));
      continue;
    }
    let renderedSlides = [];
    try {
      const allowed = new Set((trendReference?.keywords || []).map(x => x.toLocaleLowerCase('id-ID')));
      const usedKeywords = [...new Set((generated.trendKeywordsUsed || []).filter(x => allowed.has(String(x).toLocaleLowerCase('id-ID'))))].slice(0, 3);
      const ignoredKeywords = (trendReference?.keywords || []).filter(keyword => !usedKeywords.some(used => used.toLocaleLowerCase('id-ID') === keyword.toLocaleLowerCase('id-ID')));
      const renderKey = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      renderedSlides = await images.createSlides(renderKey, { ...generated, contentCategory, contentFormat: finalContentFormat, watermark, background });
      const result = db.prepare('INSERT INTO contents(topic,topic_source,requested_topic,main_topic,content_angle,primary_tool,hook_pattern,similarity_score,content_category,content_format,hook,body,caption,hashtags,cta,slides,trend_reference_id,trend_keywords_used,trend_keywords_ignored,background,render_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(generated.topic, mode, mode === 'manual' ? manualTopic : null, mainTopic, generated.content_angle, generated.primary_tool, generated.hook_pattern, similarityScore, contentCategory, finalContentFormat, generated.hook, generated.body, generated.caption, JSON.stringify(generated.hashtags), generated.cta, JSON.stringify(renderedSlides), trendReference?.id || null, JSON.stringify(usedKeywords), JSON.stringify(ignoredKeywords), JSON.stringify(background ? { ...background, imageData: undefined, slideBackgrounds: Object.fromEntries(Object.entries(background.slideBackgrounds || {}).map(([key, value]) => [key, { ...value, imageData: undefined }])) } : {}), JSON.stringify({ ...generated, contentCategory, contentFormat: finalContentFormat, watermark }));
      try {
        let stableSlides = renderedSlides;
        if (images.promoteSlides) stableSlides = await images.promoteSlides(renderedSlides, result.lastInsertRowid, [], stable => db.prepare('UPDATE contents SET slides=? WHERE id=?').run(JSON.stringify(stable), result.lastInsertRowid));
        else db.prepare('UPDATE contents SET slides=? WHERE id=?').run(JSON.stringify(stableSlides), result.lastInsertRowid);
        return result.lastInsertRowid;
      } catch (error) {
        db.prepare('DELETE FROM contents WHERE id=?').run(result.lastInsertRowid);
        if (images.cleanupSlides) await images.cleanupSlides(renderedSlides);
        throw error;
      }
    } catch (error) {
      if (renderedSlides.length && images.cleanupSlides) await images.cleanupSlides(renderedSlides);
      const isUniqueConflict = String(error.code || error.message).includes('UNIQUE');
      if (!isUniqueConflict) throw error;
      if (mode === 'manual' || attempt === MAX_GENERATION_ATTEMPTS) throw duplicateTopicError();
    }
  }
}

module.exports = { generateAndSave, normalizeTopic, isDuplicate, recentContents, textSimilarity, similarityToHistory, manualSourceSeed, resolveManualSourceRoleGuard, deterministicFallback, MAX_GENERATION_ATTEMPTS };
