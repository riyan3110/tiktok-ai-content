const STATUS_LABELS = Object.freeze({
  PROCESSING_UPLOAD: 'Mengirim draft ke TikTok…',
  PROCESSING_DOWNLOAD: 'TikTok sedang memproses draft…',
  CANCEL_REQUESTED: 'Membatalkan upload TikTok…',
  SEND_TO_USER_INBOX: 'Draft sudah masuk ke TikTok ✅',
  PUBLISH_COMPLETE: 'Proses TikTok selesai ✅',
  CANCELLED: 'Upload TikTok dibatalkan.',
  CANCELED: 'Upload TikTok dibatalkan.'
});

const PRIORITY_NAV_HREFS = Object.freeze([
  '#studio',
  '#trend-reference',
  '#schedule-dashboard',
  '#history-section'
]);

function compactStatus(data = {}) {
  const status = String(data.status || '').toUpperCase();
  if (status === 'FAILED') return String(data.fail_reason || '').toLowerCase() === 'publish_cancelled'
    ? 'Upload TikTok dibatalkan.'
    : 'Upload TikTok gagal.';
  return STATUS_LABELS[status] || (status ? `Status TikTok: ${status}` : '');
}

function technicalStatus(data = {}) {
  return [
    `Status: ${data.status || '-'}`,
    `Fail reason: ${data.fail_reason || '-'}`,
    `Downloaded bytes: ${data.downloaded_bytes ?? '-'}`
  ].join(' • ');
}

function compactDirectMessage(value) {
  const text = String(value || '').trim();
  if (/^TikTok sedang mengunduh gambar dari AI Ads Lab/i.test(text)) return STATUS_LABELS.PROCESSING_DOWNLOAD;
  if (/^TikTok masih memproses unggahan/i.test(text)) return STATUS_LABELS.PROCESSING_UPLOAD;
  if (/^TikTok masih memproses draft\. Pemeriksaan status sementara gagal/i.test(text)) return 'Status TikTok sementara belum bisa diperiksa.';
  if (/^(Permintaan pembatalan|Pembatalan sudah diminta)/i.test(text)) return STATUS_LABELS.CANCEL_REQUESTED;
  if (/^Draft berhasil dikirim/i.test(text)) return STATUS_LABELS.SEND_TO_USER_INBOX;
  if (/^TikTok menyelesaikan proses draft/i.test(text)) return STATUS_LABELS.PUBLISH_COMPLETE;
  if (/^(Task TikTok sudah berhenti setelah pembatalan|Upload TikTok sudah dibatalkan)/i.test(text)) return STATUS_LABELS.CANCELLED;
  if (/^TikTok gagal memproses draft/i.test(text)) return 'Upload TikTok gagal.';
  if (/^TikTok belum memberi (status|hasil) akhir/i.test(text)) return STATUS_LABELS.PROCESSING_DOWNLOAD;
  return text;
}

function installUiLayoutPolish() {
  const textHelper = document.querySelector('#text-generate-field > small');
  if (textHelper) {
    textHelper.hidden = true;
    textHelper.setAttribute('aria-hidden', 'true');
  }

  const nav = document.querySelector('.side-nav');
  if (!nav || nav.dataset.priorityItemsMoved === 'true') return;
  const priorityLinks = PRIORITY_NAV_HREFS.map(href => nav.querySelector(`a[href="${href}"]`));
  if (priorityLinks.some(link => !link)) return;

  const divider = priorityLinks[0].previousElementSibling;
  const fragment = document.createDocumentFragment();
  priorityLinks.forEach(link => fragment.append(link));
  if (divider?.classList.contains('nav-divider')) fragment.append(divider);
  nav.prepend(fragment);
  nav.dataset.priorityItemsMoved = 'true';
}

function installCompactTikTokStatus() {
  const statusNode = document.querySelector('#status');
  if (!statusNode) return;

  window.renderPublishStatus = data => {
    statusNode.textContent = compactStatus(data);
    statusNode.title = technicalStatus(data);
    statusNode.dataset.tiktokStatus = String(data?.status || '');
  };

  if (typeof window.show === 'function' && !window.show.__compactTikTokStatus) {
    const originalShow = window.show;
    const wrappedShow = function compactStatusShow(item) {
      const result = originalShow(item);
      if (item?.publish_status) {
        statusNode.textContent = compactStatus({ status: item.publish_status, fail_reason: item.fail_reason, downloaded_bytes: item.downloaded_bytes });
        statusNode.title = technicalStatus({ status: item.publish_status, fail_reason: item.fail_reason, downloaded_bytes: item.downloaded_bytes });
        statusNode.dataset.tiktokStatus = String(item.publish_status || '');
      }
      return result;
    };
    wrappedShow.__compactTikTokStatus = true;
    window.show = wrappedShow;
  }

  const observer = new MutationObserver(() => {
    const compact = compactDirectMessage(statusNode.textContent);
    if (compact && compact !== statusNode.textContent) statusNode.textContent = compact;
  });
  observer.observe(statusNode, { childList: true, characterData: true, subtree: true });
}

