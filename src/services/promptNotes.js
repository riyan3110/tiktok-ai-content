'use strict';

const crypto = require('node:crypto');

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'prompt-generator',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS prompt_notes_created_at_idx ON prompt_notes(created_at DESC);
  `);
}

function clean(value) {
  return String(value || '').replace(/\r/g, '').replace(/[\t ]+/g, ' ').trim();
}

const FILLER_RE = /^(buat(?:kan|lah)?|tolong\s+buat(?:kan|lah)?|coba\s+buat(?:kan|lah)?|create|generate|make|design|produce|write|compose|craft|render|draw|illustrate|please)\s+/i;
const SECTION_HEADER_RE = /^(project|character|product|scene|camera|lighting|voice|style|negative prompt|technical notes)$/i;
const DROP_WORDS = new Set([
  'yang', 'dan', 'dari', 'untuk', 'dengan', 'di', 'ke', 'pada', 'ini', 'itu',
  'saya', 'seorang', 'sebuah', 'suatu', 'tentang', 'seperti', 'adalah', 'sangat',
  'foto', 'gambar', 'image', 'picture', 'photo',
  'a', 'an', 'the', 'of', 'for', 'in', 'on', 'at', 'my', 'about',
  'like', 'that', 'this', 'very', 'really', 'some', 'just', 'through', 'beside',
  'baik', 'bagus', 'cantik', 'indah', 'keren', 'mantap', 'sempurna',
  'good', 'nice', 'great', 'beautiful', 'perfect', 'amazing', 'awesome', 'stunning',
]);
const TITLECASE_SMALL = new Set(['dan', 'di', 'ke', 'and', 'or', 'the', 'a', 'an', 'in', 'on', 'of', 'for', 'to', 'with']);

function titleSource(content) {
  const sections = ['Scene', 'Product', 'Project'];
  for (const section of sections) {
    const match = content.match(new RegExp(`(?:^|\\n)##\\s*${section}\\s*\\n([^\\n]+)`, 'i'));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return content.split('\n').map(line => line.replace(/^#+\s*/, '').trim()).find(line => line && !SECTION_HEADER_RE.test(line)) || '';
}

function hasMixedCase(w) { return w !== w.toLowerCase() && w !== w.toUpperCase() && /[A-Z]/.test(w.slice(1)); }

function titleCaseWord(w, isFirst) {
  if (w.includes('-')) return w.split('-').map((p, j) => titleCaseWord(p, isFirst && j === 0)).join('-');
  if (w === w.toUpperCase() && w.length > 1) return w;
  if (hasMixedCase(w)) return w;
  if (!isFirst && TITLECASE_SMALL.has(w.toLowerCase())) return w.toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function toTitleCase(words) {
  return words.map((w, i) => titleCaseWord(w, i === 0)).join(' ');
}

const CONNECTORS = new Set(['with', 'and', 'dan', 'untuk', 'on', 'of']);

function pickCorePhrase(text) {
  let s = clean(text).replace(/^[-–—:]+|[-–—:]+$/g, '').trim();
  while (FILLER_RE.test(s)) s = s.replace(FILLER_RE, '').trim();
  const words = s.split(/\s+/);
  const result = [];
  let contentCount = 0;
  const MAX_CONTENT = 3;
  let pendingConnector = null;
  for (const word of words) {
    if (result.length >= 5) break;
    const low = word.toLowerCase();
    if (CONNECTORS.has(low) && contentCount > 0 && contentCount < MAX_CONTENT) {
      pendingConnector = word;
      continue;
    }
    if (DROP_WORDS.has(low)) { pendingConnector = null; continue; }
    const isDuplicate = result.some(prev => {
      const a = prev.toLowerCase(), b = low;
      return a === b || a.startsWith(b) || b.startsWith(a);
    });
    if (isDuplicate) { pendingConnector = null; continue; }
    if (pendingConnector && contentCount > 0) result.push(pendingConnector);
    pendingConnector = null;
    result.push(word);
    contentCount++;
    if (contentCount >= MAX_CONTENT) break;
  }
  return result;
}

function autoTitle(content, now = new Date()) {
  const source = titleSource(String(content || ''));
  const words = pickCorePhrase(source);
  if (words.length >= 2) {
    return toTitleCase(words).replace(/[.,;:!?…]+$/, '').trim();
  }
  const stamp = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(now);
  return `Prompt ${stamp}`;
}

function serialize(row) {
  return row && {
    id: row.id,
    title: row.title,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function list(db, query = '') {
  ensureSchema(db);
  const search = clean(query).toLowerCase();
  const rows = db.prepare('SELECT * FROM prompt_notes ORDER BY datetime(created_at) DESC, rowid DESC LIMIT 500').all();
  return rows.filter(row => !search || `${row.title} ${row.content}`.toLowerCase().includes(search)).map(serialize);
}

function create(db, body = {}) {
  ensureSchema(db);
  const content = String(body.content || '').trim();
  if (!content) throw Object.assign(new Error('Prompt tidak boleh kosong.'), { status: 422 });
  if (content.length > 50000) throw Object.assign(new Error('Prompt terlalu panjang untuk Notes.'), { status: 413 });
  const id = crypto.randomUUID();
  const title = autoTitle(content);
  const source = clean(body.source || 'prompt-generator').slice(0, 80) || 'prompt-generator';
  db.prepare('INSERT INTO prompt_notes(id,title,content,source) VALUES(?,?,?,?)').run(id, title, content, source);
  return serialize(db.prepare('SELECT * FROM prompt_notes WHERE id=?').get(id));
}

function remove(db, id) {
  ensureSchema(db);
  return db.prepare('DELETE FROM prompt_notes WHERE id=?').run(String(id || '')).changes > 0;
}

function install({ app, db }) {
  ensureSchema(db);
  app.get('/api/notes', (req, res) => {
    try { res.json(list(db, req.query?.search)); }
    catch (error) { res.status(error.status || 500).json({ error: error.message || 'Gagal membaca Notes.' }); }
  });
  app.post('/api/notes', (req, res) => {
    try { res.status(201).json(create(db, req.body || {})); }
    catch (error) { res.status(error.status || 500).json({ error: error.message || 'Gagal menyimpan Notes.' }); }
  });
  app.delete('/api/notes/:id', (req, res) => {
    try {
      const deleted = remove(db, req.params.id);
      res.status(deleted ? 200 : 404).json(deleted ? { deleted: true } : { error: 'Catatan tidak ditemukan.' });
    } catch (error) { res.status(error.status || 500).json({ error: error.message || 'Gagal menghapus Notes.' }); }
  });
}

module.exports = { ensureSchema, autoTitle, list, create, remove, install };
