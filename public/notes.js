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
      .notes-list{display:grid;gap:0;border:2px solid var(--neo-line,#20263a);border-radius:18px;overflow:hidden;background:var(--neo-white,#fff);box-shadow:3px 4px 0 rgba(21,27,43,.10)}
      .notes-list-item{display:flex;align-items:center;padding:14px 18px;cursor:pointer;border-bottom:1.5px solid var(--neo-line,#e5e7eb);transition:background .15s}
      .notes-list-item:last-child{border-bottom:none}
      .notes-list-item:hover,.notes-list-item:focus-visible{background:var(--neo-soft,#f6f3ea)}
      .notes-list-item h3{margin:0;font-size:.95rem;font-weight:700;line-height:1.4;overflow-wrap:anywhere;flex:1 1 auto}
      .notes-list-item .notes-list-arrow{flex:0 0 auto;margin-left:12px;color:var(--neo-muted,#687386);font-size:1.1rem}
      .notes-empty{padding:32px 18px;text-align:center;border:2px dashed var(--neo-line,#20263a);border-radius:18px;color:var(--neo-muted,#687386);background:var(--neo-white,#fff)}
      .notes-status{min-height:20px;font-size:.78rem;font-weight:800;color:var(--neo-muted,#687386)}
      .notes-status.error{color:#b42318}
      .notes-detail{display:grid;gap:16px;width:100%;min-width:0}
      .notes-detail-header{display:flex;align-items:center;gap:12px;padding:16px 20px;border:2px solid var(--neo-line,#20263a);border-radius:20px;background:var(--neo-white,#fff);box-shadow:4px 5px 0 rgba(21,27,43,.12)}
      .notes-detail-back{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border:2px solid var(--neo-line,#20263a);border-radius:12px;background:var(--neo-white,#fff);cursor:pointer;flex:0 0 auto;font-size:1.2rem;transition:background .15s}
      .notes-detail-back:hover{background:var(--neo-soft,#f6f3ea)}
      .notes-detail-title-group{flex:1 1 auto;min-width:0}
      .notes-detail-title-group h1{margin:0;font-size:clamp(1.2rem,3vw,1.6rem);line-height:1.2;overflow-wrap:anywhere}
      .notes-detail-title-group time{display:block;margin-top:4px;color:var(--neo-muted,#687386);font-size:.78rem}
      .notes-detail-content{padding:18px;border:2px solid var(--neo-line,#20263a);border-radius:18px;background:var(--neo-white,#fff);box-shadow:3px 4px 0 rgba(21,27,43,.10)}
      .notes-detail-content pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:.88rem;line-height:1.6;color:var(--neo-muted,#566174);background:var(--neo-soft,#f6f3ea);border:1.5px solid var(--neo-line,#20263a);border-radius:13px;padding:14px}
      .notes-detail-actions{display:flex;gap:10px;flex-wrap:wrap}
      .notes-detail-actions button{flex:1 1 auto;min-width:90px;padding:12px 16px;min-height:48px}
      .notes-detail-delete{margin-top:8px}
      .notes-detail-delete button{min-height:44px;padding:10px 16px}
      @media(max-width:720px){.notes-heading{align-items:flex-start;padding:16px}.notes-heading p{font-size:.86rem}.notes-count{min-width:auto}.notes-toolbar{align-items:stretch}.notes-toolbar button{width:auto}.notes-list-item{padding:12px 14px}.notes-detail-header{padding:14px 16px}.notes-detail-content pre{font-size:.84rem;padding:12px}}
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
          <div><span class="eyebrow">PROMPT NOTES</span><h1 id="notes-title">Notes</h1><p>Prompt yang disimpan tersusun rapi di VPS dan tetap tersedia setelah halaman dimuat ulang.</p></div>
          <span class="notes-count" id="notes-count">0 Notes</span>
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
    $('#notes-count').textContent = `${notes.length} Notes`;
    const grid = $('#notes-grid');
    grid.innerHTML = list.length ? list.map(note => `
      <div class="notes-list-item" tabindex="0" role="button" data-note-open="${safe(note.id)}" aria-label="${safe(note.title)}">
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
      if (name === 'copy') {
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
    status('Memuat Notes…');
    try {
      notes = await api('/api/notes');
      renderList();
      status(notes.length ? 'Notes tersinkron dengan VPS.' : 'Belum ada prompt tersimpan.');
    } catch (error) { status(error.message, true); }
  }

  async function save(content, source = 'prompt-generator') {
    const prompt = String(content || '').trim();
    if (!prompt) throw new Error('Prompt tidak boleh kosong.');
    const note = await api('/api/notes', { method: 'POST', body: JSON.stringify({ content: prompt, source }) });
    notes = [note, ...notes.filter(item => item.id !== note.id)];
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
