const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config');
const { StorageService } = require('../storage/service');

const PATCHED = Symbol.for('aiads.insertedImagePatch');
const INSERT_BOX = Object.freeze({ left: 90, top: 1140, width: 740, height: 340 });

function parseRecord(row) {
  if (!row) return null;
  return {
    ...row,
    slides: JSON.parse(row.slides || '[]'),
    hashtags: JSON.parse(row.hashtags || '[]'),
    trend_keywords_used: JSON.parse(row.trend_keywords_used || '[]'),
    trend_keywords_ignored: JSON.parse(row.trend_keywords_ignored || '[]'),
    background: JSON.parse(row.background || '{}'),
    render_source: JSON.parse(row.render_source || '{}')
  };
}

function generatedPath(file) {
  if (typeof file !== 'string' || !/^\/generated\/[a-zA-Z0-9._-]+\.jpg$/.test(file)) return null;
  const root = path.resolve(config.root, 'public/generated');
  const target = path.resolve(config.root, 'public', file.slice(1));
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

async function imageAsset(storage, assetId) {
  const id = String(assetId || '').trim();
  if (!id) throw Object.assign(new Error('Pilih gambar yang ingin disisipkan.'), { status: 400 });
  const asset = storage.repository.get(id);
  if (!asset) throw Object.assign(new Error('Gambar yang dipilih tidak ditemukan.'), { status: 404 });
  const file = await storage.preview(asset);
  if (!String(file.mimeType || '').startsWith('image/')) throw Object.assign(new Error('Asset yang disisipkan harus berupa gambar.'), { status: 422 });
  return { asset, file };
}

async function overlaySlideOne(file, input) {
  const target = generatedPath(file);
  if (!target) throw Object.assign(new Error('Slide pertama tidak valid.'), { status: 422 });
  const overlay = await sharp(input)
    .rotate()
    .resize(INSERT_BOX.width, INSERT_BOX.height, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
  const temporary = `${target}.insert-${process.pid}-${Date.now()}.jpg`;
  try {
    await sharp(target)
      .composite([{ input: overlay, left: INSERT_BOX.left, top: INSERT_BOX.top }])
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .jpeg({ quality: 90 })
      .toFile(temporary);
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function install({ app, db, images } = {}) {
  if (!app || !db || !images?.createSlides) throw new Error('Inserted image patch membutuhkan app, db, dan image service.');
  const storage = new StorageService({ db });

  if (!images[PATCHED]) {
    const originalCreateSlides = images.createSlides.bind(images);
    images.createSlides = async (id, content) => {
      const files = await originalCreateSlides(id, content);
      const assetId = String(content?.insertedImageAssetId || '').trim();
      if (!assetId || !files[0]) return files;
      const { file } = await imageAsset(storage, assetId);
      await overlaySlideOne(files[0], file.data);
      return files;
    };
    Object.defineProperty(images, PATCHED, { value: true });
  }

  app.post('/contents/:id/insert-image', async (req, res) => {
    try {
      const contentId = Number(req.params.id);
      const row = db.prepare('SELECT * FROM contents WHERE id=?').get(contentId);
      if (!row) return res.status(404).json({ error: 'Konten tidak ditemukan' });
      const slides = JSON.parse(row.slides || '[]');
      if (!slides[0]) throw Object.assign(new Error('Slide pertama belum tersedia.'), { status: 422 });

      const assetId = String(req.body?.assetId || '').trim();
      const { file } = await imageAsset(storage, assetId);
      await overlaySlideOne(slides[0], file.data);

      const renderSource = JSON.parse(row.render_source || '{}');
      renderSource.insertedImageAssetId = assetId;
      db.prepare('UPDATE contents SET render_source=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(JSON.stringify(renderSource), contentId);
      return res.json(parseRecord(db.prepare('SELECT * FROM contents WHERE id=?').get(contentId)));
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Gagal menyisipkan gambar.' });
    }
  });
}

module.exports = { install, INSERT_BOX, generatedPath };
