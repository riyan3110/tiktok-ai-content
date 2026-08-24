const crypto = require('node:crypto');
const { StorageService } = require('./service');

const GENERATED_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const TEXT_CONTENT_TTL_MS = 5 * 60 * 60 * 1000;
const TIKTOK_SUCCESS_STATUSES = new Set(['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE']);
const TIKTOK_ACTIVE_STATUSES = new Set(['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD']);
const VPS_LOCKED = Symbol.for('aiads.vpsLocalStorageLocked');

function timestampMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  return Date.parse(normalized);
}

function useVpsLocalStorage(db) {
  db.prepare("UPDATE storage_settings SET provider='local',updated_at=CURRENT_TIMESTAMP WHERE id=1").run();
  return db.prepare('SELECT provider,storage_quota,updated_at FROM storage_settings WHERE id=1').get();
}

function installVpsLocalStorageLock() {
  const prototype = StorageService.prototype;
  if (prototype[VPS_LOCKED]) return;
  const originalSaveSettings = prototype.saveSettings;
  prototype.saveSettings = function saveVpsOnlySettings(body = {}) {
    return originalSaveSettings.call(this, { ...body, provider: 'local' });
  };
  Object.defineProperty(prototype, VPS_LOCKED, { value: true });
}

async function cleanupGeneratedAssets({ db, storage = new StorageService({ db }), now = Date.now() } = {}) {
  const rows = db.prepare("SELECT id,created_at FROM assets WHERE storage_provider='local' AND is_generated=1").all();
  const result = { deleted: 0, skipped: 0, failed: [] };
  for (const row of rows) {
    const createdAt = timestampMs(row.created_at);
    if (!Number.isFinite(createdAt) || now - createdAt < GENERATED_MEDIA_TTL_MS) {
      result.skipped += 1;
      continue;
    }
    try {
      if (await storage.delete(row.id, { permanent: true })) result.deleted += 1;
      else result.skipped += 1;
    } catch (error) {
      result.failed.push({ id: row.id, error: error.message });
    }
  }
  return result;
}

function parseSlides(value) {
  try {
    const slides = JSON.parse(value || '[]');
    return Array.isArray(slides) ? slides : [];
  } catch {
    return [];
  }
}

async function cleanupTextContentSlides({ db, images, now = Date.now() } = {}) {
  if (!images?.cleanupSlides) throw new Error('Image cleanup service tidak tersedia.');
  const rows = db.prepare("SELECT id,slides,publish_status,created_at FROM contents WHERE slides IS NOT NULL AND slides <> '[]'").all();
  const result = { deletedContents: 0, deletedFiles: 0, skipped: 0, failed: [] };
  for (const row of rows) {
    const slides = parseSlides(row.slides);
    if (!slides.length) continue;
    const status = String(row.publish_status || '').trim();
    const createdAt = timestampMs(row.created_at);
    const uploaded = TIKTOK_SUCCESS_STATUSES.has(status);
    const expired = Number.isFinite(createdAt) && now - createdAt >= TEXT_CONTENT_TTL_MS;
    const activeUpload = TIKTOK_ACTIVE_STATUSES.has(status);
    if (!uploaded && (!expired || activeUpload)) {
      result.skipped += 1;
      continue;
    }
    try {
      await images.cleanupSlides(slides);
      db.prepare("UPDATE contents SET slides='[]',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
      result.deletedContents += 1;
      result.deletedFiles += slides.length;
    } catch (error) {
      result.failed.push({ id: row.id, error: error.message });
    }
  }
  return result;
}

async function cleanupTemporaryStorage({ db, storage = new StorageService({ db }), images, now = Date.now() } = {}) {
  const generated = await cleanupGeneratedAssets({ db, storage, now });
  const textContent = await cleanupTextContentSlides({ db, images, now });
  return { generated, textContent };
}

async function migrateTencentCosToLocal({ db, storage = new StorageService({ db }), deleteSource = true } = {}) {
  const settings = storage.row();
  if (!settings?.secret_id_encrypted || !settings?.secret_key_encrypted || !settings?.bucket || !settings?.region) {
    throw new Error('Kredensial/bucket Tencent COS belum lengkap untuk migrasi.');
  }

  const active = storage.repository.list({ provider: 'tencent-cos' });
  const trashed = storage.repository.list({ provider: 'tencent-cos', trash: 'true' });
  const assets = [...active, ...trashed];
  const source = storage.adapter('tencent-cos');
  const target = storage.local();
  const result = { total: assets.length, migrated: 0, sourceDeleted: 0, failed: [], warnings: [] };

  for (const asset of assets) {
    try {
      const downloaded = await source.download(asset.storage_key);
      const checksum = crypto.createHash('sha256').update(downloaded.data).digest('hex');
      if (asset.checksum && checksum !== asset.checksum) {
        throw new Error(`Checksum tidak cocok untuk ${asset.storage_key}`);
      }

      const stored = await target.upload(asset.storage_key, downloaded.data, {
        mimeType: downloaded.contentType || asset.mime_type,
        filename: asset.name
      });

      try {
        storage.repository.update(asset.id, {
          storageProvider: 'local',
          storageKey: stored.key,
          storageUrl: stored.url,
          metadata: {
            ...asset.metadata,
            migratedFrom: 'tencent-cos',
            migratedAt: new Date().toISOString()
          }
        });
      } catch (error) {
        await target.delete(stored.key).catch(() => {});
        throw error;
      }

      result.migrated += 1;
      if (deleteSource) {
        try {
          await source.delete(asset.storage_key);
          result.sourceDeleted += 1;
        } catch (error) {
          result.warnings.push({ id: asset.id, key: asset.storage_key, error: `File lokal aman, tetapi COS gagal dihapus: ${error.message}` });
        }
      }
    } catch (error) {
      result.failed.push({ id: asset.id, key: asset.storage_key, error: error.message });
    }
  }

  useVpsLocalStorage(db);
  return result;
}

module.exports = {
  GENERATED_MEDIA_TTL_MS,
  TEXT_CONTENT_TTL_MS,
  TIKTOK_SUCCESS_STATUSES,
  TIKTOK_ACTIVE_STATUSES,
  useVpsLocalStorage,
  installVpsLocalStorageLock,
  cleanupGeneratedAssets,
  cleanupTextContentSlides,
  cleanupTemporaryStorage,
  migrateTencentCosToLocal,
  timestampMs
};
