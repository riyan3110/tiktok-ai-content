const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config');
const { StorageService } = require('../storage/service');

const PATCHED = Symbol.for('aiads.insertedImagePatch');
const WIDTH = 1080;
const HEIGHT = 1920;
// Gambar besar dengan margin kecil di kiri, kanan, dan bawah (~5% lebar kanvas = 54px).
// Posisi vertikal dihitung dari judul slide 1 agar foto tidak pernah menimpa teks.
// Tidak ada frame/border/kartu — hanya sudut membulat agar tepi terlihat rapi.
const MARGIN = 54;
const BASE_INSERT_TOP = 900;
const TITLE_GAP = 56;
const INSERT_RADIUS = 28;

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
  if (!String(file.mimeType || '').startsWith('image/')) {
    throw Object.assign(new Error('Asset yang disisipkan harus berupa gambar.'), { status: 422 });
  }
  return { asset, file };
}

function titleFitForInsert(images, renderSource) {
  const style = ['tutorial', 'story', 'news'].includes(renderSource?.contentLayout)
    ? renderSource.contentLayout
    : 'default';
  const title = String(renderSource?.slides?.[0]?.title || '').trim();
  if (!title || style === 'default') return null;

  const maxWidth = (WIDTH - 90 - 70) * 0.88;
  const startSize = 72;
  const minSize = style === 'news' ? 42 : 40;
  const maxLines = style === 'news' ? 5 : 4;
  const maxHeight = style === 'news' ? 330 : 340;

  for (let size = startSize; size >= minSize; size -= 2) {
    const lines = images.wrapText(title, maxWidth, size, true);
    const height = lines.length * size * 1.18;
    if (lines.length <= maxLines && height <= maxHeight) return { lines, fontSize: size, height };
  }
  const lines = images.wrapText(title, maxWidth, minSize, true).slice(0, maxLines);
  return { lines, fontSize: minSize, height: lines.length * minSize * 1.18 };
}

function resolveInsertBox(images, renderSource = {}) {
  const fit = titleFitForInsert(images, renderSource);
  // The variant renderer starts its title at CONTENT_TOP + 90 = 670px.
  // Keep the old 900px baseline for short titles, but push the image down when
  // a multi-line title would otherwise occupy the same vertical area.
  const titleBottom = fit ? 670 + fit.height : 0;
  const top = Math.max(BASE_INSERT_TOP, Math.ceil(titleBottom + TITLE_GAP));
  return Object.freeze({
    left: MARGIN,
    top,
    width: WIDTH - MARGIN * 2,
    height: Math.max(220, HEIGHT - top - MARGIN)
  });
}

async function overlaySlideOne(file, input, insertBox) {
  const target = generatedPath(file);
  if (!target) throw Object.assign(new Error('Slide pertama tidak valid.'), { status: 422 });

  // Fit foto ke dalam kotak besar (contain, tanpa crop) lalu bulatkan sudutnya.
  // Tidak ada frame, border, atau panel latar — hanya gambar dengan sudut membulat.
  const photo = await sharp(input)
    .rotate()
    .resize(insertBox.width, insertBox.height, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
  const meta = await sharp(photo).metadata();
  const photoW = meta.width || insertBox.width;
  const photoH = meta.height || insertBox.height;
  const roundedMask = Buffer.from(
    `<svg width="${photoW}" height="${photoH}"><rect x="0" y="0" width="${photoW}" height="${photoH}" rx="${INSERT_RADIUS}" ry="${INSERT_RADIUS}"/></svg>`
  );
  const roundedPhoto = await sharp(photo)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Tempatkan foto di tengah kotak; tidak ada frame di belakangnya.
  const photoLeft = insertBox.left + Math.round((insertBox.width - photoW) / 2);
  const photoTop = insertBox.top + Math.round((insertBox.height - photoH) / 2);

  const temporary = `${target}.insert-${process.pid}-${Date.now()}.jpg`;
  try {
    await sharp(target)
      .composite([{ input: roundedPhoto, left: photoLeft, top: photoTop }])
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

function install({ app, db, images }) {
  if (!app || !db || !images?.createSlides) throw new Error('Inserted image patch membutuhkan app, db, dan image service.');
  const storage = new StorageService({ db });

  if (!images[PATCHED]) {
    const originalCreateSlides = images.createSlides.bind(images);
    images.createSlides = async (id, content) => {
      const files = await originalCreateSlides(id, content);
      const assetId = String(content?.insertedImageAssetId || '').trim();
      if (!assetId || !files?.[0]) return files;
      const { file } = await imageAsset(storage, assetId);
      const renderSource = { ...content, contentLayout: content?.contentLayout, slides: content?.slides || [] };
      await overlaySlideOne(files[0], file.data, resolveInsertBox(images, renderSource));
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
      const renderSource = JSON.parse(row.render_source || '{}');
      await overlaySlideOne(slides[0], file.data, resolveInsertBox(images, renderSource));

      renderSource.insertedImageAssetId = assetId;
      db.prepare('UPDATE contents SET render_source=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(JSON.stringify(renderSource), contentId);
      return res.json(parseRecord(db.prepare('SELECT * FROM contents WHERE id=?').get(contentId)));
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Gagal menyisipkan gambar.' });
    }
  });
}

module.exports = {
  install,
  INSERT_RADIUS,
  resolveInsertBox,
  titleFitForInsert,
  generatedPath
};
