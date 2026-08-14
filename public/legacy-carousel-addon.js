const STATUS_LABELS = Object.freeze({
  PROCESSING_UPLOAD: 'Mengirim draft ke TikTok…',
  PROCESSING_DOWNLOAD: 'TikTok sedang memproses draft…',
  CANCEL_REQUESTED: 'Membatalkan upload TikTok…',
  SEND_TO_USER_INBOX: 'Draft sudah masuk ke TikTok ✅',
  PUBLISH_COMPLETE: 'Proses TikTok selesai ✅',
  CANCELLED: 'Upload TikTok dibatalkan.',
  CANCELED: 'Upload TikTok dibatalkan.'
});

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
    host.innerHTML = `<span class="selected-asset"><img src="${safe(insertedAsset.previewUrl)}" alt=""><b>${safe(insertedAsset.name)}</b><button type="button" data-remove-inserted-image>×</button></span>`;
    host.querySelector('[data-remove-inserted-image]').onclick = () => { insertedAsset = null; render(); };
  };

  selectButton.onclick = async () => {
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
    insertedAsset = asset;
    render();
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
  window.fetch = wrappedFetch;
}

function install() {
  if (window.__legacyCarouselAddonInstalled) return;
  if (!document.querySelector('#studio-select-assets') || typeof window.show !== 'function') {
    setTimeout(install, 50);
    return;
  }
  window.__legacyCarouselAddonInstalled = true;
  installInsertedImageUi();
  installCompactTikTokStatus();
}

if (document.readyState === 'complete') install();
else window.addEventListener('load', install, { once: true });

export { compactStatus };
