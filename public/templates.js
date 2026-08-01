(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const dialog = $('#template-dialog'), previewDialog = $('#template-preview-dialog'), form = $('#template-form');
  let templates = [], editing = null, previewing = null, folder = '';
  const safe = value => { const node = document.createElement('span'); node.textContent = value == null ? '' : String(value); return node.innerHTML; };
  const api = async (path, options = {}) => { const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Request gagal'); return data; };
  const report = message => { const node = $('#template-results'); node.textContent = message; };

  async function load() {
    const query = new URLSearchParams(), search = $('#template-search').value.trim(), category = $('#template-category').value, state = $('#template-state').value;
    if (search) query.set('search', search); if (category) query.set('category', category); if (folder) query.set('folder', folder);
    query.set('archived', String(state === 'archived')); if (state === 'favorite') query.set('favorite', 'true');
    templates = await api(`/api/templates?${query}`); render();
  }
  function render() {
    const categories = [...new Set(templates.map(item => item.category))].sort(), current = $('#template-category').value;
    $('#template-category').innerHTML = '<option value="">Semua kategori</option>' + categories.map(value => `<option>${safe(value)}</option>`).join(''); $('#template-category').value = current;
    const folders = [...new Set(templates.map(item => item.folder).filter(Boolean))].sort();
    $('#template-folders').innerHTML = `<button class="text-button" data-folder="">Semua folder</button>` + folders.map(value => `<button class="text-button" data-folder="${safe(value)}">▱ ${safe(value)}</button>`).join('');
    report(`${templates.length} template`); $('#template-list').innerHTML = templates.map(card).join('') || '<div class="project-empty"><h2>Belum ada template</h2><p>Ubah filter atau buat template baru.</p></div>';
  }
  function card(item) {
    const customActions = item.preset ? '<button data-action="duplicate">Duplicate to Custom</button>' : '<button data-action="edit">Edit</button><button data-action="duplicate">Duplicate</button><button data-action="move">Move to Folder</button><button data-action="delete" class="danger">Delete</button>';
    return `<article class="template-card" data-id="${item.id}"><div class="template-card-top"><span class="status-pill">${safe(item.target_ai)}</span><div><button data-action="favorite" title="Favorite" aria-pressed="${item.favorite}">${item.favorite ? '★' : '☆'}</button><button data-action="menu" title="Actions">•••</button></div></div><h2>${safe(item.name)}</h2><p>${safe(item.description || item.prompt.slice(0, 100))}</p><div class="template-tags">${item.tags.map(tag => `<span>${safe(tag)}</span>`).join('')}</div><dl><div><dt>Provider</dt><dd>${safe(item.provider)}</dd></div><div><dt>Model</dt><dd>${safe(item.model)}</dd></div><div><dt>Version</dt><dd>v${item.version}</dd></div></dl><div class="template-actions"><button data-action="preview" class="outline">Preview</button><button data-action="use">✦ Generate</button></div><div class="template-menu hidden"><button data-action="preview">Preview</button><button data-action="use">Use</button>${customActions}<button data-action="export">Export JSON</button></div></article>`;
  }
  const itemFor = target => templates.find(item => item.id === Number(target.closest('.template-card')?.dataset.id));
  $('#template-manager').addEventListener('click', async event => {
    const button = event.target.closest('[data-action],[data-folder]'); if (!button) return;
    if (button.dataset.folder !== undefined) { folder = button.dataset.folder; return load(); }
    const item = itemFor(button); if (!item) return; const action = button.dataset.action;
    try {
      if (action === 'menu') return button.closest('.template-card').querySelector('.template-menu').classList.toggle('hidden');
      if (action === 'preview') return showPreview(await api(`/api/templates/${item.id}`));
      if (action === 'use') return useTemplate(item);
      if (action === 'edit') return open(item);
      if (action === 'favorite') await api(`/api/templates/${item.id}`, { method: 'PUT', body: JSON.stringify({ favorite: !item.favorite }) });
      if (action === 'duplicate') await api(`/api/templates/${item.id}/duplicate`, { method: 'POST' });
      if (action === 'move') { const next = prompt('Nama folder tujuan', item.folder || ''); if (next === null) return; await api(`/api/templates/${item.id}`, { method: 'PUT', body: JSON.stringify({ folder: next.trim() }) }); }
      if (action === 'export') return exportJson(item);
      if (action === 'delete') { if (!confirm(`Hapus template custom “${item.name}”?`)) return; await api(`/api/templates/${item.id}`, { method: 'DELETE' }); }
      await load();
    } catch (error) { alert(error.message); }
  });
  function detail(label, value) { const rendered = Array.isArray(value) ? value.join(', ') : value; return `<div><dt>${label}</dt><dd>${safe(rendered || '—')}</dd></div>`; }
  function showPreview(item) {
    previewing = item; $('#template-preview-title').textContent = item.name;
    $('#template-preview-content').innerHTML = `<p>${safe(item.description || '—')}</p><dl class="result-metadata">${detail('Category', item.category)}${detail('Output type', item.target_ai)}${detail('Provider', item.provider)}${detail('Model', item.model)}${detail('Duration', item.duration)}${detail('Resolution', item.resolution)}${detail('Aspect ratio', item.aspect_ratio)}${detail('Platform', item.platform)}${detail('Style', item.style)}${detail('Voice', item.voice)}${detail('Reference assets', [...(item.referenceImages || []), ...(item.assets || []).map(asset => asset.url)])}${detail('Tags', item.tags)}${detail('Version', `v${item.version}`)}<div class="wide"><dt>Prompt</dt><dd><pre>${safe(item.prompt)}</pre></dd></div><div class="wide"><dt>Negative prompt</dt><dd><pre>${safe(item.negative_prompt || '—')}</pre></dd></div></dl>`;
    previewDialog.showModal();
  }
  previewDialog.addEventListener('click', async event => { const action = event.target.closest('[data-template-preview-action]')?.dataset.templatePreviewAction; if (!action) return; try { if (action === 'close') return previewDialog.close(); if (action === 'use') return useTemplate(previewing); if (action === 'export') return exportJson(previewing); if (action === 'duplicate') { await api(`/api/templates/${previewing.id}/duplicate`, { method: 'POST' }); previewDialog.close(); await load(); } } catch (error) { alert(error.message); } });
  function exportJson(item) { const blob = new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' }), link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${item.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); }
  async function useTemplate(item) {
    const draft = await api(`/api/templates/${item.id}/use`, { method: 'POST' }); localStorage.setItem('template.active-draft', JSON.stringify(draft));
    if (draft.destination === 'studio') { document.querySelector('[data-studio-type="video"]')?.click(); $('#studio-prompt').value = item.prompt; $('#studio-negative-prompt').value = item.negative_prompt || ''; if (item.resolution) $('#studio-resolution').value = item.resolution; if (item.model) $('#studio-model').value = item.model; }
    if (draft.destination === 'generator') { const editor = $('#generated-prompt'); editor.value = item.prompt; editor.dispatchEvent(new Event('input', { bubbles: true })); }
    if (draft.destination === 'factory') { const factory = $('#factory-form'); factory.elements.topic.value = item.prompt; if (item.platform) factory.elements.platform.value = item.platform; if (item.style) factory.elements.style.value = item.style; }
    if (draft.destination === 'workflow') { localStorage.setItem('ai-ads-lab-workflow-v1', JSON.stringify({ id: crypto.randomUUID?.() || String(Date.now()), currentStep: 0, status: 'Draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), data: { project: { name: item.name, product: item.category, goal: item.description }, consistency: { style: item.style, voice: item.voice }, studio: {}, generator: { prompt: item.prompt }, provider: { provider: item.provider, model: item.model }, queue: {}, integration: { templateId: item.id } } })); }
    previewDialog.open && previewDialog.close(); const hashes = { studio: '#studio', generator: '#prompt-generator', factory: '#content-factory', workflow: '#workflow' }; location.hash = hashes[draft.destination]; if (draft.destination === 'workflow') return location.reload(); document.querySelector(`[href="${hashes[draft.destination]}"]`)?.click();
  }
  function open(item) { editing = item?.id || null; form.reset(); $('#template-dialog-title').textContent = item ? 'Edit Template' : 'Create Template'; if (item) for (const [name, value] of Object.entries({ ...item, targetAI: item.target_ai, negativePrompt: item.negative_prompt, aspectRatio: item.aspect_ratio, tags: item.tags.join(', '), variables: JSON.stringify(item.variables, null, 2), referenceImages: JSON.stringify(item.referenceImages || [], null, 2) })) if (form.elements[name] && value != null) form.elements[name].value = value; $('#template-form-error').textContent = ''; dialog.showModal(); }
  $('#template-create').onclick = () => open(); $('#template-close').onclick = $('#template-cancel').onclick = () => dialog.close();
  $('#template-search').oninput = () => { clearTimeout(load.timer); load.timer = setTimeout(load, 200); }; $('#template-category').onchange = $('#template-state').onchange = load;
  form.onsubmit = async event => { event.preventDefault(); try { const data = Object.fromEntries(new FormData(form)); data.tags = data.tags.split(',').map(value => value.trim()).filter(Boolean); data.variables = data.variables.trim() ? JSON.parse(data.variables) : {}; data.referenceImages = data.referenceImages.trim() ? JSON.parse(data.referenceImages) : []; if (!Array.isArray(data.referenceImages)) throw new Error('Reference assets harus berupa JSON array'); if (data.duration) data.duration = Number(data.duration); await api(editing ? `/api/templates/${editing}` : '/api/templates', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(data) }); dialog.close(); await load(); } catch (error) { $('#template-form-error').textContent = error.message; } };
  $('#template-import').onclick = () => $('#template-import-file').click(); $('#template-import-file').onchange = async event => { const file = event.target.files[0]; if (!file) return; try { const value = JSON.parse(await file.text()); await api('/api/templates/import', { method: 'POST', body: JSON.stringify(value) }); await load(); report('Template berhasil diimpor.'); } catch (error) { alert(`Import gagal: ${error.message}`); } finally { event.target.value = ''; } };
  load().catch(error => { $('#template-list').innerHTML = `<p class="auth-error">${safe(error.message)}</p>`; });
})();
