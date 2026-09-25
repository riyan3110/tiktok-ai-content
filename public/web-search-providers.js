(() => {
  'use strict';
  if (window.__AIADS_WEB_SEARCH_UI__) return;
  window.__AIADS_WEB_SEARCH_UI__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const safe = value => { const span = document.createElement('span'); span.textContent = String(value ?? ''); return span.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(45000),
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  };

  const ROLE_LABEL = { primary: 'Pencarian awal', verify: 'Verifikasi/research', auto: 'Otomatis' };
  let state = { providers: [], selectedProviderId: null, enabled: false, activeCount: 0 };
  let busy = false;

  const toast = (message, error = false) => {
    const node = $('#consistency-toast');
    if (!node) { if (error) console.error(message); return; }
    node.textContent = message;
    node.className = `consistency-toast show${error ? ' error' : ''}`;
    setTimeout(() => { node.className = 'consistency-toast'; }, 3200);
  };

  function installStyles() {
    if ($('#web-search-styles')) return;
    const style = document.createElement('style');
    style.id = 'web-search-styles';
    style.textContent = `
      .ws-shell{display:grid;gap:16px;max-width:980px;margin:22px auto 0;padding-bottom:150px}
      .ws-card{display:grid;gap:14px;padding:18px;border:2px solid var(--ink,var(--border,#252b3a));border-radius:20px;background:var(--surface,#fff)}
      .ws-card h2{margin:0;font-size:1.15rem}
      .ws-card p.ws-note{margin:0;font-size:.86rem;opacity:.72;line-height:1.5}
      .ws-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .ws-card label{display:grid;gap:7px;font-weight:700}
      .ws-card input,.ws-card select{width:100%;min-width:0;font-size:16px}
      .ws-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .ws-actions button{min-height:46px}
      .ws-status{font-size:.9rem;min-height:20px}
      .ws-toggle{display:flex;align-items:center;gap:12px;font-weight:700}
      .ws-toggle input{width:22px;height:22px;flex:0 0 auto;accent-color:var(--neo-purple,#a78bfa)}
      .ws-list{display:grid;gap:10px}
      .ws-item{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:12px 14px;border:2px solid var(--ink,var(--border,#252b3a));border-radius:14px}
      .ws-item.off{opacity:.55}
      .ws-item .ws-meta{display:grid;gap:2px;min-width:0}.ws-item small{opacity:.68;overflow-wrap:anywhere}
      .ws-item .ws-ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
      .ws-item select{width:auto;font-size:14px;padding:6px 8px}
      .ws-badge{font-size:.72rem;font-weight:800;padding:2px 8px;border-radius:999px;background:#ede9fe;color:#5b21b6}
      .ws-empty{opacity:.7;padding:6px 2px}
      .ws-results{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem;border:1px dashed var(--border,#252b3a);border-radius:12px;padding:10px 12px;min-height:20px}
      @media(max-width:760px){.ws-fields{grid-template-columns:1fr}.ws-actions{grid-template-columns:1fr}.ws-item{grid-template-columns:1fr}.ws-item .ws-ctl{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
  }

  function providerList() {
    if (!state.providers.length) return '<div class="ws-empty">Belum ada provider pencarian tersimpan.</div>';
    return state.providers.map(p => `
      <div class="ws-item ${p.enabled ? '' : 'off'}">
        <div class="ws-meta">
          <b>${safe(p.name)} ${p.id === state.selectedProviderId ? '<span class="ws-badge">primary hint</span>' : ''}</b>
          <small>${safe(p.baseUrl)} · format: ${safe(p.format)}</small>
        </div>
        <div class="ws-ctl">
          <select data-ws-role="${safe(p.id)}" aria-label="Peran provider ${safe(p.name)}">
            <option value="auto" ${p.role === 'auto' ? 'selected' : ''}>Otomatis</option>
            <option value="primary" ${p.role === 'primary' ? 'selected' : ''}>Pencarian awal</option>
            <option value="verify" ${p.role === 'verify' ? 'selected' : ''}>Verifikasi</option>
          </select>
          <button type="button" class="outline" data-ws-toggle="${safe(p.id)}">${p.enabled ? 'Aktif' : 'Nonaktif'}</button>
          <button type="button" class="outline" data-ws-delete="${safe(p.id)}">Hapus</button>
        </div>
      </div>`).join('');
  }

  function render() {
    const root = $('#web-search-root');
    if (!root) return;
    const list = $('#ws-provider-list', root);
    if (list) list.innerHTML = providerList();
    const toggleNote = $('#ws-enabled-note', root);
    if (toggleNote) {
      const active = state.activeCount || state.providers.filter(p => p.enabled).length;
      toggleNote.textContent = !state.providers.length ? 'Simpan minimal satu provider agar tombol 🔍 di AI Chat bisa mencari web.'
        : (active > 1 ? `Provider siap. Di AI Chat, tekan tombol 🔍 untuk minta AI browsing — router memakai ${active} provider (1 untuk query biasa, gabung untuk verifikasi/riset, hemat kredit). Tombol kirim biasa = obrolan tanpa browsing.` : 'Provider siap. Di AI Chat, tekan tombol 🔍 untuk minta AI mencari fakta di web dulu; tombol kirim biasa untuk obrolan tanpa browsing.');
    }
    root.querySelectorAll('#web-search-root button, #web-search-root input, #web-search-root select').forEach(node => { node.disabled = busy; });

    const act = async (fn, ok) => { busy = true; render(); try { state = normalize(await fn()); if (ok) toast(ok); } catch (error) { toast(error.message, true); } finally { busy = false; render(); } };
    root.querySelectorAll('[data-ws-role]').forEach(sel => {
      sel.onchange = () => act(() => request(`/api/web-search/providers/${encodeURIComponent(sel.dataset.wsRole)}/role`, { method: 'PUT', body: JSON.stringify({ role: sel.value }) }), 'Peran provider diperbarui.');
    });
    root.querySelectorAll('[data-ws-toggle]').forEach(button => {
      const provider = state.providers.find(p => p.id === button.dataset.wsToggle);
      button.onclick = () => act(() => request(`/api/web-search/providers/${encodeURIComponent(button.dataset.wsToggle)}/enabled`, { method: 'PUT', body: JSON.stringify({ enabled: !(provider?.enabled) }) }), provider?.enabled ? 'Provider dinonaktifkan.' : 'Provider diaktifkan.');
    });
    root.querySelectorAll('[data-ws-delete]').forEach(button => {
      button.onclick = () => {
        const provider = state.providers.find(p => p.id === button.dataset.wsDelete);
        if (!provider || !confirm(`Hapus provider pencarian ${provider.name}?`)) return;
        act(() => request(`/api/web-search/providers/${encodeURIComponent(button.dataset.wsDelete)}`, { method: 'DELETE' }), `${provider.name} dihapus.`);
      };
    });
  }

  function normalize(payload = {}) {
    return {
      providers: Array.isArray(payload.providers) ? payload.providers : [],
      selectedProviderId: payload.selectedProviderId ?? null,
      enabled: Boolean(payload.enabled),
      activeCount: Number(payload.activeCount || 0)
    };
  }

  function mount() {
    const section = $('#ai-providers');
    if (!section || $('#web-search-root')) return;
    if (!$('#simple-provider-root', section)) return;
    installStyles();
    const host = document.createElement('div');
    host.innerHTML = `<div id="web-search-root"><div class="ws-shell">
      <section class="ws-card">
        <h2>AI Web Search (router)</h2>
        <p class="ws-note">Isi Base URL + API key provider pencarian apa pun (Tavily, You.com, atau lainnya). Sistem menguji pencarian nyata sebelum menyimpan. Router hemat kredit: query biasa cukup 1 provider, verifikasi/riset menggabungkan 2.</p>
        <form id="ws-form">
          <div class="ws-fields">
            <label>Base URL Web Search<input id="ws-base-url" type="text" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" required placeholder="https://api.tavily.com atau https://ydc-index.io"></label>
            <label>API Key<input id="ws-api-key" type="password" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="new-password" required placeholder="tvly-... / YDC key / API key provider"></label>
          </div>
          <div class="ws-fields">
            <label>Format API<select id="ws-format">
              <option value="auto">Auto-deteksi (rekomendasi)</option>
              <option value="tavily">Tavily (POST /search, Bearer)</option>
              <option value="youcom">You.com v1 (POST /v1/search, X-API-Key)</option>
              <option value="youcom_classic">You.com klasik (GET /search, X-API-Key)</option>
              <option value="generic">Generic REST (POST /search)</option>
            </select></label>
            <label>Peran di router<select id="ws-role">
              <option value="auto">Otomatis (dari format)</option>
              <option value="primary">Pencarian awal</option>
              <option value="verify">Verifikasi/research</option>
            </select></label>
          </div>
          <div id="ws-status" class="ws-status" role="status" aria-live="polite"></div>
          <div id="ws-results" class="ws-results"></div>
          <div class="ws-actions">
            <button type="button" class="outline" id="ws-test">Tes pencarian</button>
            <button type="submit" id="ws-save">Simpan (uji lalu simpan)</button>
          </div>
        </form>
      </section>
      <section class="ws-card">
        <h2>Provider pencarian tersimpan</h2>
        <div id="ws-provider-list" class="ws-list"></div>
        <p id="ws-enabled-note" class="ws-note"></p>
      </section>
    </div></div>`;
    section.appendChild(host.firstElementChild);

    const form = $('#ws-form', section);
    const readInputs = () => ({
      baseUrl: $('#ws-base-url', section).value.trim(),
      apiKey: $('#ws-api-key', section).value.trim(),
      format: $('#ws-format', section).value,
      role: $('#ws-role', section).value
    });

    $('#ws-test', section).onclick = async () => {
      if (busy) return;
      const { baseUrl, apiKey, format } = readInputs();
      if (!baseUrl || !apiKey) return toast('Base URL dan API Key wajib diisi.', true);
      const status = $('#ws-status', section);
      const results = $('#ws-results', section);
      busy = true; render(); status.textContent = 'Menguji pencarian nyata…'; results.textContent = '';
      try {
        const data = await request('/api/web-search/test', { method: 'POST', body: JSON.stringify({ baseUrl, apiKey, format, query: 'berita terbaru hari ini' }) });
        status.textContent = data.ok ? `Berhasil (format: ${data.format}, ${data.count} hasil).` : 'Terhubung tetapi tidak ada hasil dikenali.';
        results.textContent = (data.results || []).map((r, i) => `[${i + 1}] ${r.title}\n${r.url}`).join('\n\n') || '(tidak ada hasil)';
      } catch (error) { status.textContent = `Gagal: ${error.message}`; toast(error.message, true); }
      finally { busy = false; render(); }
    };

    form.onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      const { baseUrl, apiKey, format, role } = readInputs();
      if (!baseUrl || !apiKey) return toast('Base URL dan API Key wajib diisi.', true);
      const status = $('#ws-status', section);
      busy = true; render(); status.textContent = 'Menguji lalu menyimpan…';
      try {
        state = normalize(await request('/api/web-search/providers', { method: 'POST', body: JSON.stringify({ baseUrl, apiKey, format, role }) }));
        const key = $('#ws-api-key', section);
        if (key.value.trim() === apiKey) key.value = '';
        status.textContent = 'Provider pencarian tersimpan & aktif.';
        toast('Web Search provider tersimpan.');
      } catch (error) { status.textContent = `Gagal menyimpan: ${error.message}`; toast(error.message, true); }
      finally { busy = false; render(); }
    };

    load();
  }

  async function load() {
    try { state = normalize(await request('/api/web-search/providers')); render(); }
    catch (error) { toast(`Gagal memuat web search: ${error.message}`, true); }
  }

  // The global floating chat launcher (yellow bubble) is position:fixed and
  // overlaps this config form. Hide it while the AI Web Search card is on
  // screen, restore it when the user scrolls/navigates away.
  function watchLauncherOverlap(root) {
    const setHidden = hidden => {
      const launcher = document.querySelector('.aiads-chat-launcher');
      const panel = document.querySelector('.aiads-chat-panel');
      const chatOpen = panel && !panel.classList.contains('hidden');
      if (launcher) launcher.classList.toggle('aiads-launcher-hidden', hidden && !chatOpen);
    };
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      const visible = entries.some(e => e.isIntersecting);
      setHidden(visible);
    }, { threshold: 0 });
    io.observe(root);
    window.addEventListener('pagehide', () => { io.disconnect(); setHidden(false); }, { once: true });
  }

  const start = () => {
    mount();
    const rootNow = $('#web-search-root');
    if (rootNow) watchLauncherOverlap(rootNow);
    const observer = new MutationObserver(() => { const wasMounted = Boolean($('#web-search-root')); mount(); const root = $('#web-search-root'); if (root && !wasMounted) watchLauncherOverlap(root); });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
