const root = document.documentElement;
const savedTheme = localStorage.getItem('ai-ads-lab-theme');
root.dataset.theme = savedTheme === 'light' ? 'light' : 'dark';
const themeToggle = document.querySelector('#theme-toggle');
const syncThemeButton = () => {
  const light = root.dataset.theme === 'light';
  themeToggle.innerHTML = `<span aria-hidden="true">${light ? '☾' : '☀'}</span>`;
  themeToggle.setAttribute('aria-label', light ? 'Gunakan tema gelap' : 'Gunakan tema terang');
};
themeToggle.onclick = () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('ai-ads-lab-theme', root.dataset.theme);
  syncThemeButton();
};
syncThemeButton();
const sidebar = document.querySelector('#sidebar');
const menuToggle = document.querySelector('#menu-toggle');
const backdrop = document.querySelector('#mobile-backdrop');
const drawerMedia = window.matchMedia('(max-width: 1023px)');
const drawerStorageKey = 'ai-ads-lab-drawer-open';
function setMenu(open, remember = true) {
  const shouldOpen = Boolean(open && drawerMedia.matches);
  sidebar.classList.toggle('open', shouldOpen);
  backdrop.classList.toggle('open', shouldOpen);
  backdrop.setAttribute('aria-hidden', String(!shouldOpen));
  menuToggle.setAttribute('aria-expanded', String(shouldOpen));
  document.body.classList.toggle('drawer-open', shouldOpen);
  if (remember) localStorage.setItem(drawerStorageKey, String(shouldOpen));
}
function closeMenu() { setMenu(false); }
menuToggle.onclick = () => setMenu(!sidebar.classList.contains('open'));
backdrop.onclick = closeMenu;
document.addEventListener('keydown', event => { if (event.key === 'Escape' && sidebar.classList.contains('open')) { closeMenu(); menuToggle.focus(); } });
drawerMedia.addEventListener('change', event => setMenu(event.matches && localStorage.getItem(drawerStorageKey) === 'true', false));
let drawerTouchStart;
document.addEventListener('touchstart', event => {
  const touch = event.changedTouches[0];
  if (sidebar.classList.contains('open') || touch.clientX <= 24) drawerTouchStart = { x: touch.clientX, y: touch.clientY };
}, { passive: true });
document.addEventListener('touchend', event => {
  if (!drawerTouchStart || !drawerMedia.matches) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - drawerTouchStart.x;
  const dy = Math.abs(touch.clientY - drawerTouchStart.y);
  if (dy < 70 && dx < -60) closeMenu();
  else if (dy < 70 && dx > 70 && drawerTouchStart.x <= 24) setMenu(true);
  drawerTouchStart = undefined;
}, { passive: true });
setMenu(drawerMedia.matches && localStorage.getItem(drawerStorageKey) === 'true', false);
document.querySelectorAll('.side-nav a').forEach(link => link.onclick = () => { document.querySelectorAll('.side-nav a').forEach(item => item.classList.remove('active')); link.classList.add('active'); closeMenu(); });
const loadingState = label => `<div class="loading-state"><span class="spinner" aria-hidden="true"></span><p>${label}</p></div>`;
const emptyState = (title, detail) => `<div class="empty-state"><span class="state-icon" aria-hidden="true">✦</span><strong>${title}</strong><p>${detail}</p></div>`;
const errorState = message => `<div class="error-state"><span class="state-icon" aria-hidden="true">!</span><strong>Data gagal dimuat</strong><p>${escapeHtml(message)}</p></div>`;

