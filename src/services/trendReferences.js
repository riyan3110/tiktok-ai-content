const SOURCES = new Set(['TikTok Creative Center', 'Google Trends', 'Instagram', 'X / Twitter', 'Sumber lain']);
const INTENSITIES = new Set(['Rendah', 'Sedang', 'Tinggi']);
const MAX_KEYWORD_LENGTH = 80;

function normalizeKeywords(input) {
  const values = Array.isArray(input) ? input : String(input || '').split(/[,\n]/);
  const seen = new Set();
  return values.map(value => String(value).trim().replace(/^#+\s*/, '#').replace(/\s+/g, ' ')).filter(value => {
    const key = value.replace(/^#/, '').toLocaleLowerCase('id-ID');
    if (!value || value.length > MAX_KEYWORD_LENGTH || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function defaultExpiry(fetchedAt) {
  const jakarta = new Date(new Date(fetchedAt).getTime() + 7 * 3600000);
  return new Date(Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), jakarta.getUTCDate(), 16, 59, 59, 999)).toISOString();
}

function expiryFor(value, fetchedAt) {
  const start = new Date(fetchedAt);
  if (value === 'never') return null;
  if (value === '24h') return new Date(start.getTime() + 86400000).toISOString();
  if (value === '3d') return new Date(start.getTime() + 3 * 86400000).toISOString();
  return defaultExpiry(start);
}

function serialize(row, now = new Date()) {
  if (!row) return null;
  const expired = row.expires_at && new Date(row.expires_at) <= now;
  const active = Boolean(row.is_active) && !expired;
  return { ...row, keywords: JSON.parse(row.keywords), is_active: Boolean(row.is_active), usable: active,
    status: !row.is_active ? 'Dinonaktifkan' : expired ? 'Sudah kedaluwarsa' : row.expires_at && new Date(row.expires_at) <= new Date(defaultExpiry(now)) ? 'Akan berakhir hari ini' : 'Aktif dan terbaru' };
}

function current(db) { return serialize(db.prepare('SELECT * FROM trend_reference_sets ORDER BY id DESC LIMIT 1').get()); }
function usable(db) { const item = current(db); return item?.usable ? item : null; }
function save(db, body, id) {
  const keywords = normalizeKeywords(body.keywords);
  if (!keywords.length) throw Object.assign(new Error('Minimal 1 keyword tren yang valid wajib diisi'), { status: 400 });
  if (keywords.length > 30) throw Object.assign(new Error('Maksimal 30 keyword tren'), { status: 400 });
  if (!SOURCES.has(body.source)) throw Object.assign(new Error('Sumber tren tidak valid'), { status: 400 });
  if (!INTENSITIES.has(body.intensity || 'Sedang')) throw Object.assign(new Error('Intensitas tidak valid'), { status: 400 });
  const fetchedAt = new Date(body.fetchedAt || Date.now());
  if (Number.isNaN(fetchedAt.getTime())) throw Object.assign(new Error('Waktu pengambilan tidak valid'), { status: 400 });
  const values = [JSON.stringify(keywords), body.source, String(body.region || 'Indonesia').trim(), body.intensity || 'Sedang', String(body.notes || '').trim() || null, fetchedAt.toISOString(), expiryFor(body.validity, fetchedAt)];
  if (id) { const result = db.prepare('UPDATE trend_reference_sets SET keywords=?,source=?,region=?,intensity=?,notes=?,fetched_at=?,expires_at=?,is_active=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(...values, id); if (!result.changes) throw Object.assign(new Error('Referensi tidak ditemukan'), { status: 404 }); }
  else db.prepare('INSERT INTO trend_reference_sets(keywords,source,region,intensity,notes,fetched_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(...values);
  return current(db);
}
module.exports = { normalizeKeywords, defaultExpiry, serialize, current, usable, save };
