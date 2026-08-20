((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CarouselBackgroundState = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const BLACK = '#0B0B0D';
  const DEFAULT = Object.freeze({ type: 'color', color: BLACK, assetId: null, previewUrl: null, textColor: '#FFFFFF', applyToAllSlides: true, slideBackgrounds: {}, uploadedBackground: null });
  const copy = state => { const uploadedBackground = state?.uploadedBackground || (state?.type === 'image' && state.assetId ? { assetId: state.assetId, previewUrl: state.previewUrl, textColor: state.textColor || '#FFFFFF' } : null); return { ...DEFAULT, ...(state || {}), slideBackgrounds: { ...(state?.slideBackgrounds || {}) }, uploadedBackground: uploadedBackground ? { ...uploadedBackground } : null }; };
  const selectColor = (state, color, textColor = color === BLACK ? '#FFFFFF' : '#000000') => ({ ...copy(state), type: 'color', color, assetId: null, previewUrl: null, textColor });
  const upload = (state, uploadedBackground) => ({ ...copy(state), type: 'image', color: state?.color || BLACK, ...uploadedBackground, uploadedBackground: { ...uploadedBackground } });
  const activateUpload = state => state?.uploadedBackground ? upload(state, state.uploadedBackground) : copy(state);
  const removeUpload = state => {
    const next = copy(state);
    for (const [key, background] of Object.entries(next.slideBackgrounds)) if (background?.type === 'image') delete next.slideBackgrounds[key];
    if (next.type === 'image') Object.assign(next, { type: 'color', color: BLACK, assetId: null, previewUrl: null, textColor: '#FFFFFF' });
    next.uploadedBackground = null;
    return next;
  };
  const reset = state => ({ ...selectColor(state, BLACK), applyToAllSlides: true, slideBackgrounds: {} });
  const setSlide = (state, index, choice) => {
    const next = copy(state);
    if (!choice) delete next.slideBackgrounds[index];
    else if (choice === 'image' && next.uploadedBackground) next.slideBackgrounds[index] = { type: 'image', color: next.color, ...next.uploadedBackground };
    else if (/^#[0-9a-f]{6}$/i.test(choice)) next.slideBackgrounds[index] = { type: 'color', color: choice, assetId: null, previewUrl: null, textColor: choice === BLACK ? '#FFFFFF' : '#000000' };
    return next;
  };
  const previews = (state, count) => Array.from({ length: count }, (_, index) => state.applyToAllSlides ? state : (state.slideBackgrounds[index] || state));
  return { BLACK, DEFAULT, copy, selectColor, upload, activateUpload, removeUpload, reset, setSlide, previews };
});

(() => {
  if (typeof document === 'undefined') return;
  const originalField = document.querySelector('#manual-topic-field');
  const originalInput = originalField?.querySelector('#manual-topic');
  const manualRadio = document.querySelector('input[name="topic-source"][value="manual"]');
  const withoutRadio = document.querySelector('input[name="source-mode"][value="without"]');
  const withRadio = document.querySelector('input[name="source-mode"][value="with"]');
  if (!originalField || !originalInput || !manualRadio || !withoutRadio || !withRadio) return;

  const withoutLabel = withoutRadio.closest('label')?.querySelector('span');
  const legend = document.querySelector('#source-mode-wrap legend');
  const textField = document.createElement('label');
  textField.id = 'text-generate-field';
  textField.className = 'hidden';
  textField.innerHTML = 'Teks carousel siap tempel<textarea id="manual-text-input" rows="12" maxlength="20000" placeholder="Tempel copy dengan bagian HOOK, FAKTA UTAMA, DETAIL, PENUTUP, lalu CAPTION dan TAGAR bila ada. AI Ads Lab akan mengenali tiap bagian dan menaruhnya pada slot yang sesuai."></textarea><small>Label bagian hanya dipakai untuk penempatan dan tidak ikut tampil. HOOK, judul, body, bullet, PENUTUP, CAPTION, dan TAGAR dipisahkan menurut fungsinya. AI Ads Lab tidak menulis ulang, meringkas, memotong, atau menambah kalimat secara bebas; jika body sedikit terlalu panjang, sistem hanya memendekkan dari teks yang kamu tempel tanpa menambah klaim baru.</small>';
  originalField.after(textField);
  const textInput = textField.querySelector('textarea');

  const sync = () => {
    const manualMode = manualRadio.checked;
    const textMode = manualMode && withoutRadio.checked;
    if (withoutLabel) withoutLabel.textContent = manualMode ? 'Generate dari Teks' : 'Tanpa URL';
    if (legend) legend.textContent = manualMode ? 'Mode Konten' : 'Sumber URL';
    originalField.classList.toggle('hidden', textMode);
    textField.classList.toggle('hidden', !textMode);
    if (textMode) {
      originalInput.id = 'manual-topic-url';
      textInput.id = 'manual-topic';
    } else {
      textInput.id = 'manual-text-input';
      originalInput.id = 'manual-topic';
    }
  };

  document.querySelectorAll('input[name="source-mode"],input[name="topic-source"]').forEach(input => input.addEventListener('change', sync));
  sync();
})();

// TikTok PHOTO uploads use PULL_FROM_URL. Keep one pending share attached to
// the UI. If TikTok accepts the first publish but makes no pull progress for a
// sustained period, cancel that exact task first and replay the same upload at
// most once. This replaces the manual "click Upload a second time" workaround
// without risking two live publish tasks for the same carousel.
(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const FAST_POLL_WINDOW_MS = 5 * 60 * 1000;
  const URL_PULL_WINDOW_MS = 60 * 60 * 1000;
  const FAST_POLL_INTERVAL_MS = 10 * 1000;
  const SLOW_POLL_INTERVAL_MS = 30 * 1000;
  const STALL_RETRY_AFTER_MS = 90 * 1000;
  const CANCEL_CONFIRM_WINDOW_MS = 90 * 1000;
  const CANCEL_CONFIRM_INTERVAL_MS = 3 * 1000;
  const AUTO_RETRY_LIMIT = 1;
  const PENDING_STATUSES = new Set(['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD', 'CANCEL_REQUESTED']);
  const TERMINAL_STATUSES = new Set(['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE', 'FAILED', 'CANCELLED', 'CANCELED']);
  const AUTO_RETRYABLE_FAILURES = new Set(['photo_pull_failed', 'internal', 'internal_error']);
  const polling = new Set();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let activePublishId = null;
  let cancelRequestedFor = null;
  let lastUploadPayload = null;
  let automaticRetriesUsed = 0;
  let autoRecoveryFor = null;

  function controls() {
    const upload = document.querySelector('#upload');
    if (!upload) return { upload: null, cancel: null };
    let cancel = document.querySelector('#cancel-tiktok-upload');
    if (!cancel) {
      cancel = document.createElement('button');
      cancel.id = 'cancel-tiktok-upload';
      cancel.type = 'button';
      cancel.className = 'danger hidden';
      cancel.textContent = 'Batalkan upload TikTok';
      upload.after(cancel);
      cancel.onclick = requestCancel;
    }
    return { upload, cancel };
  }

  function setPending(publishId, status = 'PROCESSING_DOWNLOAD') {
    const id = String(publishId || '').trim();
    if (!id) return;
    if (activePublishId !== id) cancelRequestedFor = status === 'CANCEL_REQUESTED' ? id : null;
    activePublishId = id;
    const { upload, cancel } = controls();
    if (upload) upload.disabled = true;
    if (cancel) {
      cancel.classList.remove('hidden');
      cancel.disabled = cancelRequestedFor === id || autoRecoveryFor === id;
      cancel.textContent = autoRecoveryFor === id
        ? 'Memulihkan upload…'
        : cancelRequestedFor === id ? 'Pembatalan diminta…' : 'Batalkan upload TikTok';
    }
  }

  function clearPending(publishId) {
    const id = String(publishId || '').trim();
    if (id && activePublishId && activePublishId !== id) return;
    activePublishId = null;
    cancelRequestedFor = null;
    autoRecoveryFor = null;
    const { upload, cancel } = controls();
    if (upload) upload.disabled = false;
    if (cancel) {
      cancel.classList.add('hidden');
      cancel.disabled = false;
      cancel.textContent = 'Batalkan upload TikTok';
    }
  }

  function normalizedDownloadedBytes(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function installUploadCapture() {
    if (window.fetch.__tiktokUploadCapture) return;
    const originalFetch = window.fetch.bind(window);
    const wrappedFetch = async (input, init = {}) => {
      let url;
      try { url = new URL(typeof input === 'string' ? input : input.url, window.location.href); } catch { return originalFetch(input, init); }
      const method = String(init?.method || (typeof input !== 'string' ? input.method : 'GET') || 'GET').toUpperCase();
      if (url.pathname === '/upload-tiktok' && method === 'POST') {
        try {
          const payload = JSON.parse(String(init.body || '{}'));
          if (payload?.id) lastUploadPayload = { id: payload.id, caption: String(payload.caption || '') };
        } catch {}
      }
      return originalFetch(input, init);
    };
    wrappedFetch.__tiktokUploadCapture = true;
    try {
      window.fetch = wrappedFetch;
    } catch {
      try {
        Object.defineProperty(window, 'fetch', {
          value: wrappedFetch,
          writable: true,
          configurable: true
        });
      } catch {}
    }
  }

  async function requestCancel() {
    const publishId = activePublishId;
    if (!publishId || cancelRequestedFor === publishId || autoRecoveryFor === publishId) return;
    if (!window.confirm('Batalkan upload TikTok yang masih diproses?')) return;
    const { cancel } = controls();
    if (cancel) { cancel.disabled = true; cancel.textContent = 'Membatalkan…'; }
    try {
      const result = await api(`/cancel-tiktok/${encodeURIComponent(publishId)}`, { method: 'POST' });
      cancelRequestedFor = publishId;
      setPending(publishId, result.status || 'CANCEL_REQUESTED');
      renderPublishStatus(
        { status: result.status || 'CANCEL_REQUESTED', fail_reason: null, downloaded_bytes: null },
        'Permintaan pembatalan diterima TikTok. Upload baru tetap dikunci sampai task lama benar-benar berhenti.'
      );
      try { await history(); } catch {}
      void reliableTikTokPollDraft(publishId);
    } catch (error) {
      if (cancel) { cancel.disabled = false; cancel.textContent = 'Batalkan upload TikTok'; }
      const statusElement = document.querySelector('#status');
      if (statusElement) statusElement.textContent = `Gagal membatalkan upload TikTok: ${error.message}`;
    }
  }

  async function startAutomaticRetry(oldPublishId, reason) {
    if (!lastUploadPayload || automaticRetriesUsed >= AUTO_RETRY_LIMIT) return false;
    automaticRetriesUsed += 1;
    autoRecoveryFor = null;
    cancelRequestedFor = null;
    renderPublishStatus(
      { status: 'PROCESSING_UPLOAD', fail_reason: null, downloaded_bytes: null },
      `Percobaan pertama ${reason}. AI Ads Lab mencoba mengirim ulang satu kali secara otomatis.`
    );

    try {
      const retry = await api('/upload-tiktok', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastUploadPayload)
      });
      const nextId = String(retry?.publishId || '').trim();
      if (!nextId || nextId === oldPublishId) throw new Error('TikTok tidak memberikan publish ID baru untuk percobaan ulang.');
      setPending(nextId, retry.status || 'PROCESSING_UPLOAD');
      renderPublishStatus(retry, 'Percobaan ulang sudah dikirim ke TikTok. Menunggu draft masuk.');
      try { await history(); } catch {}
      void reliableTikTokPollDraft(nextId);
      return true;
    } catch (error) {
      clearPending(oldPublishId);
      const statusElement = document.querySelector('#status');
      if (statusElement) statusElement.textContent = `Percobaan ulang otomatis gagal: ${error.message}. Kamu bisa menekan Upload lagi.`;
      return false;
    }
  }

  async function waitForCancelledTask(publishId) {
    const deadline = Date.now() + CANCEL_CONFIRM_WINDOW_MS;
    while (Date.now() < deadline) {
      await sleep(CANCEL_CONFIRM_INTERVAL_MS);
      if (activePublishId !== publishId) return { outcome: 'superseded', data: null };
      let data;
      try {
        data = await api(`/status/${encodeURIComponent(publishId)}`);
      } catch {
        continue;
      }
      renderPublishStatus(data, 'Percobaan pertama dihentikan sebelum retry otomatis.');
      try { await history(); } catch {}
      if (data.status === 'SEND_TO_USER_INBOX' || data.status === 'PUBLISH_COMPLETE') return { outcome: 'delivered', data };
      if (data.status === 'FAILED' || data.status === 'CANCELLED' || data.status === 'CANCELED') return { outcome: 'stopped', data };
    }
    return { outcome: 'pending', data: null };
  }

  async function recoverStalledPull(publishId) {
    if (!lastUploadPayload || automaticRetriesUsed >= AUTO_RETRY_LIMIT || cancelRequestedFor === publishId || autoRecoveryFor === publishId) return false;
    autoRecoveryFor = publishId;
    setPending(publishId, 'PROCESSING_DOWNLOAD');
    renderPublishStatus(
      { status: 'PROCESSING_DOWNLOAD', fail_reason: null, downloaded_bytes: null },
      'Percobaan pertama tidak menunjukkan progres. AI Ads Lab menghentikan task itu sebelum mencoba ulang satu kali.'
    );

    try {
      const result = await api(`/cancel-tiktok/${encodeURIComponent(publishId)}`, { method: 'POST' });
      cancelRequestedFor = publishId;
      setPending(publishId, result.status || 'CANCEL_REQUESTED');
    } catch (error) {
      autoRecoveryFor = null;
      setPending(publishId, 'PROCESSING_DOWNLOAD');
      const statusElement = document.querySelector('#status');
      if (statusElement) statusElement.textContent = `TikTok belum bisa membatalkan percobaan pertama: ${error.message}. Task lama tetap dipantau agar tidak membuat draft ganda.`;
      return false;
    }

    const stopped = await waitForCancelledTask(publishId);
    if (stopped.outcome === 'delivered') {
      renderPublishStatus(stopped.data, 'Draft pertama ternyata berhasil masuk ke TikTok. Retry otomatis dibatalkan.');
      clearPending(publishId);
      return true;
    }
    if (stopped.outcome !== 'stopped') {
      autoRecoveryFor = null;
      renderPublishStatus(
        { status: 'CANCEL_REQUESTED', fail_reason: null, downloaded_bytes: null },
        'TikTok belum mengonfirmasi task pertama berhenti. Retry otomatis tidak dijalankan untuk mencegah draft ganda.'
      );
      return false;
    }

    return startAutomaticRetry(publishId, 'berhenti setelah tidak ada progres');
  }

  async function reliableTikTokPollDraft(publishId) {
    const id = String(publishId || '').trim();
    if (!id) return;
    setPending(id);
    if (polling.has(id)) return;
    polling.add(id);
    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    let lastDownloadedBytes = null;
    let firstCheck = true;
    let lastData = { status: 'PROCESSING_DOWNLOAD', fail_reason: null, downloaded_bytes: null };

    try {
      while (Date.now() - startedAt < URL_PULL_WINDOW_MS) {
        if (activePublishId !== id) return;
        if (!firstCheck) {
          const elapsed = Date.now() - startedAt;
          await sleep(elapsed < FAST_POLL_WINDOW_MS ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS);
          if (activePublishId !== id) return;
        }
        firstCheck = false;

        let data;
        try {
          data = await api(`/status/${encodeURIComponent(id)}`);
        } catch (error) {
          const statusElement = document.querySelector('#status');
          if (statusElement) statusElement.textContent = `TikTok masih memproses draft. Pemeriksaan status sementara gagal: ${error.message}`;
          continue;
        }

        lastData = data;
        renderPublishStatus(data);
        try { await history(); } catch {}

        if (data.status === 'SEND_TO_USER_INBOX') {
          renderPublishStatus(data, 'Draft berhasil dikirim. Buka Inbox TikTok untuk melanjutkan.');
          clearPending(id);
          return;
        }
        if (data.status === 'PUBLISH_COMPLETE') {
          renderPublishStatus(data, 'TikTok menyelesaikan proses draft.');
          clearPending(id);
          return;
        }
        if (data.status === 'FAILED') {
          const failReason = String(data.fail_reason || '').toLowerCase();
          if (cancelRequestedFor !== id && AUTO_RETRYABLE_FAILURES.has(failReason) && automaticRetriesUsed < AUTO_RETRY_LIMIT && lastUploadPayload) {
            if (await startAutomaticRetry(id, `gagal dengan status ${failReason}`)) return;
          }
          const reason = data.fail_reason ? `: ${data.fail_reason}` : '.';
          renderPublishStatus(data, cancelRequestedFor === id ? 'Task TikTok sudah berhenti setelah pembatalan.' : `TikTok gagal memproses draft${reason}`);
          clearPending(id);
          return;
        }
        if (data.status === 'CANCELLED' || data.status === 'CANCELED') {
          renderPublishStatus(data, 'Upload TikTok sudah dibatalkan. Kamu bisa mencoba upload lagi.');
          clearPending(id);
          return;
        }
        if (data.status === 'PROCESSING_DOWNLOAD') {
          const bytes = normalizedDownloadedBytes(data.downloaded_bytes);
          if (bytes !== null && (lastDownloadedBytes === null || bytes > lastDownloadedBytes)) {
            lastDownloadedBytes = bytes;
            lastProgressAt = Date.now();
          }
          const stalled = Date.now() - lastProgressAt >= STALL_RETRY_AFTER_MS;
          if (!cancelRequestedFor && stalled && automaticRetriesUsed < AUTO_RETRY_LIMIT && lastUploadPayload) {
            if (await recoverStalledPull(id)) return;
            lastProgressAt = Date.now();
          }
          renderPublishStatus(data, cancelRequestedFor === id
            ? 'Pembatalan sudah diminta; menunggu TikTok menghentikan task lama. Upload baru masih dikunci.'
            : 'TikTok sedang mengunduh gambar dari AI Ads Lab. Proses masih berjalan; jangan unggah ulang.');
          continue;
        }
        if (data.status === 'PROCESSING_UPLOAD') {
          renderPublishStatus(data, cancelRequestedFor === id
            ? 'Pembatalan sudah diminta; menunggu TikTok menghentikan task lama. Upload baru masih dikunci.'
            : 'TikTok masih memproses unggahan. Proses masih berjalan; jangan unggah ulang.');
          continue;
        }

        renderPublishStatus(data, 'Status TikTok diperbarui. Upload baru tetap dikunci sampai status task lama jelas.');
        return;
      }

      renderPublishStatus(lastData, cancelRequestedFor === id
        ? 'TikTok belum memberi status akhir setelah permintaan pembatalan. Jangan membuat upload baru dulu.'
        : 'TikTok belum memberi hasil akhir setelah waktu tunggu panjang. Gunakan tombol Batalkan upload TikTok sebelum mencoba lagi.');
    } finally {
      polling.delete(id);
    }
  }

  function installUploadGuard() {
    const { upload } = controls();
    if (!upload || upload.dataset.tiktokPendingGuard === 'true' || typeof upload.onclick !== 'function') return;
    const originalUpload = upload.onclick;
    upload.dataset.tiktokPendingGuard = 'true';
    upload.onclick = async function guardedTikTokUpload(event) {
      if (this.dataset.tiktokSubmitting === 'true' || activePublishId) return;
      automaticRetriesUsed = 0;
      lastUploadPayload = null;
      autoRecoveryFor = null;
      this.dataset.tiktokSubmitting = 'true';
      this.disabled = true;
      try {
        return await originalUpload.call(this, event);
      } finally {
        this.dataset.tiktokSubmitting = '';
        if (!activePublishId) this.disabled = false;
      }
    };
  }

  function installShowSync() {
    if (typeof globalThis.show !== 'function' || globalThis.show.__tiktokPendingSync) return;
    const originalShow = globalThis.show;
    const wrappedShow = function tiktokPendingAwareShow(item) {
      const result = originalShow(item);
      const status = String(item?.publish_status || '').toUpperCase();
      if (item?.publish_id && PENDING_STATUSES.has(status)) {
        setPending(item.publish_id, status);
        void reliableTikTokPollDraft(item.publish_id);
      } else if (item?.publish_id && TERMINAL_STATUSES.has(status)) {
        clearPending(item.publish_id);
      } else if (!polling.size) {
        clearPending();
      }
      return result;
    };
    wrappedShow.__tiktokPendingSync = true;
    globalThis.show = wrappedShow;
  }

  function resumeVisiblePending() {
    if (document.visibilityState === 'hidden' || !activePublishId) return;
    void reliableTikTokPollDraft(activePublishId);
  }

  installUploadCapture();
  window.addEventListener('load', () => {
    controls();
    installUploadGuard();
    installShowSync();
    if (typeof globalThis.pollDraft === 'function') globalThis.pollDraft = reliableTikTokPollDraft;
    resumeVisiblePending();
  });
  window.addEventListener('focus', resumeVisiblePending);
  document.addEventListener('visibilitychange', resumeVisiblePending);
})();

if (typeof window !== 'undefined') import('/legacy-carousel-addon.js').catch(error => console.error('Legacy carousel addon gagal dimuat:', error));
if (typeof window !== 'undefined') import('/text-input-paste-normalizer.js').catch(error => console.error('Text input paste normalizer gagal dimuat:', error));
