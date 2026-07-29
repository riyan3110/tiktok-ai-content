const defaultContent = require('./content');
const defaultImages = require('./images');
const defaultTrending = require('./trendingTopics');

const MODES = new Set(['manual', 'ai', 'trending']);
const normalizeTopic = (topic) => String(topic || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');

function previousTopics(db) {
  return db.prepare('SELECT topic FROM contents ORDER BY id DESC LIMIT 50').all().map(({ topic }) => topic);
}

function isDuplicate(db, topic) {
  const normalized = normalizeTopic(topic);
  return db.prepare('SELECT topic FROM contents').all().some((row) => normalizeTopic(row.topic) === normalized);
}

async function generateAndSave({ db, mode = 'ai', requestedTopic, content = defaultContent, images = defaultImages, trending = defaultTrending }) {
  if (!MODES.has(mode)) throw Object.assign(new Error('Sumber topik tidak valid'), { status: 400 });
  const manualTopic = String(requestedTopic || '').trim().replace(/\s+/g, ' ');
  if (mode === 'manual' && !manualTopic) throw Object.assign(new Error('Topik manual wajib diisi'), { status: 400 });
  if (mode === 'manual' && isDuplicate(db, manualTopic)) throw Object.assign(new Error('Topik tersebut sudah pernah dibuat'), { status: 409 });

  let trends = [];
  let trendingFallback = false;
  if (mode === 'trending') {
    try { trends = await trending.getLatest(); } catch { trendingFallback = true; }
    if (!trends.length) trendingFallback = true;
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const used = previousTopics(db);
    const availableTrend = trends.find((topic) => !used.some((old) => normalizeTopic(old) === normalizeTopic(topic)));
    const basis = mode === 'manual' ? manualTopic : mode === 'trending' ? availableTrend : undefined;
    const generated = await content.generateContent(used, {
      topicSource: mode,
      requestedTopic: basis,
      trendingFallback: mode === 'trending' && (!basis || trendingFallback),
      date: new Date().toISOString().slice(0, 10)
    });
    if (isDuplicate(db, generated.topic)) {
      if (mode === 'manual' || attempt === 3) throw Object.assign(new Error('Topik duplikat setelah 3 percobaan'), { status: 409 });
      trends = trends.filter((topic) => normalizeTopic(topic) !== normalizeTopic(basis));
      continue;
    }
    try {
      const result = db.prepare('INSERT INTO contents(topic,topic_source,requested_topic,hook,body,caption,hashtags,cta) VALUES(?,?,?,?,?,?,?,?)')
        .run(generated.topic, mode, mode === 'manual' ? manualTopic : null, generated.hook, generated.body, generated.caption, JSON.stringify(generated.hashtags), generated.cta);
      const slides = await images.createSlides(result.lastInsertRowid, generated);
      db.prepare('UPDATE contents SET slides=? WHERE id=?').run(JSON.stringify(slides), result.lastInsertRowid);
      return result.lastInsertRowid;
    } catch (error) {
      if (!String(error.code || error.message).includes('UNIQUE') || mode === 'manual' || attempt === 3) throw error;
    }
  }
}

module.exports = { generateAndSave, normalizeTopic, isDuplicate };
