(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PromptStudio = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const STORAGE_KEY = 'ai-ads-lab-prompts-v1';
  const categories = ['Storyboard', 'Character', 'Product', 'Image', 'Video', 'Voice', 'Caption', 'Custom'];
  const targets = ['Google Flow', 'Google Omni', 'Veo', 'Vidu', 'Kling', 'ChatGPT', 'Gemini', 'Claude', 'Custom'];
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const normalizeTags = value => [...new Set(String(value || '').split(',').map(tag => tag.trim()).filter(Boolean))];
  function filterPrompts(prompts, { query = '', category = '', target = '', favorite = false } = {}) {
    const needle = query.trim().toLocaleLowerCase('id');
    return prompts.filter(prompt => {
      const searchable = `${prompt.title} ${(prompt.tags || []).join(' ')} ${prompt.category} ${prompt.target}`.toLocaleLowerCase('id');
      return (!needle || searchable.includes(needle)) && (!category || prompt.category === category) && (!target || prompt.target === target) && (!favorite || prompt.favorite);
    });
  }
  function addVersion(prompt, content, notes, tags, now = new Date().toISOString()) {
    const versions = Array.isArray(prompt.versions) ? prompt.versions : [];
    return { ...prompt, content, notes, tags: normalizeTags(tags), version: versions.length + 1, versions: [...versions, { version: versions.length + 1, content, notes, tags: normalizeTags(tags), createdAt: now }], updatedAt: now };
  }
  function readAll(storage) { try { const data = JSON.parse(storage.getItem(STORAGE_KEY) || '{}'); return data && typeof data === 'object' ? data : {}; } catch (_) { return {}; } }
  function mount(projectId, container, onCountChange) {
    const storage = window.localStorage; let all = readAll(storage); let prompts = Array.isArray(all[projectId]) ? all[projectId] : []; let selectedId = null;
    const dialog = document.querySelector('#prompt-dialog'); const form = document.querySelector('#prompt-form');
    const safe = value => { const node = document.createElement('span'); node.textContent = value || ''; return node.innerHTML; };
    const attr = value => safe(value).replaceAll('&quot;', '&#34;').replaceAll('\"', '&quot;');
    const persist = () => { all[projectId] = prompts; storage.setItem(STORAGE_KEY, JSON.stringify(all)); onCountChange?.(prompts.length); };
    const options = values => values.map(value => `<option>${value}</option>`).join('');
    document.querySelector('#prompt-category').innerHTML = options(categories); document.querySelector('#prompt-target').innerHTML = options(targets);
    container.innerHTML = `<div class="prompt-heading"><div><span class="eyebrow">PROMPT STUDIO</span><h2>Prompt Studio</h2><p>Susun, simpan, dan kembangkan prompt untuk setiap target AI.</p></div><button data-create-prompt type="button">＋ Create Prompt</button></div>
      <div class="prompt-toolbar"><label class="project-search"><span aria-hidden="true">⌕</span><span class="sr-only">Cari prompt</span><input data-prompt-search type="search" placeholder="Cari judul, tag, kategori, atau target AI…"></label><select data-prompt-category aria-label="Filter kategori"><option value="">Semua kategori</option>${options(categories)}</select><select data-prompt-target aria-label="Filter target AI"><option value="">Semua target AI</option>${options(targets)}</select><label class="favorite-filter"><input data-prompt-favorite type="checkbox"> ★ Favorite</label></div>
      <p class="results-label" data-prompt-results aria-live="polite"></p><div data-prompt-list></div><div data-prompt-editor></div>`;
    const $ = selector => container.querySelector(selector);
    function renderList() {
      const visible = filterPrompts(prompts, { query: $('[data-prompt-search]').value, category: $('[data-prompt-category]').value, target: $('[data-prompt-target]').value, favorite: $('[data-prompt-favorite]').checked });
      $('[data-prompt-results]').textContent = `${visible.length} dari ${prompts.length} prompt`;
      if (!prompts.length) $('[data-prompt-list]').innerHTML = `<div class="prompt-empty"><span aria-hidden="true">⌘</span><h3>Belum ada prompt</h3><p>Buat prompt pertama untuk project ini dan mulai versioning secara lokal.</p><button data-empty-create type="button">Create Prompt</button></div>`;
      else if (!visible.length) $('[data-prompt-list]').innerHTML = `<div class="prompt-empty compact"><span aria-hidden="true">⌕</span><h3>Prompt tidak ditemukan</h3><p>Ubah pencarian atau filter Anda.</p></div>`;
      else $('[data-prompt-list]').innerHTML = `<div class="prompt-table"><div class="prompt-row prompt-table-head"><span></span><span>Judul</span><span>Jenis Prompt</span><span>Target AI</span><span>Versi</span><span>Status</span><span>Last Edited</span></div>${visible.map(p => `<button class="prompt-row" data-prompt-id="${p.id}" type="button"><span class="favorite-star" data-favorite="${p.id}" aria-label="Favorite">${p.favorite ? '★' : '☆'}</span><strong>${safe(p.title)}</strong><span>${safe(p.category)}</span><span>${safe(p.target)}</span><span>v${p.version || 1}</span><span class="status-pill"><i></i>${safe(p.status || 'Draft')}</span><time>${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date(p.updatedAt))}</time></button>`).join('')}</div>`;
      container.querySelectorAll('[data-prompt-id]').forEach(row => row.onclick = event => { const favorite = event.target.closest('[data-favorite]'); if (favorite) { event.stopPropagation(); const p = prompts.find(item => item.id === favorite.dataset.favorite); p.favorite = !p.favorite; persist(); renderList(); return; } selectedId = row.dataset.promptId; renderEditor(); });
      container.querySelector('[data-empty-create]')?.addEventListener('click', openCreate);
    }
    function renderEditor() {
      const p = prompts.find(item => item.id === selectedId); if (!p) return;
      $('[data-prompt-list]').classList.add('hidden'); $('.prompt-toolbar').classList.add('hidden'); $('[data-prompt-results]').classList.add('hidden');
      $('[data-prompt-editor]').innerHTML = `<div class="editor-toolbar"><button class="text-button" data-close-editor type="button">← Daftar Prompt</button><div><button class="outline" data-copy type="button">Copy Prompt</button><button class="outline" data-duplicate type="button">Duplicate</button><button class="outline" data-rename type="button">Rename</button><button class="danger" data-delete type="button">Delete</button></div></div><div class="prompt-editor-grid"><section class="prompt-editor-form"><label>Judul<input data-edit-title maxlength="100" value="${attr(p.title)}"></label><label>Prompt utama<textarea data-edit-content rows="14" placeholder="Tulis prompt utama…">${safe(p.content)}</textarea></label><label>Notes<textarea data-edit-notes rows="4" placeholder="Catatan penggunaan, angle, atau batasan…">${safe(p.notes)}</textarea></label><label>Tags<input data-edit-tags value="${attr((p.tags || []).join(', '))}" placeholder="ugc, cinematic, launch"></label><button data-save-version type="button">Simpan sebagai v${(p.version || 1) + 1}</button></section><aside class="version-history"><span class="eyebrow">VERSION HISTORY</span><h3>${safe(p.title)}</h3>${[...(p.versions || [])].reverse().map(v => `<button type="button" data-version="${v.version}"><strong>v${v.version}</strong><time>${new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v.createdAt))}</time></button>`).join('')}</aside></div>`;
      const close = () => { selectedId = null; $('[data-prompt-editor]').innerHTML = ''; $('[data-prompt-list]').classList.remove('hidden'); $('.prompt-toolbar').classList.remove('hidden'); $('[data-prompt-results]').classList.remove('hidden'); renderList(); };
      $('[data-close-editor]').onclick = close;
      $('[data-save-version]').onclick = () => { const idx = prompts.findIndex(x => x.id === p.id); prompts[idx] = addVersion({ ...p, title: $('[data-edit-title]').value.trim() || p.title }, $('[data-edit-content]').value, $('[data-edit-notes]').value, $('[data-edit-tags]').value); persist(); renderEditor(); };
      $('[data-copy]').onclick = () => { const text = $('[data-edit-content]').value; const copied = navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.reject(); copied.then(() => { $('[data-copy]').textContent = 'Copied!'; }, () => { const area = $('[data-edit-content]'); area.focus(); area.select(); document.execCommand('copy'); $('[data-copy]').textContent = 'Copied!'; }); };
      $('[data-duplicate]').onclick = () => { const now = new Date().toISOString(); prompts.unshift({ ...p, id: uid(), title: `${p.title} (Copy)`, favorite: false, createdAt: now, updatedAt: now }); persist(); close(); };
      $('[data-rename]').onclick = () => { $('[data-edit-title]').focus(); $('[data-edit-title]').select(); };
      $('[data-delete]').onclick = () => { if (window.confirm(`Hapus “${p.title}”?`)) { prompts = prompts.filter(x => x.id !== p.id); persist(); close(); } };
      container.querySelectorAll('[data-version]').forEach(button => button.onclick = () => { const v = p.versions.find(item => item.version === Number(button.dataset.version)); $('[data-edit-content]').value = v.content; $('[data-edit-notes]').value = v.notes; $('[data-edit-tags]').value = (v.tags || []).join(', '); });
    }
    function openCreate() { form.reset(); dialog.showModal(); setTimeout(() => document.querySelector('#prompt-title').focus(), 0); }
    $('[data-create-prompt]').onclick = openCreate;
    ['[data-prompt-search]', '[data-prompt-category]', '[data-prompt-target]', '[data-prompt-favorite]'].forEach(selector => $(selector).addEventListener(selector.includes('search') ? 'input' : 'change', renderList));
    document.querySelector('#close-prompt-dialog').onclick = () => dialog.close(); document.querySelector('#cancel-prompt').onclick = () => dialog.close();
    form.onsubmit = event => { event.preventDefault(); if (!form.reportValidity()) return; const data = new FormData(form); const now = new Date().toISOString(); const title = data.get('title').trim(); prompts.unshift({ id: uid(), projectId, title, category: data.get('category'), target: data.get('target'), content: '', notes: '', tags: [], favorite: false, status: 'Draft', version: 1, versions: [{ version: 1, content: '', notes: '', tags: [], createdAt: now }], createdAt: now, updatedAt: now }); persist(); dialog.close(); renderList(); };
    renderList();
  }
  return { STORAGE_KEY, categories, targets, normalizeTags, filterPrompts, addVersion, readAll, mount };
});
