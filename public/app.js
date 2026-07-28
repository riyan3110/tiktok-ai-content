let current;
const $ = (s) => document.querySelector(s);
async function api(url, options) { const r = await fetch(url, options); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Permintaan gagal'); return data; }
function show(item) { current = item; $('#editor').classList.remove('hidden'); $('#slides').innerHTML = item.slides.map((x, i) => `<img src="${x}" alt="Slide ${i + 1}">`).join(''); $('#caption').value = item.caption; $('#status').textContent = item.publish_status; }
async function history() { const rows = await api('/history'); $('#history').innerHTML = rows.length ? rows.map(x => `<article class="history-item" data-id="${x.id}"><b>${escapeHtml(x.topic)}</b><p>${escapeHtml(x.caption)}</p><span class="badge">${escapeHtml(x.publish_status)}</span></article>`).join('') : '<p>Belum ada konten.</p>'; document.querySelectorAll('.history-item').forEach((el, i) => el.onclick = () => show(rows[i])); }
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
$('#generate').onclick = async () => { try { $('#message').textContent = 'Sedang membuat…'; show(await api('/generate', { method: 'POST' })); await history(); $('#message').textContent = 'Selesai'; } catch (e) { $('#message').textContent = e.message; } };
$('#upload').onclick = async () => { try { $('#status').textContent = 'Mengirim…'; const r = await api('/upload-tiktok', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id: current.id, caption: $('#caption').value }) }); $('#status').innerHTML = `${r.status} • Draft TikTok <button id="refresh">Cek status</button>`; $('#refresh').onclick = async () => { const s = await api(`/status/${r.publishId}`); $('#status').textContent = s.status + (s.fail_reason ? `: ${s.fail_reason}` : ''); await history(); }; } catch(e) { $('#status').textContent = e.message; } };
const params = new URLSearchParams(window.location.search);
if (params.get('oauth') === 'success') $('#connection-message').textContent = 'Akun TikTok berhasil dihubungkan.';
connectionStatus().catch(e => { $('#connection-message').textContent = `Status koneksi gagal dimuat: ${e.message}`; });
history().catch(e => $('#history').textContent = e.message);
