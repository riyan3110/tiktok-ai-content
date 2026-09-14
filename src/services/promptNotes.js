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

function titleSource(content) {
  const sections = ['Scene', 'Product', 'Project'];
  for (const section of sections) {
    const match = content.match(new RegExp(`(?:^|\\n)##\\s*${section}\\s*\\n([^\\n]+)`, 'i'));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return content.split('\n').map(line => line.replace(/^#+\s*/, '').trim()).find(line => line && !/^(project|character|product|scene|camera|lighting|voice|style|negative prompt|technical notes)$/i.test(line)) || '';
}

function autoTitle(content, now = new Date()) {
  const source = clean(titleSource(String(content || ''))).replace(/^[-–—:]+|[-–—:]+$/g, '').trim();
  if (source) {
    const words = source.split(/\s+/).slice(0, 9).join(' ');
    return words.length > 72 ? `${words.slice(0, 69).trim()}…` : words;
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
