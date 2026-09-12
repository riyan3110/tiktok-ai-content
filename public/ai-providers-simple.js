(() => {
  'use strict';
  if (window.__AIADS_SIMPLE_PROVIDER_UI_V2__) return;
  window.__AIADS_SIMPLE_PROVIDER_UI_V2__ = true;

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

  let state = { providers: [], defaults: { text: { providerId: null, model: null }, image: { providerId: null, model: null } }, fallbackEnabled: false };
  let activeRole = 'text';
  let openPanel = null;
  let busy = false;

  function normalizeState(payload = {}) {
    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const fallbackTextId = payload.selectedProviderId || providers[0]?.id || null;
    return {
      providers,
      defaults: {
        text: {
          providerId: payload.defaults?.text?.providerId || fallbackTextId,
          model: payload.defaults?.text?.model || providers.find(item => item.id === fallbackTextId)?.textModel || providers.find(item => item.id === fallbackTextId)?.model || null
        },
        image: {
          providerId: payload.defaults?.image?.providerId || providers[0]?.id || null,
          model: payload.defaults?.image?.model || providers.find(item => item.id === (payload.defaults?.image?.providerId || providers[0]?.id))?.imageModel || null
        }
      },
      fallbackEnabled: Boolean(payload.fallbackEnabled)
    };
  }

  const roleLabel = role => role === 'image' ? 'Image AI' : 'Text AI';
  const defaultFor = role => state.defaults?.[role] || { providerId: null, model: null };
  const selectedProvider = role => state.providers.find(provider => provider.id === defaultFor(role).providerId) || null;

  const toast = (message, error = false) => {
    const node = $('#consistency-toast');
    if (!node) return;
    node.textContent = message;
    node.className = `consistency-toast show${error ? ' error' : ''}`;
    setTimeout(() => { node.className = 'consistency-toast'; }, 2800);
  };

  function installStyles() {
    if ($('#simple-provider-styles-v2')) return;
    const style = document.createElement('style');
    style.id = 'simple-provider-styles-v2';
    style.textContent = `
      .simple-provider-shell{display:grid;gap:18px;max-width:980px;margin:0 auto}
      .simple-provider-card{display:grid;gap:16px}
      .simple-provider-card .provider-form{display:grid;gap:14px}
      .simple-provider-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .simple-provider-card label{display:grid;gap:7px;font-weight:700}
      .simple-provider-card input{width:100%;min-width:0}
      .simple-provider-save{width:100%;min-height:48px}
      .simple-provider-role-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .simple-provider-role{display:grid;gap:5px;min-height:90px;padding:14px 16px;text-align:left;border-radius:18px}
      .simple-provider-role b{font-size:1rem}.simple-provider-role span{font-size:.84rem;opacity:.75;overflow-wrap:anywhere}
      .simple-provider-role.active{outline:3px solid var(--ink,var(--text,#1f2937));outline-offset:-3px;box-shadow:5px 6px 0 rgba(31,41,55,.12)}
      .simple-provider-role-note{font-size:.82rem;opacity:.72;margin-top:-7px}
      .simple-provider-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
      .simple-provider-actions button{min-height:45px}
      .simple-provider-actions [data-simple-action="delete"]{color:var(--danger,#b4233c)}
      .simple-provider-active{font-size:.92rem;opacity:.8;overflow-wrap:anywhere}
      .simple-provider-panel{display:grid;gap:8px;padding:14px;border:2px solid var(--ink,var(--border,#252b3a));border-radius:18px;background:var(--surface,#fff)}
      .simple-provider-panel[hidden]{display:none}
      .simple-provider-option{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;min-height:48px}
      .simple-provider-option span{display:grid;gap:2px;min-width:0}.simple-provider-option small{opacity:.68;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .simple-provider-option.active{outline:3px solid var(--ink,var(--text,#1f2937));outline-offset:-3px}
      .simple-provider-empty{padding:10px 2px;opacity:.72}
      .simple-provider-fallback{display:flex!important;align-items:center;gap:12px;padding:14px;border:2px solid var(--ink,var(--border,#252b3a));border-radius:18px;font-weight:inherit!important}
      .simple-provider-fallback input{width:21px;height:21px;flex:0 0 auto}.simple-provider-fallback span{display:grid;gap:3px}.simple-provider-fallback small{opacity:.7;font-weight:400}
      .simple-provider-playground{display:grid;gap:12px}.simple-provider-playground textarea{width:100%;resize:vertical}
      .simple-provider-result{white-space:pre-wrap;overflow-wrap:anywhere;min-height:54px;padding:14px;border:2px solid var(--ink,var(--border,#252b3a));border-radius:16px}
      .simple-provider-result:empty::before{content:'Hasil tes provider akan tampil di sini.';opacity:.55}
      .simple-provider-image-result{display:block;max-width:100%;max-height:520px;margin-top:10px;border-radius:16px}
      @media(max-width:760px){.simple-provider-fields{grid-template-columns:1fr}.simple-provider-role-grid{grid-template-columns:1fr 1fr}.simple-provider-actions{grid-template-columns:1fr 1fr 1fr}.simple-provider-option{font-size:.92rem}}
    `;
    document.head.appendChild(style);
  }

  async function setDefault(role, providerId, model) {
    const payload = await request(`/api/dynamic-ai/defaults/${encodeURIComponent(role)}`, {
      method: 'PUT',
      body: JSON.stringify({ providerId, model })
    });
    state = normalizeState(payload);
  }

  function providerOptions(mode) {
    if (!state.providers.length) return '<div class="simple-provider-empty">Belum ada provider tersimpan. Pilih Text AI atau Image AI, masukkan Base URL + API Key, lalu tekan Simpan.</div>';
    const currentDefault = defaultFor(activeRole);
    const currentProvider = selectedProvider(activeRole);

    if (mode === 'model') {
      if (!currentProvider) return '<div class="simple-provider-empty">Pilih provider untuk role ini terlebih dahulu.</div>';
      const rows = (currentProvider.models || []).map(model => `
        <button type="button" class="outline simple-provider-option ${model === currentDefault.model ? 'active' : ''}" data-simple-model="${safe(model)}">
          <span><b>${safe(model)}</b><small>${safe(currentProvider.name)} · ${roleLabel(activeRole)}</small></span><i>${model === currentDefault.model ? 'Aktif' : 'Pilih'}</i>
        </button>`).join('');
      return `${rows || '<div class="simple-provider-empty">Belum ada model tersimpan.</div>'}<button type="button" class="outline" data-refresh-models>Refresh Models</button>`;
    }

    return state.providers.map(provider => `
      <button type="button" class="outline simple-provider-option ${mode !== 'delete' && provider.id === currentDefault.providerId ? 'active' : ''}" data-simple-${mode === 'delete' ? 'delete-provider' : 'provider'}="${safe(provider.id)}">
        <span><b>${safe(provider.name)}</b><small>${safe(provider.baseUrl)}</small></span><i>${mode === 'delete' ? 'Hapus' : (provider.id === currentDefault.providerId ? 'Aktif' : 'Pilih')}</i>
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
          const provider = state.providers.find(item => item.id === button.dataset.simpleProvider);
          const preferredModel = activeRole === 'image' ? provider?.imageModel : provider?.textModel;
          await setDefault(activeRole, button.dataset.simpleProvider, preferredModel || provider?.models?.[0]);
          openPanel = null;
          render();
          toast(`${roleLabel(activeRole)} memakai ${provider?.name || 'provider terpilih'}.`);
        } catch (error) { toast(error.message, true); }
      };
    });

    panel.querySelectorAll('[data-simple-model]').forEach(button => {
      button.onclick = async () => {
        const provider = selectedProvider(activeRole);
        if (!provider) return;
        try {
          await setDefault(activeRole, provider.id, button.dataset.simpleModel);
          openPanel = null;
          render();
          toast(`Model ${roleLabel(activeRole)}: ${button.dataset.simpleModel}`);
        } catch (error) { toast(error.message, true); }
      };
    });

    panel.querySelectorAll('[data-simple-delete-provider]').forEach(button => {
      button.onclick = async () => {
        const provider = state.providers.find(item => item.id === button.dataset.simpleDeleteProvider);
        if (!provider) return;
        if (!confirm(`Hapus provider ${provider.name}? Provider ini akan dihapus dari Text AI, Image AI, dan fallback.`)) return;
        try {
          state = normalizeState(await request(`/api/dynamic-ai/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' }));
          openPanel = state.providers.length ? 'delete' : null;
          render();
          toast(`${provider.name} dihapus.`);
        } catch (error) { toast(error.message, true); }
      };
    });

    panel.querySelector('[data-refresh-models]')?.addEventListener('click', async () => {
      const provider = selectedProvider(activeRole);
      if (!provider || busy) return;
      busy = true;
      try {
        const result = await request(`/api/dynamic-ai/providers/${encodeURIComponent(provider.id)}/refresh-models`, { method: 'POST', body: '{}' });
        state = normalizeState(result);
        render();
        openPanel = 'model';
        renderPanel();
        toast(`${result.models.length} model dimuat dari ${provider.name}.`);
      } catch (error) { toast(error.message, true); }
      finally { busy = false; }
    });
  }

  function render() {
    const textProvider = selectedProvider('text');
    const imageProvider = selectedProvider('image');
    const textDefault = defaultFor('text');
    const imageDefault = defaultFor('image');

    document.querySelectorAll('[data-simple-role]').forEach(button => button.classList.toggle('active', button.dataset.simpleRole === activeRole));
    const textSummary = $('#simple-text-summary');
    const imageSummary = $('#simple-image-summary');
    if (textSummary) textSummary.textContent = textProvider ? `${textProvider.name} · ${textDefault.model || 'pilih model'}` : 'Belum dipilih';
    if (imageSummary) imageSummary.textContent = imageProvider ? `${imageProvider.name} · ${imageDefault.model || 'pilih model'}` : 'Belum dipilih';

    const baseInput = $('#simple-provider-base-url');
    const keyInput = $('#simple-provider-api-key');
    const activeProvider = selectedProvider(activeRole);
    if (baseInput && document.activeElement !== baseInput && !baseInput.value) baseInput.placeholder = activeProvider?.baseUrl || 'https://api.provider.com/v1';
    if (keyInput) keyInput.placeholder = activeProvider?.hasApiKey ? 'API key tersimpan — isi untuk mengganti/menambah' : 'Masukkan API key';

    const active = $('#simple-provider-active');
    const activeDefault = defaultFor(activeRole);
    if (active) active.textContent = activeProvider
      ? `${roleLabel(activeRole)} aktif: ${activeProvider.name} · Model: ${activeDefault.model || 'belum dipilih'}`
      : `${roleLabel(activeRole)} aktif: belum ada provider`;

    const roleHint = $('#simple-provider-role-hint');
    if (roleHint) roleHint.textContent = activeRole === 'text'
      ? 'Default Text AI dipakai bersama oleh AI Chat, AI Text, dan Text Content.'
      : 'Default Image AI berdiri sendiri dan tidak mengubah provider Text AI.';

    const fallback = $('#simple-provider-fallback');
    if (fallback) fallback.checked = Boolean(state.fallbackEnabled);
    const testTitle = $('#simple-provider-test-title');
    if (testTitle) testTitle.textContent = activeRole === 'image' ? 'Tes Default Image AI' : 'Tes Default Text AI';
    const testButton = $('#simple-provider-test');
    if (testButton) testButton.textContent = activeRole === 'image' ? 'Generate Image' : 'Generate Text';
    renderPanel();
  }

  function mount() {
    const section = $('#ai-providers');
    if (!section || section.querySelector('#simple-provider-root')) return;
    installStyles();
    section.dataset.simpleProviderMounted = 'v2';
    section.innerHTML = `
      <div id="simple-provider-root">
        <div class="provider-heading">
          <div><span class="eyebrow">AI PROVIDER</span><h1>Provider AI</h1><p>Simpan provider sekali, lalu tentukan provider/model terpisah untuk Text AI dan Image AI. Default Video AI dihapus.</p></div>
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

            <div class="simple-provider-role-grid">
              <button type="button" class="outline simple-provider-role active" data-simple-role="text"><b>Default Text AI</b><span id="simple-text-summary">Memuat…</span></button>
              <button type="button" class="outline simple-provider-role" data-simple-role="image"><b>Default Image AI</b><span id="simple-image-summary">Memuat…</span></button>
            </div>
            <div id="simple-provider-role-hint" class="simple-provider-role-note">Default Text AI dipakai bersama oleh AI Chat, AI Text, dan Text Content.</div>

            <div class="simple-provider-actions">
              <button type="button" data-simple-action="provider">Provider</button>
              <button type="button" data-simple-action="model">Model</button>
              <button type="button" class="outline" data-simple-action="delete">Hapus</button>
            </div>
            <div id="simple-provider-active" class="simple-provider-active">Memuat provider…</div>
            <div id="simple-provider-panel" class="simple-provider-panel" hidden></div>

            <label class="simple-provider-fallback">
              <input id="simple-provider-fallback" type="checkbox">
              <span><b>Aktifkan Fallback Penyedia</b><small>Jika aktif, default role dicoba dulu lalu provider lain yang masih tersimpan. Provider yang sudah dihapus tidak ikut fallback.</small></span>
            </label>
          </section>

          <section class="pipeline-card simple-provider-playground">
            <div class="pipeline-title"><div><span class="eyebrow">PROVIDER PLAYGROUND</span><h2 id="simple-provider-test-title">Tes Default Text AI</h2></div></div>
            <label>Prompt<textarea id="simple-provider-prompt" rows="3" placeholder="Tulis prompt untuk memastikan provider/model benar-benar bekerja…"></textarea></label>
            <div class="pipeline-actions"><button id="simple-provider-test" type="button">Generate Text</button><div id="simple-provider-meta" class="pipeline-progress"></div></div>
            <div id="simple-provider-result" class="simple-provider-result"></div>
          </section>
        </div>
      </div>`;

    section.querySelectorAll('[data-simple-role]').forEach(button => {
      button.onclick = () => {
        activeRole = button.dataset.simpleRole === 'image' ? 'image' : 'text';
        openPanel = null;
        $('#simple-provider-result').innerHTML = '';
        $('#simple-provider-meta').textContent = '';
        render();
      };
    });

    $('#simple-provider-save').onclick = async () => {
      if (busy) return;
      const baseUrl = $('#simple-provider-base-url').value.trim();
      const apiKey = $('#simple-provider-api-key').value.trim();
      if (!baseUrl || !apiKey) return toast('Base URL dan API Key wajib diisi.', true);
      busy = true;
      $('#simple-provider-save').disabled = true;
      $('#simple-provider-save').textContent = 'Mengecek provider…';
      try {
        const result = await request('/api/dynamic-ai/providers', { method: 'POST', body: JSON.stringify({ baseUrl, apiKey, role: activeRole }) });
        state = normalizeState(result);
        $('#simple-provider-api-key').value = '';
        $('#simple-provider-base-url').value = '';
        openPanel = null;
        render();
        toast(`${result.saved.name} tersimpan untuk ${roleLabel(activeRole)} · ${result.saved.models.length} model ditemukan.`);
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
        state = normalizeState(await request('/api/dynamic-ai/fallback', { method: 'PUT', body: JSON.stringify({ enabled: event.target.checked }) }));
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
      $('#simple-provider-result').innerHTML = '';
      try {
        const endpoint = activeRole === 'image' ? '/api/dynamic-ai/generate-image' : '/api/dynamic-ai/generate';
        const result = await request(endpoint, { method: 'POST', body: JSON.stringify({ prompt }) });
        if (activeRole === 'image') {
          const src = result.url || (result.b64Json ? `data:image/png;base64,${result.b64Json}` : '');
          $('#simple-provider-result').textContent = src ? '' : 'Provider tidak mengembalikan gambar.';
          if (src) {
            const img = document.createElement('img');
            img.src = src;
            img.alt = 'Hasil Default Image AI';
            img.className = 'simple-provider-image-result';
            $('#simple-provider-result').appendChild(img);
          }
        } else {
          $('#simple-provider-result').textContent = result.text;
        }
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
    try { state = normalizeState(await request('/api/dynamic-ai/providers')); render(); }
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
