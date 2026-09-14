(() => {
  'use strict';
  if (window.PromptNotes) return;

  const HANDOFF_KEY = 'aiads-image-generator-prompt';
  const hiddenSelectors = [
    '#project-workspace', '#project-detail', '#workspace-placeholder', '#legacy-studio', '#content-studio',
    '#asset-manager', '#storage-settings', '#workflow-orchestrator', '#content-factory', '#prompt-studio',
    '#consistency-engine', '#prompt-generator', '#ai-providers', '#generation-queue', '#ai-integration',
    '#account-workspace', '#template-library'
  ];
  const $ = selector => document.querySelector(selector);
  const safe = value => { const span = document.createElement('span'); span.textContent = String(value ?? ''); return span.innerHTML; };
  let notes = [];
  let mounted = false;

  function installStyle() {
    if (document.querySelector('style[data-prompt-notes]')) return;
    const style = document.createElement('style');
    style.dataset.promptNotes = 'true';
    style.textContent = `
      #prompt-notes{display:grid;gap:18px;width:100%;min-width:0}
      #prompt-notes.hidden{display:none!important}
      .notes-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:20px;border:2px solid var(--neo-line,#20263a);border-radius:20px;background:var(--neo-white,#fff);box-shadow:4px 5px 0 rgba(21,27,43,.12)}
      .notes-heading .eyebrow{display:block;margin-bottom:6px;font-size:.72rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
      .notes-heading h1{margin:0;font-size:clamp(1.7rem,4vw,2.6rem);line-height:1.02}
      .notes-heading p{margin:8px 0 0;color:var(--neo-muted,#687386);max-width:720px;line-height:1.5}
      .notes-count{display:inline-flex;align-items:center;justify-content:center;min-width:74px;padding:9px 12px;border:2px solid var(--neo-line,#20263a);border-radius:999px;background:var(--neo-yellow,#ffe66d);font-weight:900;white-space:nowrap}
      .notes-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .notes-toolbar input{flex:1 1 240px;min-width:0;padding:12px 14px;border:2px solid var(--neo-line,#20263a);border-radius:13px;background:var(--neo-white,#fff);color:inherit;font:inherit}
      .notes-toolbar button{min-height:44px}
      .notes-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .note-card{display:flex;flex-direction:column;min-width:0;padding:16px;border:2px solid var(--neo-line,#20263a);border-radius:18px;background:var(--neo-white,#fff);box-shadow:3px 4px 0 rgba(21,27,43,.10)}
      .note-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      .note-card h3{margin:0;min-width:0;font-size:1rem;line-height:1.35;overflow-wrap:anywhere}
      .note-card time{flex:0 0 auto;color:var(--neo-muted,#687386);font-size:.72rem;white-space:nowrap}
      .note-card pre{margin:13px 0 16px;max-height:230px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:.84rem;line-height:1.5;color:var(--neo-muted,#566174);background:var(--neo-soft,#f6f3ea);border:1.5px solid var(--neo-line,#20263a);border-radius:13px;padding:12px}
      .note-card-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto}
      .note-card-actions button{flex:1 1 auto;min-width:78px;padding:9px 10px}
      .notes-empty{grid-column:1/-1;padding:32px 18px;text-align:center;border:2px dashed var(--neo-line,#20263a);border-radius:18px;color:var(--neo-muted,#687386);background:var(--neo-white,#fff)}
      .notes-status{min-height:20px;font-size:.78rem;font-weight:800;color:var(--neo-muted,#687386)}
      .notes-status.error{color:#b42318}
      @media(max-width:720px){.notes-heading{align-items:flex-start;padding:16px}.notes-heading p{font-size:.86rem}.notes-grid{grid-template-columns:1fr}.note-card{padding:13px}.note-card pre{max-height:190px}.notes-count{min-width:auto}.notes-toolbar{align-items:stretch}.notes-toolbar button{width:auto}}
    `;
    document.head.appendChild(style);
  }

  function mount() {
    if (mounted) return $('#prompt-notes');
    installStyle();
    const host = $('.page-content') || document.querySelector('main') || document.body;
    const section = document.createElement('section');
    section.id = 'prompt-notes';
    section.className = 'hidden';
    section.setAttribute('aria-labelledby', 'notes-title');
    section.innerHTML = `
      <header class="notes-heading">
        <div><span class="eyebrow">PROMPT NOTES</span><h1 id="notes-title">Notes</h1><p>Prompt yang disimpan tersusun rapi di VPS dan tetap tersedia setelah halaman dimuat ulang.</p></div>
        <span class="notes-count" id="notes-count">0 Notes</span>
      </header>
      <div class="notes-toolbar">
        <input id="notes-search" type="search" autocomplete="off" placeholder="Cari judul atau isi prompt…" aria-label="Cari Notes">
        <button id="notes-refresh" class="outline" type="button">Muat ulang</button>
      </div>
      <div id="notes-status" class="notes-status" role="status"></div>
      <div id="notes-grid" class="notes-grid"></div>`;
    host.appendChild(section);
    $('#notes-search').addEventListener('input', render);
    $('#notes-refresh').addEventListener('click', load);
    mounted = true;
    return section;
  }

  function status(message = '', error = false) {
    const node = $('#notes-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', error);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
    return data;
  }

  function date(value) {
    if (!value) return '';
    try { return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
    catch (_) { return String(value); }
  }

  function filteredNotes() {
    const query = String($('#notes-search')?.value || '').trim().toLowerCase();
    return notes.filter(note => !query || `${note.title} ${note.content}`.toLowerCase().includes(query));
  }

  function render() {
    mount();
    const list = filteredNotes();
    $('#notes-count').textContent = `${notes.length} Notes`;
    $('#notes-grid').innerHTML = list.length ? list.map(note => `
      <article class="note-card" data-note-id="${safe(note.id)}">
        <div class="note-card-head"><h3>${safe(note.title)}</h3><time datetime="${safe(note.createdAt)}">${safe(date(note.createdAt))}</time></div>
        <pre>${safe(note.content)}</pre>
        <div class="note-card-actions">
          <button class="outline" type="button" data-note-action="copy" data-note-id="${safe(note.id)}">Copy</button>
          <button type="button" data-note-action="generate" data-note-id="${safe(note.id)}">Generate</button>
          <button class="danger" type="button" data-note-action="delete" data-note-id="${safe(note.id)}">Hapus</button>
        </div>
      </article>`).join('') : '<div class="notes-empty">Belum ada prompt tersimpan di Notes.</div>';
    document.querySelectorAll('[data-note-action]').forEach(button => button.onclick = () => action(button.dataset.noteAction, button.dataset.noteId));
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }

  function handoffToStudio(content) {
    const prompt = String(content || '').trim();
    if (!prompt) return false;
    sessionStorage.setItem(HANDOFF_KEY, prompt);
    window.dispatchEvent(new CustomEvent('aiads:image-prompt-handoff', { detail: { prompt } }));
    location.hash = '#studio';
    window.AIAdsLazyModules?.load('studio').catch(() => {});
    return true;
  }

  async function action(name, id) {
    const note = notes.find(item => item.id === id);
    if (!note) return;
    try {
      if (name === 'copy') {
        await copyText(note.content);
        status('Prompt berhasil disalin.');
      } else if (name === 'generate') {
        handoffToStudio(note.content);
      } else if (name === 'delete') {
        if (!confirm(`Hapus catatan “${note.title}”?`)) return;
        await api(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
        notes = notes.filter(item => item.id !== note.id);
        render();
        status('Catatan dihapus.');
      }
    } catch (error) { status(error.message, true); }
  }

  async function load() {
    mount();
    status('Memuat Notes…');
    try {
      notes = await api('/api/notes');
      render();
      status(notes.length ? 'Notes tersinkron dengan VPS.' : 'Belum ada prompt tersimpan.');
    } catch (error) { status(error.message, true); }
  }

  async function save(content, source = 'prompt-generator') {
    const prompt = String(content || '').trim();
    if (!prompt) throw new Error('Prompt tidak boleh kosong.');
    const note = await api('/api/notes', { method: 'POST', body: JSON.stringify({ content: prompt, source }) });
    notes = [note, ...notes.filter(item => item.id !== note.id)];
    if (location.hash === '#notes') render();
    return note;
  }

  function show() {
    const section = mount();
    hiddenSelectors.forEach(selector => document.querySelector(selector)?.classList.add('hidden'));
    section.classList.remove('hidden');
    const title = document.querySelector('.topbar-title strong');
    if (title) title.textContent = 'Notes';
    load();
  }

  function syncHash() {
    const section = mount();
    if (location.hash === '#notes') show();
    else section.classList.add('hidden');
  }

  window.PromptNotes = { save, load, open: () => { location.hash = '#notes'; show(); }, handoffToStudio };
  window.addEventListener('hashchange', syncHash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncHash, { once: true });
  else syncHash();
})();
