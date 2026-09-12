(() => {
  'use strict';
  if (window.__AIADS_SIMPLE_PROVIDER_UI_V2__) return;
  window.__AIADS_SIMPLE_PROVIDER_UI_V2__ = true;

  const $ = selector => document.querySelector(selector);
  const safe = value => { const span = document.createElement('span'); span.textContent = String(value ?? ''); return span.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
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
    return {
      providers,
      defaults: Object.fromEntries(['text', 'image'].map(role => [role, {
        providerId: payload.defaults?.[role]?.providerId ?? null,
        model: payload.defaults?.[role]?.model ?? null,
        fallbackEnabled: Boolean(payload.defaults?.[role]?.fallbackEnabled)
      }]))
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
    busy = true; render();
    try {
      state = normalizeState(await request(`/api/dynamic-ai/defaults/${encodeURIComponent(role)}`, {
        method: 'PUT', body: JSON.stringify({ providerId, model })
      }));
    } finally { busy = false; render(); }
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
      return rows || '<div class="simple-provider-empty">Belum ada model tersimpan.</div>';
    }

    return state.providers.filter(provider => mode === 'delete' || provider.roles?.includes(activeRole)).map(provider => `
      <button type="button" class="outline simple-provider-option ${mode !== 'delete' && provider.id === currentDefault.providerId ? 'active' : ''}" data-simple-${mode === 'delete' ? 'delete-provider' : 'provider'}="${safe(provider.id)}">
        <span><b>${safe(provider.name)}</b><small>${safe(provider.baseUrl)} · ${safe((provider.roles || []).map(roleLabel).join(', ') || 'Konfigurasi lama')}</small></span><i>${mode === 'delete' ? 'Hapus' : (provider.id === currentDefault.providerId ? 'Aktif' : 'Pilih')}</i>
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
        if (!confirm(`Hapus provider ${provider.name}? Konfigurasi ${provider.roles?.map(roleLabel).join(", ") || "lama"} ini dan seluruh referensi fallback-nya akan dihapus.`)) return;
        busy = true; render();
        try {
          state = normalizeState(await request(`/api/dynamic-ai/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' }));
          openPanel = state.providers.length ? 'delete' : null;
          render();
          toast(`${provider.name} dihapus.`);
        } catch (error) { toast(error.message, true); }
        finally { busy = false; render(); }
      };
    });

  }

  function render() {
    for (const role of ['text', 'image']) {
      const provider = selectedProvider(role);
      const current = defaultFor(role);
      const summary = $(`#simple-${role}-summary`);
      if (summary) summary.textContent = provider ? `${provider.name} · ${current.model || 'pilih model'}` : 'Provider belum dipilih';
      const fallback = $(`#simple-${role}-fallback`);
      if (fallback) fallback.checked = Boolean(current.fallbackEnabled);
      const input = $(`#simple-${role}-base-url`);
      if (input) input.placeholder = provider?.baseUrl || 'https://api.provider.com/v1';
    }
    const panel = $('#simple-provider-panel');
    const host = openPanel === 'delete' ? $('#simple-delete-host') : $(`#simple-${activeRole}-panel-host`);
    if (panel && host && panel.parentElement !== host) host.appendChild(panel);
    renderPanel();
    document.querySelectorAll('#simple-provider-root button, #simple-provider-root input').forEach(node => { node.disabled = busy; });
  }

  function roleCard(role) {
    return `<section class="provider-detail simple-provider-card" aria-labelledby="simple-${role}-title">
      <h2 id="simple-${role}-title">Default ${roleLabel(role)}</h2>
      <form class="provider-form" data-provider-form="${role}">
        <div class="simple-provider-fields">
          <label>Base URL ${roleLabel(role)}<input id="simple-${role}-base-url" type="url" autocomplete="off" required placeholder="https://api.provider.com/v1"></label>
          <label>API Key ${roleLabel(role)}<input id="simple-${role}-api-key" type="password" autocomplete="new-password" required placeholder="Masukkan API key ${roleLabel(role)}"></label>
        </div>
        <button class="simple-provider-save" type="submit">Simpan ${roleLabel(role)}</button>
      </form>
      <div class="simple-provider-actions" style="grid-template-columns:1fr 1fr">
        <button type="button" data-simple-role-action="${role}" data-simple-action="provider">Provider ${roleLabel(role)}</button>
        <button type="button" data-simple-role-action="${role}" data-simple-action="model">Model ${roleLabel(role)}</button>
      </div>
      <div id="simple-${role}-summary" class="simple-provider-active" role="status">Memuat…</div>
      <div id="simple-${role}-panel-host"></div>
      <label class="simple-provider-fallback"><input id="simple-${role}-fallback" type="checkbox" data-fallback-role="${role}"><span>Aktifkan Fallback Penyedia ${roleLabel(role)}</span></label>
    </section>`;
  }

  function mount() {
    const section = $('#ai-providers');
    if (!section || section.querySelector('#simple-provider-root')) return;
    installStyles();
    section.dataset.simpleProviderMounted = 'v3';
    section.innerHTML = `<div id="simple-provider-root">
      <div class="provider-heading"><div><span class="eyebrow">AI PROVIDER</span><h1 id="providers-title">Provider AI</h1><p>Atur Base URL, API Key, provider, dan model secara terpisah untuk Text AI dan Image AI.</p></div></div>
      <div class="simple-provider-shell">
        ${roleCard('text')}${roleCard('image')}
        <section class="provider-detail simple-provider-card">
          <button type="button" class="outline" data-simple-action="delete">Hapus</button>
          <div id="simple-delete-host"><div id="simple-provider-panel" class="simple-provider-panel" hidden></div></div>
        </section>
      </div></div>`;

    section.querySelectorAll('[data-provider-form]').forEach(form => {
      form.onsubmit = async event => {
        event.preventDefault();
        if (busy) return;
        const role = form.dataset.providerForm;
        const baseUrl = $(`#simple-${role}-base-url`).value.trim();
        const apiKey = $(`#simple-${role}-api-key`).value.trim();
        if (!baseUrl || !apiKey) return toast('Base URL dan API Key wajib diisi.', true);
        busy = true; render();
        const button = form.querySelector('button[type="submit"]');
        button.textContent = 'Mengecek provider…';
        try {
          const result = await request('/api/dynamic-ai/providers', { method: 'POST', body: JSON.stringify({ baseUrl, apiKey, role }) });
          state = normalizeState(result);
          $(`#simple-${role}-api-key`).value = '';
          $(`#simple-${role}-base-url`).value = '';
          openPanel = null;
          toast(`${result.saved.name} tersimpan untuk ${roleLabel(role)} · ${result.saved.models.length} model ditemukan.`);
        } catch (error) { toast(`Gagal menyimpan: ${error.message}`, true); }
        finally { busy = false; button.textContent = `Simpan ${roleLabel(role)}`; render(); }
      };
    });
    section.querySelectorAll('[data-simple-action]').forEach(button => {
      button.onclick = () => {
        if (busy) return;
        const role = button.dataset.simpleRoleAction || activeRole;
        const mode = button.dataset.simpleAction;
        openPanel = openPanel === mode && activeRole === role ? null : mode;
        activeRole = role;
        render();
      };
    });
    section.querySelectorAll('[data-fallback-role]').forEach(input => {
      input.onchange = async () => {
        const role = input.dataset.fallbackRole;
        const enabled = input.checked;
        busy = true; render();
        try {
          state = normalizeState(await request('/api/dynamic-ai/fallback', { method: 'PUT', body: JSON.stringify({ role, enabled }) }));
        } catch (error) { toast(error.message, true); }
        finally { busy = false; render(); }
      };
    });
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
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
