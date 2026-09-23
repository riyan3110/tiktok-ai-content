const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config');
const { StorageService } = require('../storage/service');

const PATCHED = Symbol.for('aiads.insertedImagePatch');
const WIDTH = 1080;
const HEIGHT = 1920;
// Smaller, centered, tidy card for the slide-1 inserted photo. The box sits
// well BELOW the headline block (news/story/tutorial headline can run to ~935px
// at 5 lines) so the picture never touches the title. Centered horizontally
// (left = (1080-720)/2) with rounded corners so it reads as a neat framed
// thumbnail instead of a full-bleed image.
const INSERT_BOX = Object.freeze({ left: 180, top: 1025, width: 720, height: 600 });
const INSERT_RADIUS = 34;
const INSERT_PAD = 16;

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

  const innerW = INSERT_BOX.width - INSERT_PAD * 2;
  const innerH = INSERT_BOX.height - INSERT_PAD * 2;

  // Fit the photo inside the inner box (contain, no crop) then round its corners
  // so it reads as a neat framed thumbnail rather than a raw full-bleed image.
  const photo = await sharp(input)
    .rotate()
    .resize(innerW, innerH, { fit: 'contain', position: 'centre', background: { r: 15, g: 12, b: 26, alpha: 1 } })
    .png()
    .toBuffer();
  const meta = await sharp(photo).metadata();
  const photoW = meta.width || innerW;
  const photoH = meta.height || innerH;
  const roundedMask = Buffer.from(
    `<svg width="${photoW}" height="${photoH}"><rect x="0" y="0" width="${photoW}" height="${photoH}" rx="${INSERT_RADIUS}" ry="${INSERT_RADIUS}"/></svg>`
  );
  const roundedPhoto = await sharp(photo)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Center the rounded photo within the frame; draw a soft rounded frame behind
  // it so the picture always looks deliberately placed and tidy.
  const photoLeft = INSERT_BOX.left + Math.round((INSERT_BOX.width - photoW) / 2);
  const photoTop = INSERT_BOX.top + Math.round((INSERT_BOX.height - photoH) / 2);
  const frame = Buffer.from(
    `<svg width="${WIDTH}" height="${HEIGHT}">` +
    `<rect x="${INSERT_BOX.left}" y="${INSERT_BOX.top}" width="${INSERT_BOX.width}" height="${INSERT_BOX.height}" rx="${INSERT_RADIUS + INSERT_PAD}" ry="${INSERT_RADIUS + INSERT_PAD}" fill="#000000" fill-opacity="0.28" stroke="#ffffff" stroke-opacity="0.55" stroke-width="3"/>` +
    `</svg>`
  );

  const temporary = `${target}.insert-${process.pid}-${Date.now()}.jpg`;
  try {
    await sharp(target)
      .composite([
        { input: frame, left: 0, top: 0 },
        { input: roundedPhoto, left: photoLeft, top: photoTop }
      ])
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
