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

// TikTok PHOTO uploads use PULL_FROM_URL. Keep a single pending share attached
// to the UI, expose TikTok's official cancel operation, and do not let repeated
// taps create more publish IDs while the previous task is still pending.
(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const FAST_POLL_WINDOW_MS = 5 * 60 * 1000;
  const URL_PULL_WINDOW_MS = 60 * 60 * 1000;
  const FAST_POLL_INTERVAL_MS = 10 * 1000;
  const SLOW_POLL_INTERVAL_MS = 30 * 1000;
  const PENDING_STATUSES = new Set(['PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD', 'CANCEL_REQUESTED']);
  const TERMINAL_STATUSES = new Set(['SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE', 'FAILED', 'CANCELLED', 'CANCELED']);
  const polling = new Set();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let activePublishId = null;
  let cancelRequestedFor = null;

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
      cancel.disabled = cancelRequestedFor === id;
      cancel.textContent = cancelRequestedFor === id ? 'Pembatalan diminta…' : 'Batalkan upload TikTok';
    }
  }

  function clearPending(publishId) {
    const id = String(publishId || '').trim();
    if (id && activePublishId && activePublishId !== id) return;
    activePublishId = null;
    cancelRequestedFor = null;
    const { upload, cancel } = controls();
    if (upload) upload.disabled = false;
    if (cancel) {
      cancel.classList.add('hidden');
      cancel.disabled = false;
      cancel.textContent = 'Batalkan upload TikTok';
    }
  }

  async function requestCancel() {
    const publishId = activePublishId;
    if (!publishId || cancelRequestedFor === publishId) return;
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

  async function reliableTikTokPollDraft(publishId) {
    const id = String(publishId || '').trim();
    if (!id) return;
    setPending(id);
    if (polling.has(id)) return;
    polling.add(id);
    const startedAt = Date.now();
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