function installNativeShareUi() {
  const uploadButton = document.querySelector('#upload');
  const slidesHost = document.querySelector('#slides');
  const captionInput = document.querySelector('#caption');
  if (!uploadButton || !slidesHost || !captionInput || document.querySelector('#share-carousel')) return;

  const shareButton = document.createElement('button');
  shareButton.id = 'share-carousel';
  shareButton.type = 'button';
  shareButton.className = 'outline';
  shareButton.textContent = 'Bagikan + salin caption';
  shareButton.disabled = true;
  shareButton.style.width = '100%';
  shareButton.style.marginBottom = '10px';

  const shareStatus = document.createElement('p');
  shareStatus.id = 'share-carousel-status';
  shareStatus.setAttribute('role', 'status');
  shareStatus.style.marginTop = '0';

  uploadButton.before(shareButton, shareStatus);

  let preparedFiles = [];
  let preparationVersion = 0;
  let latestHashtags = [];

  function normalizeHashtag(value) {
    const clean = String(value || '').trim().replace(/^#+/, '').replace(/\s+/g, '');
    return clean ? `#${clean}` : '';
  }

  function buildShareText() {
    const caption = captionInput.value.trim();
    const existingTags = new Set((caption.match(/#[^\s#]+/g) || []).map(tag => tag.toLocaleLowerCase('id-ID')));
    const seen = new Set();
    const hashtags = latestHashtags.map(normalizeHashtag).filter(tag => {
      const key = tag.toLocaleLowerCase('id-ID');
      if (!tag || existingTags.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return [caption, hashtags.join(' ')].filter(Boolean).join('\n\n');
  }

  if (typeof window.show === 'function' && !window.show.__shareHashtags) {
    const originalShow = window.show;
    const wrappedShow = function shareHashtagsShow(item) {
      latestHashtags = Array.isArray(item?.hashtags) ? item.hashtags : [];
      return originalShow(item);
    };
    wrappedShow.__shareHashtags = true;
    window.show = wrappedShow;
  }

  function legacyClipboardCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.append(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    textarea.remove();
    return copied;
  }

  function copyCaptionToClipboard(text) {
    const value = String(text || '').trim();
    if (!value) return Promise.resolve(false);
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(value).then(() => true).catch(() => false);
    }
    return Promise.resolve(legacyClipboardCopy(value));
  }

  async function prepareShareFiles() {
    const version = ++preparationVersion;
    const sources = [...slidesHost.querySelectorAll('img')]
      .map(image => image.getAttribute('src') || image.src)
      .filter(Boolean);

    preparedFiles = [];
    shareStatus.textContent = '';
    shareButton.disabled = true;
    shareButton.textContent = sources.length ? 'Menyiapkan bagikan…' : 'Bagikan + salin caption';

    if (!sources.length) return;
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || typeof File !== 'function') {
      shareButton.textContent = 'Bagikan tidak didukung';
      shareStatus.textContent = 'Browser atau perangkat ini belum mendukung berbagi beberapa file.';
      return;
    }

    try {
      const files = await Promise.all(sources.map(async (source, index) => {
        const response = await fetch(source, { cache: 'no-store' });
        if (!response.ok) throw new Error(`slide ${index + 1} tidak dapat dibaca`);
        const blob = await response.blob();
        const type = String(blob.type || '').startsWith('image/') ? blob.type : 'image/jpeg';
        const extension = type.includes('png') ? 'png' : 'jpg';
        return new File([blob], `ai-ads-lab-slide-${index + 1}.${extension}`, { type });
      }));

      if (version !== preparationVersion) return;
      if (!navigator.canShare({ files })) throw new Error('perangkat tidak mendukung berbagi beberapa gambar sekaligus');

      preparedFiles = files;
      shareButton.disabled = false;
      shareButton.textContent = 'Bagikan + salin caption';
    } catch (error) {
      if (version !== preparationVersion) return;
      shareButton.disabled = true;
      shareButton.textContent = 'Bagikan tidak tersedia';
      shareStatus.textContent = `Gambar belum bisa dibagikan: ${error.message}`;
    }
  }

  shareButton.onclick = async () => {
    if (!preparedFiles.length) return;
    const shareText = buildShareText();
    const clipboardResult = copyCaptionToClipboard(shareText);
    try {
      await navigator.share({
        title: 'AI Ads Lab',
        text: shareText,
        files: preparedFiles
      });
      const copied = await clipboardResult;
      shareStatus.textContent = copied
        ? 'Konten dibagikan. Caption + tagar sudah disalin—tinggal Tempel di aplikasi tujuan.'
        : 'Konten dibagikan. Jika caption tidak ikut, salin teks dari kolom Caption secara manual.';
    } catch (error) {
      const copied = await clipboardResult;
      if (error?.name === 'AbortError') {
        shareStatus.textContent = copied ? 'Bagikan dibatalkan. Caption + tagar tetap sudah disalin.' : '';
        return;
      }
      shareStatus.textContent = copied
        ? `Menu bagikan gagal dibuka: ${error.message}. Caption + tagar sudah disalin.`
        : `Gagal membuka menu bagikan: ${error.message}`;
    }
  };

  const observer = new MutationObserver(() => { void prepareShareFiles(); });
  observer.observe(slidesHost, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  void prepareShareFiles();
}

function installInsertedImageUi() {
  const selectButton = document.querySelector('#studio-select-assets');
  const host = document.querySelector('#studio-assets');
  const attachment = selectButton?.closest('.asset-attachment');
  if (!selectButton || !host || !attachment || !window.AssetManager?.select) return;

  let insertedAsset = null;
  const heading = attachment.querySelector('b');
  const helper = attachment.querySelector('small');
  if (heading) heading.textContent = 'Sisipkan gambar';
  if (helper) helper.textContent = 'Opsional — gambar hanya tampil di slide 1, di bawah Hook.';
  selectButton.textContent = '□ Pilih gambar';

  let dialog = document.querySelector('#inserted-image-source-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'inserted-image-source-dialog';
    dialog.className = 'project-dialog';
    dialog.setAttribute('aria-labelledby', 'inserted-image-source-title');
    dialog.innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">SISIPKAN GAMBAR</span><h2 id="inserted-image-source-title">Pilih Sumber Gambar</h2></div><button id="inserted-image-source-close" class="icon-button" type="button" aria-label="Tutup">✕</button></div><p style="margin:0 0 16px;color:var(--muted);font-size:.85rem">Pilih gambar untuk disisipkan pada slide 1 di bawah Hook.</p><div style="display:grid;gap:10px"><button id="choose-from-assets-btn" type="button" class="outline" style="display:flex;align-items:center;gap:12px;padding:14px;text-align:left;border-radius:12px;cursor:pointer;width:100%"><span style="font-size:1.4rem;line-height:1">📁</span><div style="display:grid;gap:2px"><b style="font-size:.92rem;color:var(--text)">Pilih dari Asset</b><small style="color:var(--muted);font-size:.75rem">Pilih satu gambar dari library Assets yang tersimpan</small></div></button><button id="upload-from-device-btn" type="button" class="outline" style="display:flex;align-items:center;gap:12px;padding:14px;text-align:left;border-radius:12px;cursor:pointer;width:100%"><span style="font-size:1.4rem;line-height:1">📱</span><div style="display:grid;gap:2px"><b style="font-size:.92rem;color:var(--text)">Unggah dari perangkat</b><small style="color:var(--muted);font-size:.75rem">Pilih file gambar langsung dari HP atau komputer</small></div></button></div><div class="dialog-actions" style="margin-top:16px;display:flex;justify-content:flex-end"><button id="cancel-source-choice-btn" type="button" class="outline">Batal</button></div>`;
    document.body.appendChild(dialog);
  }

  let fileInput = document.querySelector('#inserted-image-file-input');
  if (!fileInput) {
    fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'inserted-image-file-input';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
  }

  const closeDialog = () => {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  };

  const openSourceDialog = () => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };

  dialog.querySelector('#inserted-image-source-close').onclick = closeDialog;
  dialog.querySelector('#cancel-source-choice-btn').onclick = closeDialog;
  dialog.onclick = (event) => {
    if (event.target === dialog) closeDialog();
  };

  const safe = value => {
    const node = document.createElement('span');
    node.textContent = value || '';
    return node.innerHTML;
  };

  const render = () => {
    if (!insertedAsset) {
      host.innerHTML = '<small>Belum ada gambar disisipkan</small>';
      return;
    }
    const previewSrc = insertedAsset.previewUrl || insertedAsset.preview_url || `/api/assets/${encodeURIComponent(insertedAsset.id)}/preview`;
    host.innerHTML = `<div class="inserted-image-preview" style="display:flex;align-items:center;gap:12px;padding:8px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-top:6px;width:100%;box-sizing:border-box"><div style="width:48px;height:48px;min-width:48px;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:#0a0a0c;display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${safe(previewSrc)}" alt="Thumbnail" style="width:100%;height:100%;object-fit:cover;display:block"></div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><button type="button" id="change-inserted-image-btn" class="outline" style="padding:6px 12px;font-size:.82rem;min-height:32px">Ganti</button><button type="button" id="remove-inserted-image-btn" class="outline danger-text" style="padding:6px 12px;font-size:.82rem;min-height:32px">Hapus</button></div></div>`;
    const removeHandler = () => { insertedAsset = null; render(); };
    const removeBtn = host.querySelector('#remove-inserted-image-btn');
    if (removeBtn) removeBtn.onclick = removeHandler;
    const changeBtn = host.querySelector('#change-inserted-image-btn');
    if (changeBtn) changeBtn.onclick = () => openSourceDialog();
  };

  dialog.querySelector('#choose-from-assets-btn').onclick = async () => {
    closeDialog();
    const chosen = await window.AssetManager.select({
      selectedIds: insertedAsset ? [insertedAsset.id] : [],
      multiple: false
    });
    if (!chosen) return;
    const asset = chosen[0] || null;
    if (asset && asset.type !== 'image') {
      const message = document.querySelector('#message');
      if (message) message.textContent = 'Pilih asset berupa gambar.';
      return;
    }
    insertedAsset = asset ? {
      id: asset.id,
      name: asset.name,
      previewUrl: asset.previewUrl || asset.preview_url || `/api/assets/${encodeURIComponent(asset.id)}/preview`,
      type: 'image'
    } : null;
    render();
  };

  dialog.querySelector('#upload-from-device-btn').onclick = () => {
    closeDialog();
    fileInput.click();
  };

  fileInput.onchange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      const message = document.querySelector('#message');
      if (message) message.textContent = 'Hanya file gambar yang didukung (JPG, PNG, WebP, dll).';
      fileInput.value = '';
      return;
    }
    host.innerHTML = '<span class="spinner" style="display:inline-block;vertical-align:middle;margin-right:6px"></span><small>Mengunggah gambar dari perangkat…</small>';
    try {
      const reader = new FileReader();
      const base64Data = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/assets/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          mimeType: file.type || 'image/jpeg',
          data: base64Data,
          tags: ['Other', 'InsertedImage'],
          metadata: { category: 'Other' }
        })
      });
      const uploaded = await res.json().catch(() => ({}));
      if (!res.ok || !uploaded?.id) {
        throw new Error(uploaded?.error || 'Gagal mengunggah file.');
      }
      insertedAsset = {
        id: uploaded.id,
        name: uploaded.name,
        previewUrl: uploaded.preview_url || `/api/assets/${encodeURIComponent(uploaded.id)}/preview`,
        type: 'image'
      };
    } catch (err) {
      const message = document.querySelector('#message');
      if (message) message.textContent = `Gagal mengunggah gambar: ${err.message}`;
    } finally {
      fileInput.value = '';
      render();
    }
  };

  selectButton.onclick = () => {
    openSourceDialog();
  };
  render();

  const originalFetch = window.fetch.bind(window);
  if (window.fetch.__insertedImageAware) return;
  const wrappedFetch = async (input, init = {}) => {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, window.location.href); } catch { return originalFetch(input, init); }
    const method = String(init?.method || (typeof input !== 'string' ? input.method : 'GET') || 'GET').toUpperCase();
    if (url.pathname !== '/generate' || method !== 'POST') return originalFetch(input, init);

    let nextInit = init;
    try {
      const body = JSON.parse(String(init.body || '{}'));
      delete body.assetIds;
      nextInit = { ...init, body: JSON.stringify(body) };
    } catch {}

    const response = await originalFetch(input, nextInit);
    if (!response.ok || !insertedAsset) return response;

    let generated;
    try { generated = await response.clone().json(); } catch { return response; }
    if (!generated?.id) return response;

    const applied = await originalFetch(`/contents/${encodeURIComponent(generated.id)}/insert-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: insertedAsset.id })
    });
    if (!applied.ok) {
      const errorBody = await applied.json().catch(() => ({}));
      setTimeout(() => {
        const message = document.querySelector('#message');
        if (message) message.textContent = `Konten selesai, tetapi gambar gagal disisipkan: ${errorBody.error || 'permintaan gagal'}`;
      }, 300);
      return response;
    }

    const decorated = await applied.json();
    return new Response(JSON.stringify(decorated), {
      status: response.status,
      statusText: response.statusText,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  wrappedFetch.__insertedImageAware = true;
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

function install() {
  if (window.__legacyCarouselAddonInstalled) return;
  if (!document.querySelector('#studio-select-assets') || typeof window.show !== 'function') {
    setTimeout(install, 50);
    return;
  }
  window.__legacyCarouselAddonInstalled = true;
  installUiLayoutPolish();
  installInsertedImageUi();
  installCompactTikTokStatus();
  installNativeShareUi();
}

if (document.readyState === 'complete') install();
else window.addEventListener('load', install, { once: true });