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
function closeMenu() { sidebar.classList.remove('open'); backdrop.classList.remove('open'); menuToggle.setAttribute('aria-expanded', 'false'); }
menuToggle.onclick = () => { const open = !sidebar.classList.contains('open'); sidebar.classList.toggle('open', open); backdrop.classList.toggle('open', open); menuToggle.setAttribute('aria-expanded', String(open)); };
backdrop.onclick = closeMenu;
document.querySelectorAll('.side-nav a').forEach(link => link.onclick = () => { document.querySelectorAll('.side-nav a').forEach(item => item.classList.remove('active')); link.classList.add('active'); closeMenu(); });
const loadingState = label => `<div class="loading-state"><span class="spinner" aria-hidden="true"></span><p>${label}</p></div>`;
const emptyState = (title, detail) => `<div class="empty-state"><span class="state-icon" aria-hidden="true">✦</span><strong>${title}</strong><p>${detail}</p></div>`;
const errorState = message => `<div class="error-state"><span class="state-icon" aria-hidden="true">!</span><strong>Data gagal dimuat</strong><p>${escapeHtml(message)}</p></div>`;

document.querySelector('#history').innerHTML = loadingState('Memuat riwayat…');
let current;
const $ = (s) => document.querySelector(s);
async function api(url, options) { const r = await fetch(url, options); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Permintaan gagal'); return data; }
const sourceLabels = { manual: 'Manual', ai: 'AI', trending: 'Trending' };
const trendReference = $('#trend-reference');
const trendDetails = $('#trend-details');
let activeTrend;
function jakartaInput(date = new Date()) { const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' }).format(date); return parts.replace(' ', 'T'); }
function trendTime(value) { return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).format(new Date(value)).replace('.', ':'); }
function renderTrend(item) {
  activeTrend = item;
  const usable = Boolean(item?.usable);
  $('#use-trend-reference').disabled = !usable; $('#use-trend-reference').checked = usable;
  $('#generation-trend-status').textContent = usable ? `Aktif — diperbarui hari ini pukul ${trendTime(item.updated_at)} WIB` : 'Tidak aktif';
  $('#trend-state').classList.toggle('hidden', !item); if (item) $('#trend-state').textContent = item.status;
  $('#trend-status').textContent = item ? `${item.keywords.length} keyword · ${item.trend_hooks.length} gaya hook · ${item.trend_content_patterns.length} pola konten ${usable ? 'aktif' : 'tersimpan'} · ${item.source} · ${item.region} · diperbarui ${trendTime(item.updated_at)} WIB` : 'Belum ada referensi tren.';
  $('#disable-trends').classList.toggle('hidden', !item || !item.is_active); $('#delete-trends').classList.toggle('hidden', !item);
  $('#save-trends').textContent = item ? 'Perbarui referensi' : 'Simpan referensi hari ini';
  if (item) { $('#trend-keywords').value = (item.keyword_categories || []).reduce((text, entry, index, values) => `${text}${index === 0 || values[index - 1].category !== entry.category ? `${index ? '\n\n' : ''}[${entry.category}]\n` : ''}${entry.keyword}\n`, '').trim(); $('#trend-hooks').value = item.trend_hooks.join('\n'); document.querySelectorAll('.trend-pattern-options input').forEach(input => { input.checked = item.trend_content_patterns.includes(input.value); }); $('#trend-source').value = item.source; $('#trend-region').value = item.region; $('#trend-intensity').value = item.intensity; $('#trend-notes').value = item.notes || ''; }
}
async function loadTrend() { renderTrend(await api('/trend-references/current')); }
$('#edit-trends').onclick = () => { const opening = trendDetails.classList.contains('hidden'); trendDetails.classList.toggle('hidden', !opening); $('#edit-trends').textContent = opening ? 'Tutup' : 'Edit'; $('#edit-trends').setAttribute('aria-expanded', String(opening)); };
$('#save-trends').onclick = async () => { try { $('#trend-message').textContent = 'Menyimpan…'; const body = { keywords: $('#trend-keywords').value, trend_hooks: $('#trend-hooks').value, trend_content_patterns: [...document.querySelectorAll('.trend-pattern-options input:checked')].map(input => input.value), source: $('#trend-source').value, region: $('#trend-region').value, fetchedAt: new Date($('#trend-fetched-at').value + ':00+07:00').toISOString(), intensity: $('#trend-intensity').value, validity: $('#trend-validity').value, notes: $('#trend-notes').value }; const item = await api(activeTrend ? `/trend-references/${activeTrend.id}` : '/trend-references', { method: activeTrend ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }); renderTrend(item); $('#trend-message').textContent = 'Referensi tersimpan.'; } catch(e) { $('#trend-message').textContent = e.message; } };
$('#disable-trends').onclick = async () => { if (activeTrend) renderTrend(await api(`/trend-references/${activeTrend.id}/disable`, { method: 'POST' })); };
$('#delete-trends').onclick = async () => { if (activeTrend && window.confirm('Hapus referensi tren hari ini?')) { await api(`/trend-references/${activeTrend.id}`, { method: 'DELETE' }); renderTrend(null); } };
$('#trend-fetched-at').value = jakartaInput();
function show(item) {
  current = item;
  $('#editor').classList.remove('hidden');
  $('#slides').innerHTML = item.slides.map((x, i) => `<button class="slide-button" type="button" data-slide="${i}" aria-label="Perbesar slide ${i + 1}"><img src="${x}" alt="Slide ${i + 1}"></button>`).join('');
  document.querySelectorAll('[data-slide]').forEach((button, i) => { button.onclick = () => openSlide(item.slides[i], i); });
  $('#caption').value = item.caption;
  $('#trend-reference-used').textContent = `Referensi tren yang digunakan: ${item.trend_keywords_used.length ? item.trend_keywords_used.join(', ') : 'tidak ada keyword relevan'}`;
  $('#status').textContent = item.publish_status;
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
async function connectionStatus() {
  const status = await api('/tiktok/connection-status');
  const connect = $('#tiktok-connect');
  connect.textContent = status.connected ? 'TikTok Terhubung ✓' : 'Hubungkan TikTok';
  connect.classList.toggle('connected', status.connected);
  if (status.connected) connect.removeAttribute('href');
  else connect.href = '/auth/tiktok';
  $('#tiktok-reconnect').classList.toggle('hidden', !status.connected);
}
$('#content-category').onchange = () => $('#custom-category-field').classList.toggle('hidden', $('#content-category').value !== 'Custom');
document.querySelectorAll('input[name="topic-source"]').forEach((input) => input.onchange = () => { $('#manual-topic-field').classList.toggle('hidden', input.value !== 'manual' || !input.checked); });
let lastGenerationRequest;
let studioAssets = [];
function renderStudioAssets() { $('#studio-assets').innerHTML = studioAssets.length ? studioAssets.map(asset => `<span class="selected-asset"><img src="${escapeHtml(asset.previewUrl)}" alt=""><b>${escapeHtml(asset.name)}</b><button type="button" data-remove-studio-asset="${escapeHtml(asset.id)}">×</button></span>`).join('') : '<small>No reference assets attached</small>'; document.querySelectorAll('[data-remove-studio-asset]').forEach(button => button.onclick = () => { studioAssets = studioAssets.filter(asset => asset.id !== button.dataset.removeStudioAsset); renderStudioAssets(); }); }
$('#studio-select-assets').onclick = async () => { const chosen = await window.AssetManager.select({ selectedIds: studioAssets.map(asset => asset.id), multiple: true }); if (chosen) { studioAssets = chosen; renderStudioAssets(); } };
renderStudioAssets();
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
$('#generate').onclick = async () => { const topicSource = document.querySelector('input[name="topic-source"]:checked').value; const requestedTopic = $('#manual-topic').value; const contentCategory = $('#content-category').value; const customCategory = $('#custom-category').value; const contentFormat = $('#content-format').value; if (contentCategory === 'Custom' && !customCategory.trim()) return void ($('#message').textContent = 'Kategori custom wajib diisi'); if (topicSource === 'manual' && !requestedTopic.trim()) return void ($('#message').textContent = 'Topik manual wajib diisi'); await generate({ topicSource, requestedTopic, contentCategory, customCategory, contentFormat, assetIds: studioAssets.map(asset => asset.id), useTrendReference: $('#use-trend-reference').checked, forceNewAngle: false, watermarkEnabled: watermarkEnabled() }); };
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
      renderPublishStatus(data, 'Draft berhasil dikirim. Buka Inbox TikTok untuk melanjutkan.');
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
if (params.get('oauth') === 'success') $('#connection-message').textContent = 'Akun TikTok berhasil dihubungkan.';
connectionStatus().catch(e => { $('#connection-message').textContent = `Status koneksi gagal dimuat: ${e.message}`; });
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
  $('#schedules').innerHTML = todaySchedules.length ? todaySchedules.map(s => `<article class="schedule-card"><h3>${escapeHtml(s.main_topic)}</h3><p>${s.progress.done} dari ${s.total_contents} selesai • ${s.progress.waiting} menunggu • ${s.progress.failed} gagal</p>${s.jobs.map(j => `<div class="job"><div><b>${localTime(j.scheduled_at)} — ${escapeHtml(j.angle)}</b><br><span class="badge">${escapeHtml(j.status)}</span>${j.publish_id ? ` <code>${escapeHtml(j.publish_id)}</code>` : ''}${j.error_message ? `<p class="error">${escapeHtml(j.error_message)}</p>` : ''}${j.status === 'SEND_TO_USER_INBOX' ? '<p>Draft berhasil dikirim ke Inbox TikTok. Buka aplikasi TikTok untuk meninjau dan mempostingnya.</p>' : ''}</div><div>${j.content_id ? `<button data-view="${j.content_id}" class="outline">Lihat konten</button>` : ''} <button data-job="${j.id}" data-action="send-now" class="outline">Kirim sekarang</button> <button data-job="${j.id}" data-action="cancel" class="danger">Batalkan</button> ${['FAILED','MISSED'].includes(j.status) ? `<button data-job="${j.id}" data-action="retry">Coba lagi</button>` : ''}</div></div>`).join('')}</article>`).join('') : emptyState('Belum ada jadwal hari ini', 'Aktifkan mode otomatis untuk mulai menyusun jadwal.');
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = async () => { const rows = await api('/history'); const item = rows.find(x => x.id === Number(button.dataset.view)); if (item) show(item); });
  document.querySelectorAll('[data-job]').forEach(button => button.onclick = async () => { try { await api(`/automation/jobs/${button.dataset.job}/${button.dataset.action}`, { method: 'POST' }); await loadSchedules(); await history(); } catch (e) { $('#auto-message').textContent = e.message; } });
}
$('#activate-schedule').onclick = async () => { try { $('#auto-message').textContent = 'Menyusun sudut pembahasan…'; await api('/automation/schedules', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ mainTopic: $('#auto-topic').value, totalContents: Number($('#auto-count').value), times: [...document.querySelectorAll('.auto-time')].map(x => x.value), category: $('#auto-category').value, contentFormat: $('#auto-format').value, watermarkEnabled: watermarkEnabled() }) }); $('#auto-message').textContent = 'Jadwal aktif dan tersimpan.'; await loadSchedules(); } catch (e) { $('#auto-message').textContent = e.message; } };
async function allSchedules(action) { await Promise.all(todaySchedules.filter(s => action !== 'resume' || s.status === 'PAUSED').map(s => api(`/automation/schedules/${s.id}/${action}`, { method: 'POST' }))); await loadSchedules(); }
$('#pause-all').onclick = () => allSchedules('pause'); $('#resume-all').onclick = () => allSchedules('resume'); $('#cancel-all').onclick = () => allSchedules('cancel'); $('#stop-schedule').onclick = () => allSchedules('cancel');
loadSchedules().catch(e => { $('#schedules').innerHTML = errorState(e.message); });
setInterval(() => loadSchedules().catch(() => {}), 30000);
