const express = require('express');
const { StorageService } = require('../storage/service');

function parseJson(value, fallback) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}

function install({ app, db } = {}) {
  if (!app || !db) throw new Error('Asset upload patch membutuhkan app dan db.');
  const storage = new StorageService({ db });
  const rawUpload = express.raw({ type: 'application/octet-stream', limit: '50mb' });

  app.post('/api/assets/upload-file', rawUpload, async (req, res) => {
    try {
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      if (!data.length) return res.status(422).json({ error: 'File kosong' });

      const name = String(req.query.name || 'upload.bin').trim() || 'upload.bin';
      const mimeType = String(req.query.mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
      const tags = parseJson(req.query.tags, ['Other']);
      const metadata = parseJson(req.query.metadata, { category: 'Other' });
      const type = String(req.query.type || '').trim() || undefined;
      const folderId = String(req.query.folderId || '').trim() || undefined;

      const asset = await storage.upload({ name, mimeType, type, folderId, tags, metadata, data });
      return res.status(201).json(await storage.accessible(asset));
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message || 'Gagal mengunggah file.' });
    }
  });
}

module.exports = { install };
