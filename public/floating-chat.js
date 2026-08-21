(() => {
  'use strict';
  if (window.__AIADS_FLOATING_CHAT__) return;
  window.__AIADS_FLOATING_CHAT__ = true;

  const AGENTROUTER_MODELS = ['claude-opus-4-8','claude-opus-4-7','claude-opus-4-6','gpt-5.5','kimi-k2.6','glm-5.2','glm-5.1'];
  const state = { providers: [], defaultProvider: '', sessionId: localStorage.getItem('aiads.floatingChat.sessionId') || '', session: null, messages: [], sending: false };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const api = async (url, options = {}) => {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  };

  const style = document.createElement('style');
  style.textContent = `
    .aiads-chat-launcher{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:9998;width:58px;height:58px;border:0;border-radius:50%;background:#7c3aed;color:#fff;font-size:25px;box-shadow:0 18px 48px rgba(0,0,0,.38);display:grid;place-items:center;cursor:pointer}
    .aiads-chat-launcher:hover{transform:translateY(-1px)}
    .aiads-chat-panel{position:fixed;right:18px;bottom:calc(88px + env(safe-area-inset-bottom));z-index:9999;width:min(420px,calc(100vw - 24px));height:min(650px,72vh);background:#0b0b0e;color:#f7f7f8;border:1px solid #2a2a31;border-radius:22px;box-shadow:0 28px 80px rgba(0,0,0,.52);display:flex;flex-direction:column;overflow:hidden}
    .aiads-chat-panel.hidden{display:none}.aiads-chat-header{display:flex;align-items:center;gap:10px;padding:14px 14px 10px;border-bottom:1px solid #24242b}.aiads-chat-header strong{font-size:15px}.aiads-chat-header small{display:block;color:#9696a1;margin-top:2px}.aiads-chat-head-actions{margin-left:auto;display:flex;gap:7px}.aiads-chat-icon{border:1px solid #34343c;background:#15151a;color:#fff;border-radius:10px;padding:8px 10px;cursor:pointer}.aiads-chat-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 12px;border-bottom:1px solid #24242b}.aiads-chat-controls select{width:100%;background:#141419;color:#fff;border:1px solid #34343d;border-radius:10px;padding:9px 10px;font-size:13px}.aiads-chat-messages{flex:1;overflow:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}.aiads-chat-empty{margin:auto;text-align:center;color:#8f8f99;max-width:250px;line-height:1.45}.aiads-chat-bubble{max-width:88%;padding:10px 12px;border-radius:15px;white-space:pre-wrap;word-break:break-word;line-height:1.45;font-size:14px}.aiads-chat-bubble.user{align-self:flex-end;background:#6d28d9;color:#fff;border-bottom-right-radius:5px}.aiads-chat-bubble.assistant{align-self:flex-start;background:#18181e;border:1px solid #292932;border-bottom-left-radius:5px}.aiads-chat-meta{font-size:10px;color:#888894;margin-top:5px}.aiads-chat-composer{border-top:1px solid #24242b;padding:10px 11px calc(10px + env(safe-area-inset-bottom));display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;background:#0d0d11}.aiads-chat-composer textarea{resize:none;min-height:44px;max-height:130px;background:#15151a;color:#fff;border:1px solid #35353e;border-radius:13px;padding:11px 12px;font:inherit;outline:none}.aiads-chat-composer textarea:focus{border-color:#7c3aed}.aiads-chat-send{height:44px;min-width:48px;border:0;border-radius:13px;background:#7c3aed;color:#fff;font-size:18px;cursor:pointer}.aiads-chat-send:disabled{opacity:.5;cursor:wait}.aiads-chat-thinking{opacity:.72;font-style:italic}.aiads-chat-error{margin:0 12px 8px;padding:8px 10px;border-radius:10px;background:#4c0d18;color:#fecdd3;font-size:12px}.aiads-chat-error.hidden{display:none}
    @media(max-width:640px){.aiads-chat-launcher{right:12px;bottom:calc(12px + env(safe-area-inset-bottom));width:54px;height:54px}.aiads-chat-panel{right:8px;bottom:calc(74px + env(safe-area-inset-bottom));width:calc(100vw - 16px);height:min(72vh,620px);border-radius:20px}.aiads-chat-controls{grid-template-columns:1fr}.aiads-chat-bubble{max-width:92%}}
  `;
  document.head.appendChild(style);

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'aiads-chat-launcher';
  launcher.setAttribute('aria-label', 'Buka AI Chat');
  launcher.textContent = '✦';

  const panel = document.createElement('section');
  panel.className = 'aiads-chat-panel hidden';
  panel.setAttribute('aria-label', 'AI Ads Lab floating chat');
  panel.innerHTML = `
    <div class="aiads-chat-header">
      <div><strong>AI Chat</strong><small id="aiads-chat-status">Siap</small></div>
      <div class="aiads-chat-head-actions"><button class="aiads-chat-icon" data-chat-new type="button">New</button><button class="aiads-chat-icon" data-chat-close type="button">✕</button></div>
    </div>
    <div class="aiads-chat-controls">
      <select id="aiads-chat-provider" aria-label="Chat provider"></select>
      <select id="aiads-chat-model" aria-label="Chat model"></select>
    </div>
    <div id="aiads-chat-messages" class="aiads-chat-messages"></div>
    <div id="aiads-chat-error" class="aiads-chat-error hidden"></div>
    <form id="aiads-chat-form" class="aiads-chat-composer">
      <textarea id="aiads-chat-input" rows="1" placeholder="Tulis pesan…" aria-label="Pesan"></textarea>
      <button id="aiads-chat-send" class="aiads-chat-send" type="submit" aria-label="Kirim">➤</button>
    </form>`;
  document.body.append(launcher, panel);

  const $ = selector => panel.querySelector(selector);
  const providerSelect = $('#aiads-chat-provider');
  const modelSelect = $('#aiads-chat-model');
  const messagesNode = $('#aiads-chat-messages');
  const form = $('#aiads-chat-form');
  const input = $('#aiads-chat-input');
  const send = $('#aiads-chat-send');
  const status = $('#aiads-chat-status');
  const errorNode = $('#aiads-chat-error');

  function showError(message = '') { errorNode.textContent = message; errorNode.classList.toggle('hidden', !message); }
  function providerById(id) { return state.providers.find(item => item.provider === id); }
  function currentProvider() { return providerById(providerSelect.value) || state.providers[0]; }
  function modelsFor(provider) {
    if (!provider) return [];
    const values = [];
    if (provider.provider === 'agentrouter') values.push(...AGENTROUTER_MODELS);
    if (provider.provider === '9router') {
      try {
        const saved = JSON.parse(localStorage.getItem('aiads.9router.models') || 'null');
        values.push(...(saved?.text?.combos || []), ...(saved?.text?.directModels || []));
      } catch (_) {}
    }
    values.push(provider.textModel, provider.defaultModel);
    if (state.session?.provider === provider.provider) values.push(state.session.model);
    return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
  }
  function renderProviderControls() {
    const previous = providerSelect.value || state.session?.provider || state.defaultProvider;
    providerSelect.innerHTML = state.providers.map(item => `<option value="${escapeHtml(item.provider)}">${escapeHtml(item.name)}</option>`).join('');
    providerSelect.value = state.providers.some(item => item.provider === previous) ? previous : (state.defaultProvider || state.providers[0]?.provider || '');
    renderModels();
  }
  function renderModels() {
    const provider = currentProvider();
    const models = modelsFor(provider);
    const preferred = state.session?.provider === provider?.provider ? state.session.model : (provider?.textModel || provider?.defaultModel);
    modelSelect.innerHTML = models.length ? models.map(model => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('') : '<option value="">Default model</option>';
    if (preferred && models.includes(preferred)) modelSelect.value = preferred;
  }
  function renderMessages() {
    if (!state.messages.length) {
      messagesNode.innerHTML = '<div class="aiads-chat-empty">Mulai ngobrol. Chat ini tetap tersimpan dan bisa dilanjutkan saat kamu pindah halaman.</div>';
      return;
    }
    messagesNode.innerHTML = state.messages.map(message => `<div class="aiads-chat-bubble ${message.role}">${escapeHtml(message.content)}<div class="aiads-chat-meta">${escapeHtml(message.model || '')}</div></div>`).join('');
    messagesNode.scrollTop = messagesNode.scrollHeight;
  }
  async function loadProviders() {
    const data = await api('/api/floating-chat/providers');
    state.providers = data.providers || [];
    state.defaultProvider = data.defaultProvider || '';
    renderProviderControls();
    if (!state.providers.length) throw new Error('Belum ada Text AI provider aktif. Aktifkan AgentRouter/9Router/OrcaRouter terlebih dahulu.');
  }
  async function createSession() {
    const provider = currentProvider();
    const created = await api('/api/floating-chat/sessions', { method: 'POST', body: JSON.stringify({ provider: provider?.provider || state.defaultProvider, model: modelSelect.value || undefined }) });
    state.session = created;
    state.sessionId = created.id;
    state.messages = [];
    localStorage.setItem('aiads.floatingChat.sessionId', created.id);
    renderProviderControls();
    renderMessages();
    return created;
  }
  async function loadSession() {
    if (!state.sessionId) return createSession();
    try {
      const data = await api(`/api/floating-chat/sessions/${encodeURIComponent(state.sessionId)}/messages`);
      state.session = data.session;
      state.messages = data.messages || [];
      renderProviderControls();
      renderMessages();
    } catch (error) {
      if (/404|tidak ditemukan/i.test(error.message)) {
        localStorage.removeItem('aiads.floatingChat.sessionId');
        state.sessionId = '';
        return createSession();
      }
      throw error;
    }
  }
  async function initialize() {
    status.textContent = 'Memuat…';
    showError('');
    await loadProviders();
    await loadSession();
    status.textContent = `${currentProvider()?.name || 'Text AI'} · ${modelSelect.value || 'default'}`;
  }
  async function newChat() {
    if (state.sending) return;
    state.sessionId = '';
    state.session = null;
    state.messages = [];
    localStorage.removeItem('aiads.floatingChat.sessionId');
    await createSession();
    status.textContent = `${currentProvider()?.name || 'Text AI'} · ${modelSelect.value || 'default'}`;
    input.focus();
  }
  async function sendMessage(content) {
    if (state.sending) return;
    const text = String(content || '').trim();
    if (!text) return;
    state.sending = true;
    send.disabled = true;
    showError('');
    const optimistic = { id: `local-${Date.now()}`, role: 'user', content: text, model: modelSelect.value };
    state.messages.push(optimistic);
    renderMessages();
    messagesNode.insertAdjacentHTML('beforeend', '<div id="aiads-chat-thinking" class="aiads-chat-bubble assistant aiads-chat-thinking">Sedang berpikir…</div>');
    messagesNode.scrollTop = messagesNode.scrollHeight;
    input.value = '';
    status.textContent = 'Menunggu jawaban…';
    try {
      if (!state.sessionId) await createSession();
      const result = await api(`/api/floating-chat/sessions/${encodeURIComponent(state.sessionId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: text, provider: providerSelect.value, model: modelSelect.value || undefined })
      });
      state.session = result.session;
      state.messages = state.messages.filter(item => item.id !== optimistic.id);
      state.messages.push(result.user, result.assistant);
      renderMessages();
      status.textContent = `${currentProvider()?.name || result.assistant.provider} · ${result.assistant.model || modelSelect.value}`;
    } catch (error) {
      state.messages = state.messages.filter(item => item.id !== optimistic.id);
      renderMessages();
      showError(error.message);
      status.textContent = 'Gagal mengirim';
      input.value = text;
    } finally {
      state.sending = false;
      send.disabled = false;
      $('#aiads-chat-thinking')?.remove();
      input.focus();
    }
  }

  providerSelect.addEventListener('change', () => { renderModels(); status.textContent = `${currentProvider()?.name || 'Text AI'} · ${modelSelect.value || 'default'}`; });
  modelSelect.addEventListener('change', () => { status.textContent = `${currentProvider()?.name || 'Text AI'} · ${modelSelect.value || 'default'}`; });
  launcher.addEventListener('click', async () => {
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !opening);
    localStorage.setItem('aiads.floatingChat.open', opening ? '1' : '0');
    if (opening && !state.providers.length) initialize().catch(error => { showError(error.message); status.textContent = 'Belum siap'; });
    if (opening) setTimeout(() => input.focus(), 60);
  });
  $('[data-chat-close]').addEventListener('click', () => { panel.classList.add('hidden'); localStorage.setItem('aiads.floatingChat.open', '0'); });
  $('[data-chat-new]').addEventListener('click', () => newChat().catch(error => showError(error.message)));
  form.addEventListener('submit', event => { event.preventDefault(); sendMessage(input.value); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 130)}px`; });

  document.body.appendChild(launcher);
  if (localStorage.getItem('aiads.floatingChat.open') === '1') {
    panel.classList.remove('hidden');
    initialize().catch(error => { showError(error.message); status.textContent = 'Belum siap'; });
  }
})();
