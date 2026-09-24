const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../config');
const { StorageService } = require('../storage/service');

const PATCHED = Symbol.for('aiads.insertedImagePatch');
const WIDTH = 1080;
const HEIGHT = 1920;
// Default is the visual source of truth for inserted Slide 1 images.
// Non-default layouts must use the exact same image geometry: same left/right
// margins, same top position, same box size, and therefore the same bottom
// background. Long titles are fitted above the image instead of moving it.
const MARGIN = 54;
const BASE_INSERT_TOP = 900;
const INSERT_BOX_WIDTH = WIDTH - MARGIN * 2;
const INSERT_BOX_HEIGHT = HEIGHT - BASE_INSERT_TOP - MARGIN;
const TITLE_GAP = 56;
const INSERT_RADIUS = 28;
const TITLE_MAX_HEIGHT = BASE_INSERT_TOP - (670 + TITLE_GAP);

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

  // Match the non-default renderer: full available content width, no artificial
  // 0.88 narrowing, and a maximum height that ends before the fixed image top.
  const maxWidth = WIDTH - 90 - 70;
  const startSize = 72;
  const minSize = style === 'news' ? 42 : 40;
  const maxLines = 3;
  const maxHeight = TITLE_MAX_HEIGHT;

  for (let size = startSize; size >= minSize; size -= 2) {
    const lines = images.wrapText(title, maxWidth, size, true);
    const height = lines.length * size * 1.18;
    if (lines.length <= maxLines && height <= maxHeight) return { lines, fontSize: size, height };
  }
  const lines = images.wrapText(title, maxWidth, minSize, true).slice(0, maxLines);
  return { lines, fontSize: minSize, height: lines.length * minSize * 1.18 };
}

function resolveInsertBox(images, renderSource = {}) {
  // Never move or shrink the image to accommodate a longer non-default title.
  // The title renderer is responsible for fitting the title into the area above
  // this fixed box. This keeps the image and bottom background identical to Default.
  titleFitForInsert(images, renderSource);
  return Object.freeze({
    left: MARGIN,
    top: BASE_INSERT_TOP,
    width: INSERT_BOX_WIDTH,
    height: INSERT_BOX_HEIGHT
  });
}

async function overlaySlideOne(file, input, insertBox) {
  const target = generatedPath(file);
  if (!target) throw Object.assign(new Error('Slide pertama tidak valid.'), { status: 422 });

  // Reference #2 geometry: the photo ALWAYS fills the fixed 972x966 box at
  // left=54, top=900 (margins 54/54/54). Use `cover` so the box is filled edge
  // to edge with NO purple gaps on the sides — this is what reference #2 shows.
  // The user's standard input is a square 1:1 (e.g. 1536x1536, 2x2 panel), which
  // covers a near-square box with only a ~0.6% center crop (imperceptible).
  // We do NOT trim()+re-center: trim() ate the source's own uniform borders
  // (white character-sheet backgrounds), which shrank the photo below the box
  // and produced uneven margins + a too-large bottom gap. Compositing the
  // box-sized buffer at the fixed origin guarantees identical 54/54/54 margins
  // and a photo whose top never moves below y=900 no matter how long the title.
  const boxPhoto = await sharp(input)
    .rotate()
    .resize(insertBox.width, insertBox.height, {
      fit: 'cover',
      position: 'centre'
    })
    .png()
    .toBuffer();

  const roundedMask = Buffer.from(
    `<svg width="${insertBox.width}" height="${insertBox.height}"><rect x="0" y="0" width="${insertBox.width}" height="${insertBox.height}" rx="${INSERT_RADIUS}" ry="${INSERT_RADIUS}"/></svg>`
  );
  const roundedPhoto = await sharp(boxPhoto)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  const temporary = `${target}.insert-${process.pid}-${Date.now()}.jpg`;
  try {
    await sharp(target)
      .composite([{ input: roundedPhoto, left: insertBox.left, top: insertBox.top }])
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
  overlaySlideOne,
  INSERT_RADIUS,
  INSERT_BOX_WIDTH,
  INSERT_BOX_HEIGHT,
  resolveInsertBox,
  titleFitForInsert,
  generatedPath,
  TITLE_MAX_HEIGHT
};
