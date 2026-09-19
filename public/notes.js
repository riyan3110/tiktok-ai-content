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
  let activeNoteId = null;

  function installStyle() {
    if (document.querySelector('style[data-prompt-notes]')) return;
    const style = document.createElement('style');
    style.dataset.promptNotes = 'true';
    style.textContent = `
      #prompt-notes{display:grid;gap:12px;width:100%;min-width:0}
      #prompt-notes.hidden{display:none!important}
      #prompt-notes #notes-list-view{display:grid;gap:12px}
      .notes-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border:2px solid var(--neo-line,#20263a);border-radius:16px;background:var(--neo-white,#fff);box-shadow:3px 4px 0 rgba(21,27,43,.10)}
      .notes-heading h1{margin:0;font-size:clamp(2.1rem,4vw,3.7rem);font-weight:800;line-height:1.15;letter-spacing:-.045em}
      .aiads-neo-theme .notes-heading h1{font-size:2rem}
      .notes-toolbar{display:flex;align-items:center;gap:8px}
      .notes-toolbar input{flex:1 1 0;min-width:0;padding:10px 14px;border:2px solid var(--neo-line,#20263a);border-radius:13px;background:var(--neo-white,#fff);color:inherit;font:inherit;font-size:.9rem}
      .notes-toolbar button{min-height:42px;padding:10px 14px;white-space:nowrap;font-size:.85rem}
      .notes-list{display:grid;gap:0;border:2px solid var(--neo-line,#20263a);border-radius:16px;overflow:hidden;background:var(--neo-white,#fff);box-shadow:3px 4px 0 rgba(21,27,43,.10)}
      .notes-list-item{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;border-bottom:1.5px solid var(--neo-line,#e5e7eb);transition:background .15s}
      .notes-list-sequence{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;min-width:30px;border:2px solid var(--neo-line,#20263a);border-radius:9px;background:var(--neo-yellow,#ffe66d);color:var(--neo-line,#20263a);font-size:.76rem;font-weight:900;line-height:1}
      .notes-list-item:last-child{border-bottom:none}
      .notes-list-item:hover,.notes-list-item:focus-visible{background:var(--neo-soft,#f6f3ea)}
      .notes-list-item h3{margin:0;font-size:.9rem;font-weight:700;line-height:1.35;overflow-wrap:anywhere;flex:1 1 auto}
      .notes-list-item .notes-list-arrow{flex:0 0 auto;margin-left:10px;color:var(--neo-muted,#687386);font-size:1.1rem}
      .notes-empty{padding:28px 16px;text-align:center;border:2px dashed var(--neo-line,#20263a);border-radius:16px;color:var(--neo-muted,#687386);background:var(--neo-white,#fff);font-size:.9rem}
      .notes-status{min-height:0;font-size:.78rem;font-weight:800;color:var(--neo-muted,#687386)}
      .notes-status:empty{display:none}
      .notes-status.error{color:#b42318}
      .notes-detail{display:grid;gap:12px;width:100%;min-width:0}
      .notes-detail-header{display:flex;align-items:center;gap:12px;padding:14px 18px;border:2px solid var(--neo-line,#20263a);border-radius:16px;background:var(--neo-white,#fff);box-shadow:3px 4px 0 rgba(21,27,43,.10)}
      .notes-detail-back{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border:2px solid var(--neo-line,#20263a);border-radius:11px;background:var(--neo-white,#fff);cursor:pointer;flex:0 0 auto;font-size:1.1rem;transition:background .15s}
      .notes-detail-back:hover{background:var(--neo-soft,#f6f3ea)}
      .notes-detail-title-group{flex:1 1 auto;min-width:0}
      .notes-detail-title-group h1{margin:0;font-size:1.15rem;font-weight:800;line-height:1.2;overflow-wrap:anywhere}
      .notes-detail-title-group time{display:block;margin-top:3px;color:var(--neo-muted,#687386);font-size:.75rem}
      .notes-detail-edit-title{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;min-height:38px;padding:0;border:2px solid var(--neo-line,#20263a);border-radius:11px;background:var(--neo-yellow,#ffe66d);color:var(--neo-line,#20263a);cursor:pointer;flex:0 0 auto}
      .notes-detail-edit-title svg{width:18px;height:18px;display:block}
      .notes-detail-edit-title:hover{filter:brightness(.98);transform:none}
      .notes-detail-content{padding:16px;border:2px solid var(--neo-line,#20263a);border-radius:16px;background:var(--neo-white,#fff);box-shadow:3px 4px 0 rgba(21,27,43,.10)}
      .notes-detail-content pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:.86rem;line-height:1.6;color:var(--neo-muted,#566174);background:var(--neo-soft,#f6f3ea);border:1.5px solid var(--neo-line,#20263a);border-radius:12px;padding:14px}
      .notes-detail-actions{display:flex;gap:8px;flex-wrap:wrap}
      .notes-detail-actions button{flex:1 1 auto;min-width:80px;padding:10px 14px;min-height:44px}
      .notes-detail-delete{margin-top:4px}
      .notes-detail-delete button{min-height:42px;padding:9px 14px}
      @media(max-width:720px){.notes-heading{padding:12px 14px}.notes-heading h1{font-size:clamp(1.6rem,6vw,2.1rem)}.notes-toolbar{flex-wrap:wrap}.notes-toolbar input{flex:1 1 160px}.notes-list-item{padding:10px 14px}.notes-detail-header{padding:12px 14px}.notes-detail-content{padding:14px}.notes-detail-content pre{font-size:.82rem;padding:12px}}
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
      <div id="notes-list-view">
        <header class="notes-heading">
          <h1 id="notes-title">Notes</h1>
        </header>
        <div class="notes-toolbar">
          <input id="notes-search" type="search" autocomplete="off" placeholder="Cari judul atau isi prompt…" aria-label="Cari Notes">
          <button id="notes-refresh" class="outline" type="button">Muat ulang</button>
        </div>
        <div id="notes-status" class="notes-status" role="status"></div>
        <div id="notes-grid" class="notes-list"></div>
      </div>
      <div id="notes-detail-view" class="notes-detail" style="display:none"></div>`;
    host.appendChild(section);
    $('#notes-search').addEventListener('input', renderList);
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

  function showListView() {
    activeNoteId = null;
    const listView = $('#notes-list-view');
    const detailView = $('#notes-detail-view');
    if (listView) listView.style.display = '';
    if (detailView) { detailView.style.display = 'none'; detailView.innerHTML = ''; }
  }

  function renderList() {
    mount();
    showListView();
    const list = filteredNotes();
    const sequenceById = new Map(notes.map((note, index) => [note.id, index + 1]));
    const grid = $('#notes-grid');
    grid.innerHTML = list.length ? list.map(note => `
      <div class="notes-list-item" tabindex="0" role="button" data-note-open="${safe(note.id)}" aria-label="${safe(note.title)}">
        <span class="notes-list-sequence" aria-hidden="true">${safe(sequenceById.get(note.id))}</span>
        <h3>${safe(note.title)}</h3>
        <span class="notes-list-arrow" aria-hidden="true">&rsaquo;</span>
      </div>`).join('') : '<div class="notes-empty">Belum ada prompt tersimpan di Notes.</div>';
    grid.querySelectorAll('[data-note-open]').forEach(item => {
      const handler = () => openDetail(item.dataset.noteOpen);
      item.addEventListener('click', handler);
      item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
    });
  }

  function openDetail(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    activeNoteId = id;
    const listView = $('#notes-list-view');
    const detailView = $('#notes-detail-view');
    if (listView) listView.style.display = 'none';
    detailView.style.display = '';
    detailView.innerHTML = `
      <header class="notes-detail-header">
        <button class="notes-detail-back" id="notes-back" type="button" aria-label="Kembali ke daftar Notes">&larr;</button>
        <div class="notes-detail-title-group">
          <h1>${safe(note.title)}</h1>
          ${note.createdAt ? `<time datetime="${safe(note.createdAt)}">${safe(date(note.createdAt))}</time>` : ''}
        </div>
        <button class="notes-detail-edit-title" id="notes-detail-edit-title" type="button" aria-label="Edit judul Notes" title="Edit judul">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
      </header>
      <div class="notes-detail-content">
        <pre>${safe(note.content)}</pre>
      </div>
      <div id="notes-detail-status" class="notes-status" role="status"></div>
      <div class="notes-detail-actions">
        <button class="outline" type="button" id="notes-detail-copy">Copy</button>
        <button type="button" id="notes-detail-generate">Generate</button>
      </div>
      <div class="notes-detail-delete">
        <button class="danger outline" type="button" id="notes-detail-delete">Hapus</button>
      </div>`;
    $('#notes-back').addEventListener('click', renderList);
    $('#notes-detail-edit-title').addEventListener('click', () => detailAction('edit-title', note));
    $('#notes-detail-copy').addEventListener('click', () => detailAction('copy', note));
    $('#notes-detail-generate').addEventListener('click', () => detailAction('generate', note));
    $('#notes-detail-delete').addEventListener('click', () => detailAction('delete', note));
  }

  function detailStatus(message = '', error = false) {
    const node = $('#notes-detail-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', error);
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

  async function detailAction(name, note) {
    try {
      if (name === 'edit-title') {
        const nextTitle = window.prompt('Edit judul Notes', note.title);
        if (nextTitle === null) return;
        const title = String(nextTitle || '').replace(/\s+/g, ' ').trim();
        if (!title) return void detailStatus('Judul tidak boleh kosong.', true);
        const updated = await api(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
        notes = notes.map(item => item.id === updated.id ? updated : item);
        openDetail(updated.id);
        detailStatus('Judul berhasil diubah.');
      } else if (name === 'copy') {
        await copyText(note.content);
        detailStatus('Prompt berhasil disalin.');
      } else if (name === 'generate') {
        handoffToStudio(note.content);
      } else if (name === 'delete') {
        if (!confirm(`Hapus catatan "${note.title}"?`)) return;
        await api(`/api/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
        notes = notes.filter(item => item.id !== note.id);
        renderList();
        status('Catatan dihapus.');
      }
    } catch (error) { detailStatus(error.message, true); }
  }

  async function load() {
    mount();
    status('Memuat…');
    try {
      notes = await api('/api/notes');
      renderList();
      status('');
    } catch (error) { status(error.message, true); }
  }

  async function save(content, source = 'prompt-generator') {
    const prompt = String(content || '').trim();
    if (!prompt) throw new Error('Prompt tidak boleh kosong.');
    const note = await api('/api/notes', { method: 'POST', body: JSON.stringify({ content: prompt, source }) });
    notes = [...notes.filter(item => item.id !== note.id), note];
    if (location.hash === '#notes' && !activeNoteId) renderList();
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
    else { section.classList.add('hidden'); showListView(); }
  }

  window.PromptNotes = { save, load, open: () => { location.hash = '#notes'; show(); }, handoffToStudio };
  window.addEventListener('hashchange', syncHash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncHash, { once: true });
  else syncHash();
})();
