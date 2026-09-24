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

  let state = { providers: [], selectedProviderId: null, enabled: false };
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
      .ws-shell{display:grid;gap:16px;max-width:980px;margin:22px auto 0}
      .ws-card{display:grid;gap:14px;padding:18px;border:2px solid var(--ink,var(--border,#252b3a));border-radius:20px;background:var(--surface,#fff)}
      .ws-card h2{margin:0;font-size:1.15rem}
      .ws-card p.ws-note{margin:0;font-size:.86rem;opacity:.72;line-height:1.5}
      .ws-flow{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;line-height:1.5;white-space:pre;background:#0b0b0e;color:#e7e7ea;border-radius:14px;padding:14px 16px;overflow:auto}
      .ws-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .ws-card label{display:grid;gap:7px;font-weight:700}
      .ws-card input,.ws-card select{width:100%;min-width:0;font-size:16px}
      .ws-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
      .ws-actions button{min-height:46px}
      .ws-status{font-size:.9rem;min-height:20px}
      .ws-toggle{display:flex;align-items:center;gap:12px;font-weight:700}
      .ws-toggle input{width:22px;height:22px;flex:0 0 auto;accent-color:var(--neo-purple,#a78bfa)}
      .ws-list{display:grid;gap:8px}
      .ws-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:2px solid var(--ink,var(--border,#252b3a));border-radius:14px}
      .ws-item.active{outline:3px solid var(--ink,var(--text,#1f2937));outline-offset:-3px}
      .ws-item span{display:grid;gap:2px;min-width:0}.ws-item small{opacity:.68;overflow-wrap:anywhere}
      .ws-item .ws-item-actions{display:flex;gap:8px;flex:0 0 auto}
      .ws-empty{opacity:.7;padding:6px 2px}
      .ws-results{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem;border:1px dashed var(--border,#252b3a);border-radius:12px;padding:10px 12px;min-height:20px}
      @media(max-width:760px){.ws-fields{grid-template-columns:1fr}.ws-actions{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function providerList() {
    if (!state.providers.length) return '<div class="ws-empty">Belum ada provider pencarian tersimpan.</div>';
    return state.providers.map(p => `
      <div class="ws-item ${p.id === state.selectedProviderId ? 'active' : ''}">
        <span><b>${safe(p.name)}</b><small>${safe(p.baseUrl)} · format: ${safe(p.format)}</small></span>
        <div class="ws-item-actions">
          <button type="button" class="outline" data-ws-select="${safe(p.id)}">${p.id === state.selectedProviderId ? 'Aktif' : 'Pilih'}</button>
          <button type="button" class="outline" data-ws-delete="${safe(p.id)}">Hapus</button>
        </div>
      </div>`).join('');
  }

  function render() {
    const root = $('#web-search-root');
    if (!root) return;
    const list = $('#ws-provider-list', root);
    if (list) list.innerHTML = providerList();
    const toggle = $('#ws-enabled', root);
    if (toggle) toggle.checked = Boolean(state.enabled);
    const toggleNote = $('#ws-enabled-note', root);
    if (toggleNote) toggleNote.textContent = state.selectedProviderId ? (state.enabled ? 'AI Chat akan mencari web sebelum menjawab.' : 'Aktifkan agar AI Chat mencari web.') : 'Simpan minimal satu provider dulu.';
    root.querySelectorAll('#web-search-root button, #web-search-root input').forEach(node => { node.disabled = busy; });

    root.querySelectorAll('[data-ws-select]').forEach(button => {
      button.onclick = async () => {
        busy = true; render();
        try { state = normalize(await request('/api/web-search/selected', { method: 'PUT', body: JSON.stringify({ providerId: button.dataset.wsSelect }) })); toast('Provider pencarian dipilih.'); }
        catch (error) { toast(error.message, true); }
        finally { busy = false; render(); }
      };
    });
    root.querySelectorAll('[data-ws-delete]').forEach(button => {
      button.onclick = async () => {
        const provider = state.providers.find(p => p.id === button.dataset.wsDelete);
        if (!provider || !confirm(`Hapus provider pencarian ${provider.name}?`)) return;
        busy = true; render();
        try { state = normalize(await request(`/api/web-search/providers/${encodeURIComponent(button.dataset.wsDelete)}`, { method: 'DELETE' })); toast(`${provider.name} dihapus.`); }
        catch (error) { toast(error.message, true); }
        finally { busy = false; render(); }
      };
    });
  }

  function normalize(payload = {}) {
    return {
      providers: Array.isArray(payload.providers) ? payload.providers : [],
      selectedProviderId: payload.selectedProviderId ?? null,
      enabled: Boolean(payload.enabled)
    };
  }

  function mount() {
    const section = $('#ai-providers');
    if (!section || $('#web-search-root')) return;
    // Only mount after the provider UI has rendered its root.
    if (!$('#simple-provider-root', section)) return;
    installStyles();
    const host = document.createElement('div');
    host.innerHTML = `<div id="web-search-root"><div class="ws-shell">
      <section class="ws-card">
        <h2>AI Web Search</h2>
        <p class="ws-note">Router pencarian web untuk AI Chat. Isi Base URL + API key provider apa pun (You.com, Tavily, atau lainnya). Sistem menguji pencarian nyata sebelum menyimpan. Alur:</p>
        <div class="ws-flow">Kamu
  ↓
AI Chat AI Ads Lab
  ↓
Web Search API (provider)
  ↓
Cari berita di web
  ↓
Ambil hasil + sumber
  ↓
AI Chat menganalisis/merangkum
  ↓
Jawaban + citation/link sumber</div>
        <form id="ws-form">
          <div class="ws-fields">
            <label>Base URL Web Search<input id="ws-base-url" type="text" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" required placeholder="https://api.ydc-index.io"></label>
            <label>API Key<input id="ws-api-key" type="password" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="new-password" required placeholder="Masukkan API key provider"></label>
          </div>
          <label>Format API<select id="ws-format">
            <option value="auto">Auto-deteksi (rekomendasi)</option>
            <option value="youcom">You.com (X-API-Key, GET /search)</option>
            <option value="tavily">Tavily (POST /search)</option>
            <option value="generic">Generic OpenAI-style (POST /search)</option>
          </select></label>
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
        <label class="ws-toggle"><input id="ws-enabled" type="checkbox"><span>Aktifkan Web Search di AI Chat</span></label>
        <p id="ws-enabled-note" class="ws-note"></p>
      </section>
    </div></div>`;
    section.appendChild(host.firstElementChild);

    const form = $('#ws-form', section);
    const readInputs = () => ({
      baseUrl: $('#ws-base-url', section).value.trim(),
      apiKey: $('#ws-api-key', section).value.trim(),
      format: $('#ws-format', section).value
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
      const { baseUrl, apiKey, format } = readInputs();
      if (!baseUrl || !apiKey) return toast('Base URL dan API Key wajib diisi.', true);
      const status = $('#ws-status', section);
      busy = true; render(); status.textContent = 'Menguji lalu menyimpan…';
      try {
        state = normalize(await request('/api/web-search/providers', { method: 'POST', body: JSON.stringify({ baseUrl, apiKey, format }) }));
        const key = $('#ws-api-key', section);
        if (key.value.trim() === apiKey) key.value = '';
        status.textContent = 'Provider pencarian tersimpan & aktif.';
        toast('Web Search provider tersimpan.');
      } catch (error) { status.textContent = `Gagal menyimpan: ${error.message}`; toast(error.message, true); }
      finally { busy = false; render(); }
    };

    $('#ws-enabled', section).onchange = async event => {
      const enabled = event.target.checked;
      busy = true; render();
      try { state = normalize(await request('/api/web-search/enabled', { method: 'PUT', body: JSON.stringify({ enabled }) })); toast(enabled ? 'Web Search diaktifkan.' : 'Web Search dimatikan.'); }
      catch (error) { toast(error.message, true); event.target.checked = !enabled; }
      finally { busy = false; render(); }
    };

    load();
  }

  async function load() {
    try { state = normalize(await request('/api/web-search/providers')); render(); }
    catch (error) { toast(`Gagal memuat web search: ${error.message}`, true); }
  }

  const start = () => {
    mount();
    const observer = new MutationObserver(() => mount());
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