document.querySelector('#history').innerHTML = loadingState('Memuat riwayat…');
let current;
const $ = (s) => document.querySelector(s);
async function api(url, options) {
  const r = await fetch(url, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Permintaan gagal (${r.status})`);
  return data;
}
const sourceLabels = { manual: 'Manual', ai: 'AI', trending: 'Trending' };
const trendReference = $('#trend-reference');
const trendDetails = $('#trend-details');
let activeTrend;
function jakartaInput(date = new Date()) { const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }).format(date); return parts.replace(' ', 'T'); }
function trendTime(value) { return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(value)).replace('.', ':'); }
function renderTrend(item) {
  activeTrend = item;
  const usable = Boolean(item?.usable);
  if ($('#use-trend-reference')) { $('#use-trend-reference').disabled = !usable; $('#use-trend-reference').checked = usable; }
  if ($('#generation-trend-status')) $('#generation-trend-status').textContent = usable ? `Aktif — diperbarui hari ini pukul ${trendTime(item.updated_at)} WIB` : 'Tidak aktif';
  if ($('#trend-state')) { $('#trend-state').classList.toggle('hidden', !item); if (item) $('#trend-state').textContent = item.status; }
  if ($('#trend-status')) $('#trend-status').textContent = item ? `${item.keywords.length} keyword · ${item.trend_hooks.length} gaya hook · ${item.trend_content_patterns.length} pola konten ${usable ? 'aktif' : 'tersimpan'} · ${item.source} · ${item.region} · diperbarui ${trendTime(item.updated_at)} WIB` : 'Belum ada referensi tren.';
  if ($('#disable-trends')) $('#disable-trends').classList.toggle('hidden', !item || !item.is_active);
  if ($('#delete-trends')) $('#delete-trends').classList.toggle('hidden', !item);
  if ($('#save-trends')) $('#save-trends').textContent = item ? 'Perbarui referensi' : 'Simpan referensi hari ini';
  if (item && $('#trend-keywords')) { $('#trend-keywords').value = (item.keyword_categories || []).reduce((text, entry, index, values) => `${text}${index === 0 || values[index - 1].category !== entry.category ? `${index ? '\n\n' : ''}[${entry.category}]\n` : ''}${entry.keyword}\n`, '').trim(); $('#trend-hooks').value = item.trend_hooks.join('\n'); document.querySelectorAll('.trend-pattern-options input').forEach(input => { input.checked = item.trend_content_patterns.includes(input.value); }); $('#trend-source').value = item.source; $('#trend-region').value = item.region; $('#trend-intensity').value = item.intensity; $('#trend-notes').value = item.notes || ''; }
}
async function loadTrend() { renderTrend(await api('/trend-references/current')); }
if ($('#edit-trends')) $('#edit-trends').onclick = () => { const opening = trendDetails?.classList.contains('hidden'); trendDetails?.classList.toggle('hidden', !opening); $('#edit-trends').textContent = opening ? 'Tutup' : 'Edit'; $('#edit-trends').setAttribute('aria-expanded', String(opening)); };
if ($('#save-trends')) $('#save-trends').onclick = async () => { try { $('#trend-message').textContent = 'Menyimpan…'; const body = { keywords: $('#trend-keywords').value, trend_hooks: $('#trend-hooks').value, trend_content_patterns: [...document.querySelectorAll('.trend-pattern-options input:checked')].map(input => input.value), source: $('#trend-source').value, region: $('#trend-region').value, fetchedAt: new Date($('#trend-fetched-at').value + ':00+07:00').toISOString(), intensity: $('#trend-intensity').value, validity: $('#trend-validity').value, notes: $('#trend-notes').value }; const item = await api(activeTrend ? `/trend-references/${activeTrend.id}` : '/trend-references', { method: activeTrend ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }); renderTrend(item); $('#trend-message').textContent = 'Referensi tersimpan.'; } catch(e) { $('#trend-message').textContent = e.message; } };
if ($('#disable-trends')) $('#disable-trends').onclick = async () => { if (activeTrend) renderTrend(await api(`/trend-references/${activeTrend.id}/disable`, { method: 'POST' })); };
if ($('#delete-trends')) $('#delete-trends').onclick = async () => { if (activeTrend && window.confirm('Hapus referensi tren hari ini?')) { await api(`/trend-references/${activeTrend.id}`, { method: 'DELETE' }); renderTrend(null); } };
if ($('#trend-fetched-at')) $('#trend-fetched-at').value = jakartaInput();
function show(item) {
  current = item;
  if (item.background?.type) { carouselBackground = BackgroundState.copy(item.background); localStorage.setItem(BACKGROUND_DRAFT_KEY, JSON.stringify(carouselBackground)); renderBackgroundSelector(); }
  $('#editor').classList.remove('hidden');
  $('#slides').innerHTML = item.slides.map((x, i) => `<button class="slide-button" type="button" data-slide="${i}" aria-label="Perbesar slide ${i + 1}"><img src="${x}" alt="Slide ${i + 1}"><span class="slide-background-preview" aria-hidden="true"></span></button>`).join('');
  document.querySelectorAll('[data-slide]').forEach((button, i) => { button.onclick = () => openSlide(current.slides[i], i); });
  $('#caption').value = item.caption;
  renderSourcePreview(item);
  $('#trend-reference-used').textContent = `Topik dan hashtag yang digunakan: ${item.trend_keywords_used.length ? item.trend_keywords_used.join(', ') : 'tidak ada keyword relevan'}`;
  $('#status').textContent = item.publish_status; renderSlideBackgrounds(); applyBackgroundPreview();
}
function openSlide(src, index) {
  $('#slide-preview-image').src = src;
  $('#slide-preview-image').alt = `Slide ${index + 1}`;
  $('#slide-preview-label').textContent = `Slide ${index + 1}`;
  $('#slide-preview').showModal();
}
$('#close-preview').onclick = () => $('#slide-preview').close();
$('#slide-preview').onclick = event => { if (event.target === $('#slide-preview')) $('#slide-preview').close(); };
async function history() {
  const rows = await api('/history');
  $('#delete-all').classList.toggle('hidden', !rows.length);
  $('#history').innerHTML = rows.length ? rows.map(x => `<article class="history-item" data-id="${x.id}"><div class="history-content"><b>${escapeHtml(x.topic)}</b><p>${escapeHtml(x.caption)}</p><span class="badge source-${escapeHtml(x.topic_source)}">${sourceLabels[x.topic_source] || 'AI'}</span> <span class="badge">${escapeHtml(x.content_category)}</span> <span class="badge">${escapeHtml(x.content_format)}</span> <span class="badge">${escapeHtml(x.publish_status)}</span>${x.trend_reference_id ? ` <span class="badge trend-badge">Tren Manual</span> ${x.trend_keywords_used.map(k => `<span class="badge">${escapeHtml(k)}</span>`).join('')} <small>Referensi ${new Date(x.created_at).toLocaleDateString('id-ID')}</small>` : ''}</div><button class="delete-item danger" aria-label="Hapus ${escapeHtml(x.topic)}">🗑 Hapus</button></article>`).join('') : emptyState('Belum ada konten', 'Konten yang Anda buat akan tersimpan dan tampil di sini.');
  document.querySelectorAll('.history-content').forEach((el, i) => { el.onclick = () => show(rows[i]); });
  document.querySelectorAll('.delete-item').forEach((button, i) => { button.onclick = async () => {
    if (!window.confirm('Hapus konten ini beserta seluruh gambar slide-nya?')) return;
    try {
      const result = await api(`/history/${rows[i].id}`, { method: 'DELETE' });
      if (current?.id === rows[i].id) { current = undefined; $('#editor').classList.add('hidden'); }
      await history();
      $('#message').textContent = result.tiktokWarning ? 'Konten berhasil dihapus. Proses TikTok yang sudah dikirim tidak bisa dibatalkan dari aplikasi.' : 'Konten berhasil dihapus.';
    } catch (error) { $('#message').textContent = error.message; }
  }; });
}
function escapeHtml(x) { const d = document.createElement('div'); d.textContent = x; return d.innerHTML; }
class TikTokConnection {
  constructor(element) {
    this.element = element;
    this.status = element.querySelector('[data-tiktok-status]');
    this.disconnectButton = element.querySelector('[data-tiktok-disconnect]');
    this.toast = $('#tiktok-toast');
    this.toastTimer = null;
    this.disconnectButton.onclick = () => this.disconnect();
    this.toast.querySelector('button').onclick = () => this.hideToast();
    element.querySelectorAll('[data-tiktok-connect],[data-tiktok-reconnect]').forEach(link => link.onclick = () => this.render('connecting'));
  }
  render(state, account) {
    this.element.dataset.state = state;
    this.status.textContent = state === 'connected' ? 'TikTok Connected' : state === 'connecting' ? 'Menghubungkan TikTok…' : state === 'error' ? 'TikTok Error' : state === 'loading' ? 'Memuat TikTok…' : 'TikTok Disconnected';
    this.status.title = account?.displayName || '';
  }
  async refresh() {
    this.render('loading');
    try {
      const result = await api('/api/tiktok/status', { cache: 'no-store' });
      this.render(result.connected ? 'connected' : 'disconnected', result.account);
      return result;
    } catch (error) {
      this.render('error');
      this.showToast(`Gagal menghubungkan TikTok: ${error.message}`, 'error');
      throw error;
    }
  }
  async disconnect() {
    this.disconnectButton.disabled = true;
    try {
      await api('/api/tiktok/connection', { method: 'DELETE' });
      await this.refresh();
      this.showToast('TikTok telah diputuskan', 'info');
    } catch (error) {
      this.render('error');
      this.showToast(`Gagal menghubungkan TikTok: ${error.message}`, 'error');
    } finally { this.disconnectButton.disabled = false; }
  }
  showToast(message, type) {
    clearTimeout(this.toastTimer);
    this.toast.querySelector('span').textContent = message;
    this.toast.dataset.type = type;
    this.toast.classList.add('show');
    this.toastTimer = setTimeout(() => this.hideToast(), 4500);
  }
  hideToast() { this.toast.classList.remove('show'); }
}
const tiktokConnection = new TikTokConnection($('#tiktok-connection'));
const tiktokLayout = window.matchMedia('(max-width: 1023px)');
function placeTikTokConnection() {
  const target = tiktokLayout.matches ? sidebar : $('.topbar-actions');
  if (tiktokLayout.matches) sidebar.querySelector('.sidebar-brand').after(tiktokConnection.element);
  else target.append(tiktokConnection.element);
}
tiktokLayout.addEventListener('change', placeTikTokConnection);
placeTikTokConnection();
function syncCategoryFormatVisibility() {
  const topicSource = document.querySelector('input[name="topic-source"]:checked')?.value;
  const isWithoutUrl = document.querySelector('input[name="source-mode"]:checked')?.value === 'without';
  const shouldHide = topicSource === 'manual' && isWithoutUrl;
  $('#category-format-grid')?.classList.toggle('hidden', shouldHide);
  const customField = $('#custom-category-field');
  if (customField) {
    if (shouldHide) customField.classList.add('hidden');
    else customField.classList.toggle('hidden', $('#content-category')?.value !== 'Custom');
  }
}
$('#content-category').onchange = syncCategoryFormatVisibility;
function sourceModeEnabled() { return document.querySelector('input[name="source-mode"]:checked')?.value === 'with'; }
function renderSourceUrlFields() { syncCategoryFormatVisibility(); const topicSource = document.querySelector('input[name="topic-source"]:checked')?.value; const supportsSources = topicSource === 'manual' || topicSource === 'ai'; const enabled = supportsSources && sourceModeEnabled(); $('#source-mode-wrap')?.classList.toggle('hidden', !supportsSources); $('#source-url-fields')?.classList.toggle('hidden', !enabled); const list = $('#source-url-list'); if (!list) return; const values = sourceUrls.length ? sourceUrls : ['']; list.innerHTML = values.map((value, i) => `<label>URL sumber ${i + 1}:<span class="source-url-row"><input class="source-url-input" type="url" value="${escapeHtml(value)}" placeholder="https://example.com/article"><button class="outline" type="button" data-remove-source-url="${i}">Hapus</button></span></label>`).join(''); $('#add-source-url').disabled = values.length >= 3; document.querySelectorAll('.source-url-input').forEach((input, i) => input.oninput = () => { sourceUrls[i] = input.value; }); document.querySelectorAll('[data-remove-source-url]').forEach(button => button.onclick = () => { sourceUrls.splice(Number(button.dataset.removeSourceUrl), 1); renderSourceUrlFields(); }); }
function cleanSourceUrls() { const seen = new Set(); return sourceUrls.map(v => String(v || '').trim()).filter(v => { const key = v.toLowerCase(); if (!v || seen.has(key)) return false; seen.add(key); return true; }); }
function validateSourceUrls() { $('#source-url-error').textContent = ''; if (!sourceModeEnabled()) return []; const urls = cleanSourceUrls(); if (!urls.length) { $('#source-url-error').textContent = 'Minimal 1 URL sumber wajib diisi.'; return null; } if (urls.length > 3) { $('#source-url-error').textContent = 'Maksimal 3 URL sumber.'; return null; } for (const url of urls) { try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); } catch { $('#source-url-error').textContent = `URL tidak valid: ${url}`; return null; } } return urls; }
function renderSourcePreview(item) { const meta = item.render_source || {}; const sources = meta.sources || []; const host = $('#source-preview'); host.classList.toggle('hidden', !sources.length); if (!sources.length) return; const status = meta.verificationStatus === 'needs_review' ? 'Perlu ditinjau — sumber tidak cukup atau saling berbeda' : 'Berbasis sumber — tetap periksa sebelum dipublikasikan'; host.innerHTML = `<h3>Dibuat berdasarkan sumber</h3><p>${status} · ${sources.length} sumber</p><small>Klaim faktual diperiksa terhadap kutipan sumber.</small><ul>${sources.map(src => { let domain = src.finalUrl || src.url; try { domain = new URL(domain).hostname; } catch {} return `<li><a href="${escapeHtml(src.finalUrl || src.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.title || domain)}</a><br><small>${escapeHtml(domain)} · diambil ${escapeHtml(new Date(src.fetchedAt).toLocaleString('id-ID'))}</small></li>`; }).join('')}</ul>`; }
let sourceUrls = [''];
document.querySelectorAll('input[name="topic-source"]').forEach((input) => input.onchange = () => { const manual = input.value === 'manual' && input.checked; $('#manual-topic-wrap').classList.toggle('hidden', !manual); renderSourceUrlFields(); });
document.querySelectorAll('input[name="source-mode"]').forEach(input => input.onchange = renderSourceUrlFields); $('#add-source-url').onclick = () => { if (sourceUrls.length < 3) sourceUrls.push(''); renderSourceUrlFields(); }; renderSourceUrlFields();
let lastGenerationRequest;
let studioAssets = [];
function renderStudioAssets() { $('#studio-assets').innerHTML = studioAssets.length ? studioAssets.map(asset => `<span class="selected-asset"><img src="${escapeHtml(asset.previewUrl)}" alt=""><b>${escapeHtml(asset.name)}</b><button type="button" data-remove-studio-asset="${escapeHtml(asset.id)}">×</button></span>`).join('') : '<small>No reference assets attached</small>'; document.querySelectorAll('[data-remove-studio-asset]').forEach(button => button.onclick = () => { studioAssets = studioAssets.filter(asset => asset.id !== button.dataset.removeStudioAsset); renderStudioAssets(); }); }
$('#studio-select-assets').onclick = async () => { const chosen = await window.AssetManager.select({ selectedIds: studioAssets.map(asset => asset.id), multiple: true }); if (chosen) { studioAssets = chosen; renderStudioAssets(); } };
renderStudioAssets();
const BACKGROUND_DRAFT_KEY = 'content-studio-carousel-background';
const BackgroundState = window.CarouselBackgroundState;
const DEFAULT_BACKGROUND = BackgroundState.DEFAULT;
function loadBackgroundDraft() { try { return BackgroundState.copy(JSON.parse(localStorage.getItem(BACKGROUND_DRAFT_KEY) || '{}')); } catch { return BackgroundState.copy(); } }
let carouselBackground = loadBackgroundDraft();
function saveBackgroundDraft() { localStorage.setItem(BACKGROUND_DRAFT_KEY, JSON.stringify(carouselBackground)); renderBackgroundSelector(); applyBackgroundPreview(); schedulePreviewRender(); }
function backgroundChoice(background) { return background?.type === 'image' ? 'image' : background?.color || '#0B0B0D'; }
function renderSlideBackgrounds() {
  const host = $('#slide-background-options'); host.classList.toggle('hidden', carouselBackground.applyToAllSlides);
  host.innerHTML = carouselBackground.applyToAllSlides ? '' : Array.from({ length: Math.max(3, current?.slides?.length || 5) }, (_, index) => `<label>Slide ${index + 1}<select data-slide-background="${index}"><option value="">Gunakan global</option><option value="#0B0B0D">Hitam</option><option value="#FFFFFF">Putih</option><option value="#E9E1D3">Krem</option>${carouselBackground.uploadedBackground ? '<option value="image">Gambar upload</option>' : ''}</select></label>`).join('');
  document.querySelectorAll('[data-slide-background]').forEach(select => { select.value = backgroundChoice(carouselBackground.slideBackgrounds[select.dataset.slideBackground]) === backgroundChoice(carouselBackground) ? '' : backgroundChoice(carouselBackground.slideBackgrounds[select.dataset.slideBackground]); select.onchange = () => { const index = select.dataset.slideBackground; carouselBackground = BackgroundState.setSlide(carouselBackground, index, select.value); saveBackgroundDraft(); }; });
}
function renderBackgroundSelector() {
  const choice = backgroundChoice(carouselBackground); const radio = document.querySelector(`input[name="carousel-background"][value="${CSS.escape(choice)}"]`); if (radio) radio.checked = true;
  $('#background-apply-all').checked = carouselBackground.applyToAllSlides;
  const uploaded = carouselBackground.uploadedBackground;
  $('#background-image-preview').style.backgroundImage = uploaded?.previewUrl ? `url("${uploaded.previewUrl.replace(/["\\]/g, '\\$&')}")` : '';
  $('#background-upload-actions').classList.toggle('hidden', !uploaded);
  renderSlideBackgrounds();
}
function applyBackgroundPreview() { if (!current) return; document.querySelectorAll('#slides .slide-button').forEach((button, index) => { const selected = carouselBackground.applyToAllSlides ? carouselBackground : (carouselBackground.slideBackgrounds[index] || carouselBackground); const layer = button.querySelector('.slide-background-preview'); layer.style.background = selected.type === 'image' ? `center / cover no-repeat url("${selected.previewUrl}")` : selected.color; layer.classList.toggle('image', selected.type === 'image'); layer.classList.add('pending'); button.dataset.textColor = selected.textColor || (/^#(?:0B0B0D)$/i.test(selected.color) ? '#FFFFFF' : '#000000'); }); }
function schedulePreviewRender() { if (!current?.id) return; clearTimeout(schedulePreviewRender.timer); const version = ++schedulePreviewRender.version; schedulePreviewRender.controller?.abort(); schedulePreviewRender.controller = new AbortController(); schedulePreviewRender.timer = setTimeout(async () => { try { const updated = await api(`/contents/${current.id}/background`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, signal: schedulePreviewRender.controller.signal, body: JSON.stringify({ background: carouselBackground, revision: version }) }); if (version !== schedulePreviewRender.version || current?.id !== updated.id) return; current = updated; document.querySelectorAll('#slides .slide-button').forEach((button, index) => { const image = button.querySelector('img'); image.src = `${updated.slides[index]}?background=${Date.now()}`; button.querySelector('.slide-background-preview').classList.remove('pending'); }); } catch (error) { if (version !== schedulePreviewRender.version || error.name === 'AbortError') return; document.querySelectorAll('#slides .slide-background-preview').forEach(layer => layer.classList.remove('pending')); $('#background-error').textContent = error.message; } }, 180); } schedulePreviewRender.version = 0;
function fileDataUrl(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }); }
async function imageTextColor(url) { return new Promise(resolve => { const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0, 32, 32); const pixels = context.getImageData(0, 0, 32, 32).data; let luminance = 0; for (let i = 0; i < pixels.length; i += 4) luminance += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]; resolve(luminance / (pixels.length / 4) > 140 ? '#000000' : '#FFFFFF'); }; image.onerror = () => resolve('#FFFFFF'); image.src = url; }); }
async function uploadBackground(file) {
  $('#background-error').textContent = '';
  if (!['image/png','image/jpeg','image/webp'].includes(file?.type) || file.size > 10 * 1024 * 1024) { $('#background-error').textContent = 'Gunakan PNG, JPEG, atau WebP berukuran maksimal 10 MB.'; return; }
  try { const dataUrl = await fileDataUrl(file); const uploaded = await api('/api/assets/upload', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: file.name, mimeType: file.type, data: dataUrl.split(',')[1], tags: ['Background'], metadata: { category: 'Background' } }) }); carouselBackground = BackgroundState.upload(carouselBackground, { assetId: uploaded.id, previewUrl: uploaded.preview_url || uploaded.url, textColor: await imageTextColor(dataUrl) }); saveBackgroundDraft(); } catch (error) { $('#background-error').textContent = error.message; }
}
document.querySelectorAll('input[name="carousel-background"]').forEach(input => input.onchange = () => { if (!input.checked) return; if (input.value === 'image') { if (!carouselBackground.uploadedBackground) $('#background-file').click(); else { carouselBackground = BackgroundState.activateUpload(carouselBackground); saveBackgroundDraft(); } } else { carouselBackground = BackgroundState.selectColor(carouselBackground, input.value); saveBackgroundDraft(); } });
$('#background-file').onchange = event => { const [file] = event.target.files; if (file) uploadBackground(file); event.target.value = ''; };
$('#background-change').onclick = () => $('#background-file').click(); $('#background-remove').onclick = () => { carouselBackground = BackgroundState.removeUpload(carouselBackground); saveBackgroundDraft(); };
$('#background-apply-all').onchange = event => { carouselBackground.applyToAllSlides = event.target.checked; saveBackgroundDraft(); };
$('#background-reset').onclick = () => { carouselBackground = BackgroundState.reset(carouselBackground); saveBackgroundDraft(); };
renderBackgroundSelector();
function watermarkEnabled() { return $('#watermark-enabled').checked; }
async function generate(request) {
  try {
    lastGenerationRequest = request;
    $('#retry-generate').classList.add('hidden'); $('#message').textContent = 'Sedang membuat…';
    const generated = await api('/generate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(request) });
    show(generated); await history(); $('#message').textContent = 'Selesai';
  } catch (error) {
    // Do not call show() on failure: the last successful Preview stays intact.
    $('#message').textContent = error.message; $('#retry-generate').classList.remove('hidden');
  }
}
$('#generate').onclick = async () => { const topicSource = document.querySelector('input[name="topic-source"]:checked').value; const requestedTopic = topicSource === 'manual' ? $('#manual-topic').value : ''; const contentCategory = $('#content-category').value; const customCategory = $('#custom-category').value; const contentFormat = $('#content-format').value; const isManualWithoutUrl = topicSource === 'manual' && !sourceModeEnabled(); if (!isManualWithoutUrl && contentCategory === 'Custom' && !customCategory.trim()) return void ($('#message').textContent = 'Kategori custom wajib diisi'); if (topicSource === 'manual' && !requestedTopic.trim()) return void ($('#message').textContent = 'Topik manual wajib diisi'); const useSources = (topicSource === 'manual' || topicSource === 'ai') && sourceModeEnabled(); const sourceUrlsPayload = useSources ? validateSourceUrls() : []; if (sourceUrlsPayload === null) return; await generate({ topicSource, requestedTopic, useSources, sourceUrls: sourceUrlsPayload, contentCategory, customCategory, contentFormat, assetIds: studioAssets.map(asset => asset.id), useTrendReference: $('#use-trend-reference').checked, forceNewAngle: false, watermarkEnabled: watermarkEnabled(), background: carouselBackground }); };
$('#retry-generate').onclick = () => generate({ ...lastGenerationRequest, forceNewAngle: true });
function renderPublishStatus(data, message = '') {
  const details = [`Status: ${data.status}`, `Fail reason: ${data.fail_reason || '-'}`, `Downloaded bytes: ${data.downloaded_bytes ?? '-'}`];
  $('#status').textContent = message ? `${message} (${details.join(' • ')})` : details.join(' • ');
}
async function pollDraft(publishId) {
  const startedAt = Date.now();
  let lastData = { status: 'PROCESSING_UPLOAD', fail_reason: null, downloaded_bytes: null };
  while (Date.now() - startedAt < 5 * 60 * 1000) {
    await new Promise(resolve => setTimeout(resolve, 10 * 1000));
    const data = await api(`/status/${encodeURIComponent(publishId)}`);
    lastData = data;
    renderPublishStatus(data);
    await history();
    if (data.status === 'SEND_TO_USER_INBOX') {
      renderPublishStatus(data, 'TikTok sudah menerima draft. Menunggu draft muncul di Inbox TikTok.');
      return;
    }
    if (data.status !== 'PROCESSING_DOWNLOAD' && data.status !== 'PROCESSING_UPLOAD') return;
  }
  renderPublishStatus(lastData, 'TikTok belum berhasil mengunduh gambar. Periksa URL gambar dan coba lagi.');
}
$('#upload').onclick = async () => { try { $('#status').textContent = 'Mengirim…'; const r = await api('/upload-tiktok', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id: current.id, caption: $('#caption').value }) }); renderPublishStatus(r); await pollDraft(r.publishId); } catch(e) { $('#status').textContent = e.message; } };
$('#delete-all').onclick = async () => {
  if (!window.confirm('Hapus seluruh riwayat?') || !window.confirm('Tindakan ini tidak dapat dibatalkan.')) return;
  try {
    const result = await api('/history', { method: 'DELETE' });
    current = undefined; $('#editor').classList.add('hidden'); await history();
    $('#message').textContent = result.tiktokWarning ? 'Konten berhasil dihapus. Proses TikTok yang sudah dikirim tidak bisa dibatalkan dari aplikasi.' : 'Konten berhasil dihapus.';
  } catch (error) { $('#message').textContent = error.message; }
};
const params = new URLSearchParams(window.location.search);
const oauthResult = params.get('oauth');
const oauthReason = params.get('reason');
tiktokConnection.refresh().then(result => {
  if (oauthResult === 'success' && result.connected) tiktokConnection.showToast('TikTok berhasil dihubungkan', 'success');
  else if (oauthResult === 'error') tiktokConnection.showToast(`Gagal menghubungkan TikTok: ${oauthReason || 'otorisasi tidak dapat diselesaikan'}`, 'error');
  if (oauthResult) window.history.replaceState({}, '', `${location.pathname}${location.hash}`);
}).catch(() => {});
history().catch(e => { $('#history').innerHTML = errorState(e.message); });
loadTrend().catch(e => $('#trend-message').textContent = e.message);

