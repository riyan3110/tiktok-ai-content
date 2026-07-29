let current;
const $ = (s) => document.querySelector(s);
async function api(url, options) { const r = await fetch(url, options); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Permintaan gagal'); return data; }
const sourceLabels = { manual: 'Manual', ai: 'AI', trending: 'Trending' };
function show(item) { current = item; $('#editor').classList.remove('hidden'); $('#slides').innerHTML = item.slides.map((x, i) => `<img src="${x}" alt="Slide ${i + 1}">`).join(''); $('#caption').value = item.caption; $('#status').textContent = item.publish_status; }
async function history() { const rows = await api('/history'); $('#history').innerHTML = rows.length ? rows.map(x => `<article class="history-item" data-id="${x.id}"><b>${escapeHtml(x.topic)}</b><p>${escapeHtml(x.caption)}</p><span class="badge source-${escapeHtml(x.topic_source)}">${sourceLabels[x.topic_source] || 'AI'}</span> <span class="badge">${escapeHtml(x.publish_status)}</span></article>`).join('') : '<p>Belum ada konten.</p>'; document.querySelectorAll('.history-item').forEach((el, i) => el.onclick = () => show(rows[i])); }
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
document.querySelectorAll('input[name="topic-source"]').forEach((input) => input.onchange = () => { $('#manual-topic-field').classList.toggle('hidden', input.value !== 'manual' || !input.checked); });
$('#generate').onclick = async () => { try { const topicSource = document.querySelector('input[name="topic-source"]:checked').value; const requestedTopic = $('#manual-topic').value; if (topicSource === 'manual' && !requestedTopic.trim()) throw new Error('Topik manual wajib diisi'); $('#message').textContent = 'Sedang membuat…'; show(await api('/generate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ topicSource, requestedTopic }) })); await history(); $('#message').textContent = 'Selesai'; } catch (e) { $('#message').textContent = e.message; } };
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
const params = new URLSearchParams(window.location.search);
if (params.get('oauth') === 'success') $('#connection-message').textContent = 'Akun TikTok berhasil dihubungkan.';
connectionStatus().catch(e => { $('#connection-message').textContent = `Status koneksi gagal dimuat: ${e.message}`; });
history().catch(e => $('#history').textContent = e.message);
