const defaultTikTok = require('./tiktok');

const PENDING_STATUSES = new Set(['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD', 'CANCEL_REQUESTED']);

async function validToken(db, tiktok = defaultTikTok) {
  let token = db.prepare("SELECT * FROM oauth_tokens WHERE provider='tiktok'").get();
  if (!token) return null;

  if (Number(token.expires_at) < Date.now() + 60_000) {
    if (!token.refresh_token) return null;
    const next = await tiktok.refresh(token.refresh_token);
    if (!next?.access_token || !Number.isFinite(Number(next.expires_in))) return null;
    const now = Date.now();
    db.prepare("UPDATE oauth_tokens SET access_token=?,refresh_token=?,expires_at=?,refresh_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE provider='tiktok'").run(
      next.access_token,
      next.refresh_token || token.refresh_token,
      now + Number(next.expires_in) * 1000,
      next.refresh_expires_in ? now + Number(next.refresh_expires_in) * 1000 : token.refresh_expires_at
    );
    token = db.prepare("SELECT * FROM oauth_tokens WHERE provider='tiktok'").get();
  }

  return token;
}

function cancellationMessage(error) {
  if (error?.tiktokCode === 'publish_not_cancellable') return 'Task TikTok ini sudah masuk tahap akhir sehingga tidak bisa dibatalkan lagi.';
  if (error?.tiktokCode === 'invalid_publish_id') return 'Publish ID TikTok tidak ditemukan atau sudah berakhir.';
  if (error?.tiktokCode === 'token_not_authorized_for_specified_publish_id') return 'Akun TikTok yang terhubung tidak berhak membatalkan upload ini.';
  return error?.message || 'Gagal membatalkan upload TikTok.';
}

async function cancelPendingPublish({ db, tiktok = defaultTikTok, publishId }) {
  const id = String(publishId || '').trim();
  if (!id) throw Object.assign(new Error('Publish ID TikTok wajib diisi.'), { status: 400 });

  const item = db.prepare('SELECT id,publish_status FROM contents WHERE publish_id=?').get(id);
  if (!item) throw Object.assign(new Error('Upload TikTok tidak ditemukan di AI Ads Lab.'), { status: 404 });
  if (!PENDING_STATUSES.has(String(item.publish_status || '').toUpperCase())) {
    throw Object.assign(new Error(`Upload TikTok sudah berstatus ${item.publish_status || 'selesai'} dan tidak lagi dianggap pending.`), { status: 409 });
  }

  const token = await validToken(db, tiktok);
  if (!token) throw Object.assign(new Error('Hubungkan akun TikTok terlebih dahulu.'), { status: 401 });

  await tiktok.cancel(token.access_token, id);
  db.prepare("UPDATE contents SET publish_status='CANCEL_REQUESTED',publish_error=NULL,fail_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE publish_id=?").run(id);
  return { cancelled: true, status: 'CANCEL_REQUESTED', publishId: id };
}

function install({ app, db, tiktok = defaultTikTok }) {
  if (!app || !db) throw new Error('TikTok cancel patch membutuhkan app dan db.');
  app.post('/cancel-tiktok/:publishId', async (req, res) => {
    try {
      res.status(202).json(await cancelPendingPublish({ db, tiktok, publishId: req.params.publishId }));
    } catch (error) {
      const status = Number(error?.status || error?.httpStatus) || 502;
      res.status(status).json({ error: cancellationMessage(error), code: error?.tiktokCode || null });
    }
  });
}

module.exports = { install, validToken, cancelPendingPublish, cancellationMessage, PENDING_STATUSES };
