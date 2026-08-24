const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const config = require('../config');
const { StorageService } = require('../storage/service');

const PATCHED = Symbol.for('aiads.localMediaPreviewRange');
const STORAGE_PATCHED = Symbol.for('aiads.localMediaThumbnailCleanup');
const PREVIEW_ROUTE = '/api/assets/:id/preview';
const THUMBNAIL_ROOT = path.join(config.root, 'data', 'asset-thumbnails');
const THUMBNAIL_WIDTH = 480;
const THUMBNAIL_HEIGHT = 270;

function routerStack(app) {
  return app?.router?.stack || app?._router?.stack || [];
}

function previewRouteLayer(app) {
  return routerStack(app).find(layer => layer?.route?.path === PREVIEW_ROUTE && layer.route.methods?.get);
}

function thumbnailPath(id) {
  const key = crypto.createHash('sha256').update(String(id || '')).digest('hex').slice(0, 40);
  return path.join(THUMBNAIL_ROOT, `${key}.jpg`);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg thumbnail gagal (${code}): ${stderr.trim().slice(-1200)}`)));
  });
}

async function genericVideoThumbnail(target) {
  const play = Buffer.from(`<svg width="480" height="270" xmlns="http://www.w3.org/2000/svg"><rect width="480" height="270" rx="16" fill="#e5e7eb"/><circle cx="240" cy="135" r="44" fill="#ffffff" fill-opacity="0.9"/><path d="M228 111 L228 159 L266 135 Z" fill="#6b7280"/></svg>`);
  await sharp(play).jpeg({ quality: 72 }).toFile(target);
}

async function createThumbnail(asset, storage) {
  const local = storage.local();
  const source = local.resolve(asset.storage_key);
  const target = thumbnailPath(asset.id);
  const sourceStat = await fs.stat(source);

  try {
    const targetStat = await fs.stat(target);
    if (targetStat.mtimeMs >= sourceStat.mtimeMs && targetStat.size > 0) return target;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await fs.mkdir(THUMBNAIL_ROOT, { recursive: true });
  const mime = storage.assetMimeType(asset);
  if (mime.startsWith('image/')) {
    await sharp(source)
      .rotate()
      .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, { fit: 'contain', background: '#e5e7eb', withoutEnlargement: true })
      .flatten({ background: '#e5e7eb' })
      .jpeg({ quality: 72, chromaSubsampling: '4:2:0' })
      .toFile(target);
    return target;
  }

  if (mime.startsWith('video/')) {
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp.jpg`;
    try {
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y', '-ss', '0.1', '-i', source,
        '-frames:v', '1', '-vf', `scale=${THUMBNAIL_WIDTH}:${THUMBNAIL_HEIGHT}:force_original_aspect_ratio=decrease,pad=${THUMBNAIL_WIDTH}:${THUMBNAIL_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0xe5e7eb`,
        '-q:v', '6', temporary
      ]);
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      await genericVideoThumbnail(target);
    }
    return target;
  }

  throw Object.assign(new Error('Thumbnail hanya tersedia untuk image/video.'), { status: 415 });
}

function installThumbnailCleanup() {
  const prototype = StorageService.prototype;
  if (prototype[STORAGE_PATCHED]) return;
  const originalDelete = prototype.delete;
  prototype.delete = async function deleteWithThumbnail(id, options = {}) {
    const deleted = await originalDelete.call(this, id, options);
    if (deleted && options.permanent) await fs.rm(thumbnailPath(id), { force: true }).catch(() => {});
    return deleted;
  };
  Object.defineProperty(prototype, STORAGE_PATCHED, { value: true });
}

function install({ app, db } = {}) {
  if (!app || !db) throw new Error('Local media preview patch membutuhkan app dan db.');
  if (app[PATCHED]) return;

  const layer = previewRouteLayer(app);
  if (!layer?.route?.stack?.length) {
    throw new Error(`Route ${PREVIEW_ROUTE} tidak ditemukan untuk dipatch.`);
  }

  installThumbnailCleanup();
  const storage = new StorageService({ db });

  for (const routeHandler of layer.route.stack) {
    const original = routeHandler.handle;
    routeHandler.handle = async function localRangePreview(req, res, next) {
      try {
        const asset = storage.repository.get(req.params.id);
        if (!asset || asset.storage_provider !== 'local') return original(req, res, next);

        const local = storage.local();
        const file = local.resolve(asset.storage_key);
        await fs.access(file);

        res.set({
          'Content-Type': storage.assetMimeType(asset),
          'Content-Disposition': 'inline',
          'Cache-Control': 'private, max-age=3600',
          'Accept-Ranges': 'bytes',
          'X-Content-Type-Options': 'nosniff'
        });

        // Stream directly from disk. Express/send honors Range and conditional
        // requests, so metadata/playback no longer materializes the whole file
        // in Node and browsers can request only the bytes they actually need.
        return res.sendFile(file, {
          acceptRanges: true,
          cacheControl: false,
          dotfiles: 'deny'
        });
      } catch (error) {
        if (error?.code === 'ENOENT') return res.status(404).json({ error: 'File asset lokal tidak ditemukan.' });
        return next(error);
      }
    };
  }

  app.get('/api/assets/:id/thumbnail', async (req, res) => {
    try {
      const asset = storage.repository.get(req.params.id);
      if (!asset) return res.status(404).json({ error: 'Asset tidak ditemukan.' });
      if (asset.storage_provider !== 'local') return res.status(409).json({ error: 'Thumbnail ringan hanya tersedia untuk asset lokal VPS.' });
      const file = await createThumbnail(asset, storage);
      res.set({
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.sendFile(file, { cacheControl: false, dotfiles: 'deny' });
    } catch (error) {
      const status = Number(error?.status) || (error?.code === 'ENOENT' ? 404 : 500);
      return res.status(status).json({ error: error.message || 'Thumbnail gagal dibuat.' });
    }
  });

  Object.defineProperty(app, PATCHED, { value: true });
}

module.exports = {
  install,
  previewRouteLayer,
  createThumbnail,
  thumbnailPath,
  PREVIEW_ROUTE,
  THUMBNAIL_WIDTH,
  THUMBNAIL_HEIGHT
};
