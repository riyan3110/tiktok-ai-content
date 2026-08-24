const fs = require('node:fs/promises');
const { StorageService } = require('../storage/service');

const PATCHED = Symbol.for('aiads.localMediaPreviewRange');
const PREVIEW_ROUTE = '/api/assets/:id/preview';

function routerStack(app) {
  return app?.router?.stack || app?._router?.stack || [];
}

function previewRouteLayer(app) {
  return routerStack(app).find(layer => layer?.route?.path === PREVIEW_ROUTE && layer.route.methods?.get);
}

function install({ app, db } = {}) {
  if (!app || !db) throw new Error('Local media preview patch membutuhkan app dan db.');
  if (app[PATCHED]) return;

  const layer = previewRouteLayer(app);
  if (!layer?.route?.stack?.length) {
    throw new Error(`Route ${PREVIEW_ROUTE} tidak ditemukan untuk dipatch.`);
  }

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

        // Express sendFile streams from disk instead of materializing the whole
        // asset in Node memory. The underlying send module honors HTTP Range,
        // so browser video/audio metadata probes receive 206 Partial Content
        // and can stop as soon as enough bytes have arrived.
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

  Object.defineProperty(app, PATCHED, { value: true });
}

module.exports = { install, previewRouteLayer, PREVIEW_ROUTE };
