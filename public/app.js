let current;
const $ = (s) => document.querySelector(s);
async function api(url, options) { const r = await fetch(url, options); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Permintaan gagal'); return data; }
const sourceLabels = { manual: 'Manual', ai: 'AI', trending: 'Trending' };
const trendReference = $('#trend-reference');
const trendDetails = $('#trend-details');
$('#edit-trends').onclick = () => {
  const opening = trendDetails.classList.contains('hidden');
  trendDetails.classList.toggle('hidden', !opening);
  $('#edit-trends').textContent = opening ? 'Tutup' : 'Edit';
  $('#edit-trends').setAttribute('aria-expanded', String(opening));
};
$('#save-trends').onclick = () => $('#edit-trends').click();
$('#disable-trends').onclick = () => {
  const disabled = $('#disable-trends').dataset.disabled !== 'true';
  $('#disable-trends').dataset.disabled = String(disabled);
  $('#disable-trends').textContent = disabled ? 'Aktifkan' : 'Nonaktifkan';
  $('#trend-status').textContent = disabled ? '12 keyword nonaktif · TikTok Creative Center · Indonesia' : '12 keyword aktif · TikTok Creative Center · Indonesia';
};
$('#delete-trends').onclick = () => { if (window.confirm('Hapus referensi tren hari ini?')) trendReference.remove(); };
function show(item) {
  current = item;
  $('#editor').classList.remove('hidden');
  $('#slides').innerHTML = item.slides.map((x, i) => `<button class="slide-button" type="button" data-slide="${i}" aria-label="Perbesar slide ${i + 1}"><img src="${x}" alt="Slide ${i + 1}"></button>`).join('');
  document.querySelectorAll('[data-slide]').forEach((button, i) => { button.onclick = () => openSlide(item.slides[i], i); });
  $('#caption').value = item.caption;
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
  $('#history').innerHTML = rows.length ? rows.map(x => `<article class="history-item" data-id="${x.id}"><div class="history-content"><b>${escapeHtml(x.topic)}</b><p>${escapeHtml(x.caption)}</p><span class="badge source-${escapeHtml(x.topic_source)}">${sourceLabels[x.topic_source] || 'AI'}</span> <span class="badge">${escapeHtml(x.content_category)}</span> <span class="badge">${escapeHtml(x.content_format)}</span> <span class="badge">${escapeHtml(x.publish_status)}</span></div><button class="delete-item danger" aria-label="Hapus ${escapeHtml(x.topic)}">🗑 Hapus</button></article>`).join('') : '<p>Belum ada konten.</p>';
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
$('#generate').onclick = async () => { try { const topicSource = document.querySelector('input[name="topic-source"]:checked').value; const requestedTopic = $('#manual-topic').value; const contentCategory = $('#content-category').value; const customCategory = $('#custom-category').value; const contentFormat = $('#content-format').value; if (contentCategory === 'Custom' && !customCategory.trim()) throw new Error('Kategori custom wajib diisi'); if (topicSource === 'manual' && !requestedTopic.trim()) throw new Error('Topik manual wajib diisi'); $('#message').textContent = 'Sedang membuat…'; show(await api('/generate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ topicSource, requestedTopic, contentCategory, customCategory, contentFormat }) })); await history(); $('#message').textContent = 'Selesai'; } catch (e) { $('#message').textContent = e.message; } };
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
history().catch(e => $('#history').textContent = e.message);

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
  $('#schedules').innerHTML = todaySchedules.length ? todaySchedules.map(s => `<article class="schedule-card"><h3>${escapeHtml(s.main_topic)}</h3><p>${s.progress.done} dari ${s.total_contents} selesai • ${s.progress.waiting} menunggu • ${s.progress.failed} gagal</p>${s.jobs.map(j => `<div class="job"><div><b>${localTime(j.scheduled_at)} — ${escapeHtml(j.angle)}</b><br><span class="badge">${escapeHtml(j.status)}</span>${j.publish_id ? ` <code>${escapeHtml(j.publish_id)}</code>` : ''}${j.error_message ? `<p class="error">${escapeHtml(j.error_message)}</p>` : ''}${j.status === 'SEND_TO_USER_INBOX' ? '<p>Draft berhasil dikirim ke Inbox TikTok. Buka aplikasi TikTok untuk meninjau dan mempostingnya.</p>' : ''}</div><div>${j.content_id ? `<button data-view="${j.content_id}" class="outline">Lihat konten</button>` : ''} <button data-job="${j.id}" data-action="send-now" class="outline">Kirim sekarang</button> <button data-job="${j.id}" data-action="cancel" class="danger">Batalkan</button> ${['FAILED','MISSED'].includes(j.status) ? `<button data-job="${j.id}" data-action="retry">Coba lagi</button>` : ''}</div></div>`).join('')}</article>`).join('') : '<p>Belum ada jadwal hari ini.</p>';
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = async () => { const rows = await api('/history'); const item = rows.find(x => x.id === Number(button.dataset.view)); if (item) show(item); });
  document.querySelectorAll('[data-job]').forEach(button => button.onclick = async () => { try { await api(`/automation/jobs/${button.dataset.job}/${button.dataset.action}`, { method: 'POST' }); await loadSchedules(); await history(); } catch (e) { $('#auto-message').textContent = e.message; } });
}
$('#activate-schedule').onclick = async () => { try { $('#auto-message').textContent = 'Menyusun sudut pembahasan…'; await api('/automation/schedules', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ mainTopic: $('#auto-topic').value, totalContents: Number($('#auto-count').value), times: [...document.querySelectorAll('.auto-time')].map(x => x.value), category: $('#auto-category').value, contentFormat: $('#auto-format').value }) }); $('#auto-message').textContent = 'Jadwal aktif dan tersimpan.'; await loadSchedules(); } catch (e) { $('#auto-message').textContent = e.message; } };
async function allSchedules(action) { await Promise.all(todaySchedules.filter(s => action !== 'resume' || s.status === 'PAUSED').map(s => api(`/automation/schedules/${s.id}/${action}`, { method: 'POST' }))); await loadSchedules(); }
$('#pause-all').onclick = () => allSchedules('pause'); $('#resume-all').onclick = () => allSchedules('resume'); $('#cancel-all').onclick = () => allSchedules('cancel'); $('#stop-schedule').onclick = () => allSchedules('cancel');
loadSchedules().catch(e => $('#schedules').textContent = e.message);
setInterval(() => loadSchedules().catch(() => {}), 30000);
