const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('../config');

function validId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

function ownedImagePath(id, slide, generatedDir = path.join(config.root, 'public/generated')) {
  if (typeof slide !== 'string' || !new RegExp(`^/generated/${id}-\\d+\\.jpg$`, 'i').test(slide)) return null;
  const root = path.resolve(generatedDir);
  const candidate = path.resolve(root, path.basename(slide));
  return path.dirname(candidate) === root ? candidate : null;
}

async function removeImages(row, generatedDir) {
  let slides = [];
  try { slides = JSON.parse(row.slides); } catch { /* Ignore invalid legacy paths rather than deleting unsafe files. */ }
  const files = [...new Set((Array.isArray(slides) ? slides : []).map((slide) => ownedImagePath(row.id, slide, generatedDir)).filter(Boolean))];
  await Promise.all(files.map((file) => fs.unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; })));
}

async function deleteOne(db, rawId, generatedDir) {
  if (!validId(rawId)) throw Object.assign(new Error('ID riwayat tidak valid'), { status: 400 });
  const row = db.prepare('SELECT id,slides,publish_id,publish_status FROM contents WHERE id=?').get(Number(rawId));
  if (!row) throw Object.assign(new Error('Konten tidak ditemukan'), { status: 404 });
  await removeImages(row, generatedDir);
  db.prepare('DELETE FROM contents WHERE id=?').run(row.id);
  return { deleted: 1, tiktokWarning: Boolean(row.publish_id) };
}

async function deleteAll(db, generatedDir) {
  const rows = db.prepare('SELECT id,slides,publish_id,publish_status FROM contents').all();
  for (const row of rows) await removeImages(row, generatedDir);
  db.prepare('DELETE FROM contents').run();
  return { deleted: rows.length, tiktokWarning: rows.some((row) => Boolean(row.publish_id)) };
}

module.exports = { deleteOne, deleteAll, ownedImagePath, validId };
