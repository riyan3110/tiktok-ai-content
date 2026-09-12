(() => {
  'use strict';
  if (window.__AIADS_SIMPLE_PROVIDER_UI__) return;
  window.__AIADS_SIMPLE_PROVIDER_UI__ = true;

  const $ = selector => document.querySelector(selector);
  const safe = value => { const span = document.createElement('span'); span.textContent = String(value ?? ''); return span.innerHTML; };
  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  };

  let state = { providers: [], selectedProviderId: null, fallbackEnabled: false };
  let openPanel = null;
  let busy = false;

  const selected = () => state.providers.find(provider => provider.id === state.selectedProviderId) || state.providers[0] || null;
  const toast = (message, error = false) => {
    const node = $('#consistency-toast');
    if (!node) return;
    node.textContent = message;
    node.className = `consistency-toast show${error ? ' error' : ''}`;
    setTimeout(() => { node.className = 'consistency-toast'; }, 2600);
  };

  function installStyles() {
    if ($('#simple-provider-styles')) return;
    const style = document.createElement('style');
    style.id = 'simple-provider-styles';
    style.textContent = `
      .simple-provider-shell{display:grid;gap:18px;max-width:980px;margin:0 auto}
      .simple-provider-card{display:grid;gap:16px}
      .simple-provider-card .provider-form{display:grid;gap:14px}
      .simple-provider-card .simple-provider-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .simple-provider-card label{display:grid;gap:7px;font-weight:700}
      .simple-provider-card input{width:100%;min-width:0}
      .simple-provider-save{width:100%;min-height:46px}
      .simple-provider-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
      .simple-provider-actions button{min-height:44px}
      .simple-provider-actions [data-simple-action="delete"]{color:var(--danger,#c24156)}
      .simple-provider-active{font-size:.9rem;opacity:.78;overflow-wrap:anywhere}
      .simple-provider-panel{display:grid;gap:8px;padding:14px;border:1px solid var(--border-color,var(--border,#d4d4d8));border-radius:16px}
      .simple-provider-panel[hidden]{display:none}
      .simple-provider-option{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;min-height:46px}
      .simple-provider-option span{display:grid;gap:2px;min-width:0}
      .simple-provider-option small{opacity:.68;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .simple-provider-option.active{outline:2px solid var(--accent,#8b5cf6);outline-offset:-2px}
      .simple-provider-empty{padding:10px 2px;opacity:.72}
      .simple-provider-fallback{display:flex!important;align-items:center;gap:12px;padding:14px;border:1px solid var(--border-color,var(--border,#d4d4d8));border-radius:16px;font-weight:inherit!important}
      .simple-provider-fallback input{width:20px;height:20px;flex:0 0 auto}
      .simple-provider-fallback span{display:grid;gap:3px}
      .simple-provider-fallback small{opacity:.7;font-weight:400}
      .simple-provider-playground{display:grid;gap:12px}
      .simple-provider-playground textarea{width:100%;resize:vertical}
      .simple-provider-result{white-space:pre-wrap;overflow-wrap:anywhere;min-height:54px;padding:14px;border:1px solid var(--border-color,var(--border,#d4d4d8));border-radius:14px}
      .simple-provider-result:empty::before{content:'Hasil provider akan tampil di sini.';opacity:.55}
      @media(max-width:760px){.simple-provider-card .simple-provider-fields{grid-template-columns:1fr}.simple-provider-actions{grid-template-columns:1fr 1fr 1fr}.simple-provider-option{font-size:.92rem}}
    `;
    document.head.appendChild(style);
  }

  function providerOptions(mode) {
    if (!state.providers.length) return '<div class="simple-provider-empty">Belum ada provider tersimpan. Masukkan Base URL + API Key lalu tekan Simpan.</div>';
    if (mode === 'model') {
      const current = selected();
      if (!current) return '<div class="simple-provider-empty">Pilih provider terlebih dahulu.</div>';
      const rows = (current.models || []).map(model => `
        <button type="button" class="outline simple-provider-option ${model === current.model ? 'active' : ''}" data-simple-model="${safe(model)}">
          <span><b>${safe(model)}</b><small>${safe(current.name)}</small></span><i>${model === current.model ? 'Aktif' : 'Pilih'}</i>
        </button>`).join('');
      return `${rows || '<div class="simple-provider-empty">Belum ada model tersimpan.</div>'}<button type="button" class="outline" data-refresh-models>Refresh Models</button>`;
    }
    return state.providers.map(provider => `
      <button type="button" class="outline simple-provider-option ${provider.id === state.selectedProviderId ? 'active' : ''}" data-simple-${mode === 'delete' ? 'delete-provider' : 'provider'}="${safe(provider.id)}">
        <span><b>${safe(provider.name)}</b><small>${safe(provider.baseUrl)}</small></span><i>${mode === 'delete' ? 'Hapus' : (provider.id === state.selectedProviderId ? 'Aktif' : 'Pilih')}</i>
      </button>`).join('');
  }

  function renderPanel() {
    const panel = $('#simple-provider-panel');
    if (!panel) return;
    if (!openPanel) { panel.hidden = true; panel.innerHTML = ''; return; }
    panel.hidden = false;
    panel.innerHTML = providerOptions(openPanel);

    panel.querySelectorAll('[data-simple-provider]').forEach(button => {
      button.onclick = async () => {
        try {
          state = await request(`/api/dynamic-ai/providers/${encodeURIComponent(button.dataset.simpleProvider)}/select`, { method: 'POST', body: '{}' });
          openPanel = null;
          render();
        } catch (error) { toast(error.message, true); }
      };
    });
    panel.querySelectorAll('[data-simple-model]').forEach(button => {
      button.onclick = async () => {
        const current = selected();
        if (!current) return;
        try {
          state = await request(`/api/dynamic-ai/providers/${encodeURIComponent(current.id)}/model`, { method: 'POST', body: JSON.stringify({ model: button.dataset.simpleModel }) });
          openPanel = null;
          render();
          toast(`Model aktif: ${button.dataset.simpleModel}`);
        } catch (error) { toast(error.message, true); }
      };
    });
    panel.querySelectorAll('[data-simple-delete-provider]').forEach(button => {
      button.onclick = async () => {
        const provider = state.providers.find(item => item.id === button.dataset.simpleDeleteProvider);
        if (!provider) return;
        if (!confirm(`Hapus provider ${provider.name}? Provider yang sudah dihapus tidak akan ikut fallback.`)) return;
        try {
          state = await request(`/api/dynamic-ai/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' });
          openPanel = state.providers.length ? 'delete' : null;
          render();
          toast(`${provider.name} dihapus.`);
        } catch (error) { toast(error.message, true); }
      };
    });
    panel.querySelector('[data-refresh-models]')?.addEventListener('click', async () => {
      const current = selected();
      if (!current || busy) return;
      busy = true;
      try {
        const result = await request(`/api/dynamic-ai/providers/${encodeURIComponent(current.id)}/refresh-models`, { method: 'POST', body: '{}' });
        state = { providers: result.providers, selectedProviderId: result.selectedProviderId, fallbackEnabled: result.fallbackEnabled };
        render();
        openPanel = 'model';
        renderPanel();
        toast(`${result.models.length} model dimuat dari ${current.name}.`);
      } catch (error) { toast(error.message, true); }
      finally { busy = false; }
    });
  }

  function render() {
    const current = selected();
    const section = $('#ai-providers');
    if (!section) return;
    const baseInput = $('#simple-provider-base-url');
    const keyInput = $('#simple-provider-api-key');
    if (baseInput && document.activeElement !== baseInput) baseInput.value = current?.baseUrl || baseInput.value || '';
    if (keyInput) keyInput.placeholder = current?.hasApiKey ? 'API key tersimpan — isi untuk mengganti' : 'Masukkan API key';
    const active = $('#simple-provider-active');
    if (active) active.textContent = current ? `Aktif: ${current.name}  ·  Model: ${current.model || 'belum dipilih'}` : 'Aktif: belum ada provider';
    const fallback = $('#simple-provider-fallback');
    if (fallback) fallback.checked = Boolean(state.fallbackEnabled);
    renderPanel();
  }

  function mount() {
    const section = $('#ai-providers');
    if (!section || section.dataset.simpleProviderMounted === 'true') return;
    installStyles();
    section.dataset.simpleProviderMounted = 'true';
    section.innerHTML = `
      <div class="provider-heading">
        <div><span class="eyebrow">AI PROVIDER</span><h1>Provider AI</h1><p>Masukkan Base URL dan API Key. Model diambil langsung dari provider sebelum konfigurasi disimpan.</p></div>
      </div>
      <div class="simple-provider-shell">
        <section class="provider-detail simple-provider-card">
          <div class="provider-form">
            <div class="simple-provider-fields">
              <label>Base URL<input id="simple-provider-base-url" type="url" autocomplete="off" placeholder="https://api.provider.com/v1"></label>
              <label>API Key<input id="simple-provider-api-key" type="password" autocomplete="new-password" placeholder="Masukkan API key"></label>
            </div>
            <button id="simple-provider-save" class="simple-provider-save" type="button">Simpan</button>
          </div>
          <div class="simple-provider-actions">
            <button type="button" data-simple-action="provider">Provider</button>
            <button type="button" data-simple-action="model">Model</button>
            <button type="button" class="outline" data-simple-action="delete">Hapus</button>
          </div>
          <div id="simple-provider-active" class="simple-provider-active">Aktif: memuat…</div>
          <div id="simple-provider-panel" class="simple-provider-panel" hidden></div>
          <label class="simple-provider-fallback">
            <input id="simple-provider-fallback" type="checkbox">
            <span><b>Aktifkan Fallback Penyedia</b><small>Jika aktif: provider terpilih dicoba dulu, lalu hanya provider lain yang masih tersimpan. Jika mati: hanya provider aktif yang boleh dipakai.</small></span>
          </label>
        </section>
        <section class="pipeline-card simple-provider-playground">
          <div class="pipeline-title"><div><span class="eyebrow">PROVIDER PLAYGROUND</span><h2>Tes Provider Aktif</h2></div></div>
          <label>Prompt<textarea id="simple-provider-prompt" rows="3" placeholder="Tulis prompt untuk memastikan provider benar-benar menjawab…"></textarea></label>
          <div class="pipeline-actions"><button id="simple-provider-test" type="button">Generate with Provider</button><div id="simple-provider-meta" class="pipeline-progress"></div></div>
          <div id="simple-provider-result" class="simple-provider-result"></div>
        </section>
      </div>`;

    $('#simple-provider-save').onclick = async () => {
      if (busy) return;
      const baseUrl = $('#simple-provider-base-url').value.trim();
      const apiKey = $('#simple-provider-api-key').value.trim();
      if (!baseUrl || !apiKey) return toast('Base URL dan API Key wajib diisi.', true);
      busy = true;
      $('#simple-provider-save').disabled = true;
      $('#simple-provider-save').textContent = 'Mengecek provider…';
      try {
        const result = await request('/api/dynamic-ai/providers', { method: 'POST', body: JSON.stringify({ baseUrl, apiKey }) });
        state = { providers: result.providers, selectedProviderId: result.selectedProviderId, fallbackEnabled: result.fallbackEnabled };
        $('#simple-provider-api-key').value = '';
        openPanel = null;
        render();
        toast(`${result.saved.name} tersimpan · ${result.saved.models.length} model ditemukan.`);
      } catch (error) { toast(`Gagal menyimpan: ${error.message}`, true); }
      finally {
        busy = false;
        $('#simple-provider-save').disabled = false;
        $('#simple-provider-save').textContent = 'Simpan';
      }
    };

    section.querySelectorAll('[data-simple-action]').forEach(button => {
      button.onclick = () => {
        const mode = button.dataset.simpleAction;
        openPanel = openPanel === mode ? null : mode;
        renderPanel();
      };
    });

    $('#simple-provider-fallback').onchange = async event => {
      try {
        state = await request('/api/dynamic-ai/fallback', { method: 'PUT', body: JSON.stringify({ enabled: event.target.checked }) });
        render();
        toast(state.fallbackEnabled ? 'Fallback provider aktif.' : 'Fallback provider dimatikan.');
      } catch (error) { event.target.checked = !event.target.checked; toast(error.message, true); }
    };

    $('#simple-provider-test').onclick = async () => {
      if (busy) return;
      const prompt = $('#simple-provider-prompt').value.trim();
      if (!prompt) return toast('Isi prompt untuk tes provider.', true);
      busy = true;
      $('#simple-provider-test').disabled = true;
      $('#simple-provider-meta').textContent = 'Mengirim…';
      $('#simple-provider-result').textContent = '';
      try {
        const result = await request('/api/dynamic-ai/generate', { method: 'POST', body: JSON.stringify({ prompt }) });
        $('#simple-provider-result').textContent = result.text;
        $('#simple-provider-meta').textContent = `${result.provider} · ${result.model} · ${result.responseTime} ms`;
      } catch (error) {
        $('#simple-provider-meta').textContent = 'Gagal';
        $('#simple-provider-result').textContent = error.message;
        toast(error.message, true);
      } finally { busy = false; $('#simple-provider-test').disabled = false; }
    };

    load();
  }

  async function load() {
    try { state = await request('/api/dynamic-ai/providers'); render(); }
    catch (error) { toast(`Gagal memuat provider: ${error.message}`, true); }
  }

  const start = () => {
    mount();
    const observer = new MutationObserver(() => mount());
    observer.observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