const defaultTimes = ['09:00', '13:00', '19:00', '21:00', '22:00'];
let todaySchedules = [];
function renderTimeFields() {
  const count = Number($('#auto-count').value);
  $('#auto-times').innerHTML = Array.from({ length: count }, (_, i) => `<label>Konten ${i + 1}<input class="auto-time" type="time" value="${defaultTimes[i]}"></label>`).join('');
  $('#auto-warning').classList.toggle('hidden', count <= 3);
}
$('#automation-toggle').onchange = () => {
  const enabled = $('#automation-toggle').checked;
  $('#manual-settings').classList.toggle('hidden', enabled); $('#automation-settings').classList.toggle('hidden', !enabled);
  $('#mode-help').textContent = enabled ? 'Mode otomatis: carousel dibuat dan dikirim sebagai draft secara bertahap.' : 'Mode manual: konten dibuat dan diunggah hanya melalui tombol.';
};
$('#auto-count').onchange = renderTimeFields; renderTimeFields();
function localTime(timestamp) { return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)); }
async function loadSchedules() {
  todaySchedules = await api('/automation/today');
  $('#schedules').innerHTML = todaySchedules.length ? todaySchedules.map(s => `<article class="schedule-card"><h3>${escapeHtml(s.main_topic)}</h3><p>${s.progress.done} dari ${s.total_contents} selesai • ${s.progress.waiting} menunggu • ${s.progress.failed} gagal</p>${s.jobs.map(j => `<div class="job"><div><b>${localTime(j.scheduled_at)} — ${escapeHtml(j.angle)}</b><br><span class="badge">${escapeHtml(j.status)}</span>${j.publish_id ? ` <code>${escapeHtml(j.publish_id)}</code>` : ''}${j.error_message ? `<p class="error">${escapeHtml(j.error_message)}</p>` : ''}${j.status === 'SEND_TO_USER_INBOX' ? '<p>TikTok sudah menerima draft. Menunggu draft muncul di Inbox TikTok.</p>' : ''}</div><div>${j.content_id ? `<button data-view="${j.content_id}" class="outline">Lihat konten</button>` : ''} <button data-job="${j.id}" data-action="send-now" class="outline">Kirim sekarang</button> <button data-job="${j.id}" data-action="cancel" class="danger">Batalkan</button> ${['FAILED','MISSED'].includes(j.status) ? `<button data-job="${j.id}" data-action="retry">Coba lagi</button>` : ''}</div></div>`).join('')}</article>`).join('') : emptyState('Belum ada jadwal hari ini', 'Aktifkan mode otomatis untuk mulai menyusun jadwal.');
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = async () => { const rows = await api('/history'); const item = rows.find(x => x.id === Number(button.dataset.view)); if (item) show(item); });
  document.querySelectorAll('[data-job]').forEach(button => button.onclick = async () => { try { await api(`/automation/jobs/${button.dataset.job}/${button.dataset.action}`, { method: 'POST' }); await loadSchedules(); await history(); } catch (e) { $('#auto-message').textContent = e.message; } });
}
$('#activate-schedule').onclick = async () => { try { $('#auto-message').textContent = 'Menyusun sudut pembahasan…'; await api('/automation/schedules', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ mainTopic: $('#auto-topic').value, totalContents: Number($('#auto-count').value), times: [...document.querySelectorAll('.auto-time')].map(x => x.value), category: $('#auto-category').value, contentFormat: $('#auto-format').value, watermarkEnabled: watermarkEnabled() }) }); $('#auto-message').textContent = 'Jadwal aktif dan tersimpan.'; await loadSchedules(); } catch (e) { $('#auto-message').textContent = e.message; } };
async function allSchedules(action) { await Promise.all(todaySchedules.filter(s => action !== 'resume' || s.status === 'PAUSED').map(s => api(`/automation/schedules/${s.id}/${action}`, { method: 'POST' }))); await loadSchedules(); }
$('#pause-all').onclick = () => allSchedules('pause'); $('#resume-all').onclick = () => allSchedules('resume'); $('#cancel-all').onclick = () => allSchedules('cancel'); $('#stop-schedule').onclick = () => allSchedules('cancel');
loadSchedules().catch(e => { $('#schedules').innerHTML = errorState(e.message); });
setInterval(() => loadSchedules().catch(() => {}), 30000);
