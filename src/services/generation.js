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

function isDuplicate(db, topic) {
  const normalized = normalizeTopic(topic);
  return db.prepare('SELECT topic FROM contents').all().some((row) => normalizeTopic(row.topic) === normalized);
}

async function generateAndSave({ db, mode = 'ai', requestedTopic, category = 'Iklan & UGC', customCategory, format = 'Tutorial langkah', content = defaultContent, images = defaultImages, trending = defaultTrending, mainTopic = null, angle = null, useTrendReference = true }) {
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
    const availableTrend = trends.find((topic) => !used.some((old) => normalizeTopic(old) === normalizeTopic(topic)));
    const basis = mode === 'manual' ? manualTopic : mode === 'trending' ? availableTrend : undefined;
    const generated = await content.generateContent(used, {
      topicSource: mode,
      requestedTopic: basis,
      trendingFallback: mode === 'trending' && (!basis || trendingFallback),
      date: new Date().toISOString().slice(0, 10),
      contentCategory,
      contentFormat,
      trendReference: trendReference ? { keywords: trendReference.keywords, trend_hooks: trendReference.trend_hooks, trend_content_patterns: trendReference.trend_content_patterns, source: trendReference.source, region: trendReference.region, intensity: trendReference.intensity, notes: trendReference.notes } : null
    });
    if (isDuplicate(db, generated.topic)) {
      if (mode === 'manual' || attempt === MAX_GENERATION_ATTEMPTS) throw duplicateTopicError();
      trends = trends.filter((topic) => normalizeTopic(topic) !== normalizeTopic(basis));
      continue;
    }
    try {
      const allowed = new Set((trendReference?.keywords || []).map(x => x.toLocaleLowerCase('id-ID')));
      const usedKeywords = [...new Set((generated.trendKeywordsUsed || []).filter(x => allowed.has(String(x).toLocaleLowerCase('id-ID'))))].slice(0, 3);
      const result = db.prepare('INSERT INTO contents(topic,topic_source,requested_topic,main_topic,content_angle,content_category,content_format,hook,body,caption,hashtags,cta,trend_reference_id,trend_keywords_used) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(generated.topic, mode, mode === 'manual' ? manualTopic : null, mainTopic, angle, contentCategory, contentFormat, generated.hook, generated.body, generated.caption, JSON.stringify(generated.hashtags), generated.cta, trendReference?.id || null, JSON.stringify(usedKeywords));
      const slides = await images.createSlides(result.lastInsertRowid, { ...generated, contentCategory, contentFormat });
      db.prepare('UPDATE contents SET slides=? WHERE id=?').run(JSON.stringify(slides), result.lastInsertRowid);
      return result.lastInsertRowid;
    } catch (error) {
      const isUniqueConflict = String(error.code || error.message).includes('UNIQUE');
      if (!isUniqueConflict) throw error;
      if (mode === 'manual' || attempt === MAX_GENERATION_ATTEMPTS) throw duplicateTopicError();
    }
  }
}

module.exports = { generateAndSave, normalizeTopic, isDuplicate, MAX_GENERATION_ATTEMPTS };
