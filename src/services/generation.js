const defaultContent = require('./content');
const defaultImages = require('./images');
const defaultTrending = require('./trendingTopics');
const { resolveCategory, resolveFormat } = require('./contentOptions');
const trendReferences = require('./trendReferences');

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

async function generateAndSave({ db, mode = 'ai', requestedTopic, category = 'Iklan & UGC', customCategory, format = 'Tutorial langkah', content = defaultContent, images = defaultImages, trending = defaultTrending, mainTopic = null, angle = null, useTrendReference = true, forceNewAngle = false, watermark, background }) {
  if (!MODES.has(mode)) throw Object.assign(new Error('Sumber topik tidak valid'), { status: 400 });
  const contentCategory = resolveCategory(category, customCategory);
  const contentFormat = resolveFormat(format);
  const trendReference = useTrendReference ? trendReferences.usable(db) : null;
  const manualTopic = String(requestedTopic || '').trim().replace(/\s+/g, ' ');
  if (mode === 'manual' && !manualTopic) throw Object.assign(new Error('Topik manual wajib diisi'), { status: 400 });
  if (mode === 'manual' && isDuplicate(db, manualTopic)) throw Object.assign(new Error('Topik tersebut sudah pernah dibuat'), { status: 409 });

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
    const generated = await content.generateContent(used, {
      topicSource: mode,
      requestedTopic: basis,
      trendingFallback: mode === 'trending' && (!basis || trendingFallback),
      date: new Date().toISOString().slice(0, 10),
      contentCategory,
      contentFormat,
      recentContents: history,
      rejectedAngle: attempt > 1 || forceNewAngle ? 'Angle sebelumnya gagal atau terlalu mirip; pilih kandidat lain dengan tool, hook, langkah, dan CTA berbeda.' : null,
      trendReference: trendReference ? { keywords: trendReference.keywords, keyword_categories: trendReference.keyword_categories, trend_hooks: trendReference.trend_hooks, trend_content_patterns: trendReference.trend_content_patterns, source: trendReference.source, region: trendReference.region, intensity: trendReference.intensity, notes: trendReference.notes } : null
    });
    generated.content_angle ||= angle || generated.topic;
    generated.primary_tool ||= 'tanpa tool';
    generated.hook_pattern ||= generated.hook;
    const similarityScore = similarityToHistory(generated, history);
    const sameToolCount = recentContents(db, 10).filter(item => normalizeTopic(item.primary_tool) === normalizeTopic(generated.primary_tool) && normalizeTopic(generated.primary_tool) !== 'tanpa tool').length;
    if ((similarityScore > 0.55 || (mode !== 'manual' && sameToolCount >= 2)) && attempt < MAX_GENERATION_ATTEMPTS) continue;
    if (similarityScore > 0.55 || (mode !== 'manual' && sameToolCount >= 2)) throw Object.assign(new Error('Konten terlalu mirip dengan 15 konten terakhir setelah 2 kali pembuatan ulang angle.'), { status: 422 });
    if (isDuplicate(db, generated.topic)) {
      if (mode === 'manual' || attempt === MAX_GENERATION_ATTEMPTS) throw duplicateTopicError();
      trends = trends.filter((topic) => normalizeTopic(topic) !== normalizeTopic(basis));
      continue;
    }
    try {
      const allowed = new Set((trendReference?.keywords || []).map(x => x.toLocaleLowerCase('id-ID')));
      const usedKeywords = [...new Set((generated.trendKeywordsUsed || []).filter(x => allowed.has(String(x).toLocaleLowerCase('id-ID'))))].slice(0, 3);
      const ignoredKeywords = (trendReference?.keywords || []).filter(keyword => !usedKeywords.some(used => used.toLocaleLowerCase('id-ID') === keyword.toLocaleLowerCase('id-ID')));
      // Rendering happens only after AI parsing, normalization, and validation;
      // the database remains untouched if any slide cannot be rendered.
      const renderKey = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const slides = await images.createSlides(renderKey, { ...generated, contentCategory, contentFormat, watermark, background });
      const result = db.prepare('INSERT INTO contents(topic,topic_source,requested_topic,main_topic,content_angle,primary_tool,hook_pattern,similarity_score,content_category,content_format,hook,body,caption,hashtags,cta,slides,trend_reference_id,trend_keywords_used,trend_keywords_ignored,background) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(generated.topic, mode, mode === 'manual' ? manualTopic : null, mainTopic, generated.content_angle, generated.primary_tool, generated.hook_pattern, similarityScore, contentCategory, contentFormat, generated.hook, generated.body, generated.caption, JSON.stringify(generated.hashtags), generated.cta, JSON.stringify(slides), trendReference?.id || null, JSON.stringify(usedKeywords), JSON.stringify(ignoredKeywords), JSON.stringify(background ? { ...background, imageData: undefined, slideBackgrounds: Object.fromEntries(Object.entries(background.slideBackgrounds || {}).map(([key, value]) => [key, { ...value, imageData: undefined }])) } : {}));
      return result.lastInsertRowid;
    } catch (error) {
      const isUniqueConflict = String(error.code || error.message).includes('UNIQUE');
      if (!isUniqueConflict) throw error;
      if (mode === 'manual' || attempt === MAX_GENERATION_ATTEMPTS) throw duplicateTopicError();
    }
  }
}

module.exports = { generateAndSave, normalizeTopic, isDuplicate, recentContents, textSimilarity, similarityToHistory, MAX_GENERATION_ATTEMPTS };
