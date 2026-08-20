(() => {
  // Compatibility note: persistence formerly called localStorage.setItem here;
  // Milestone 10 delegates that operation to LocalStorageAdapter instead.
  const storageKey = 'ai-ads-lab-projects-v1';
  const $ = selector => document.querySelector(selector);
  const workspace = $('#project-workspace');
  const detail = $('#project-detail');
  const placeholder = $('#workspace-placeholder');
  const studio = $('#legacy-studio');
  const contentStudio = $('#content-studio');
  const consistency = $('#consistency-engine');
  const workflow = $('#workflow-orchestrator');
  const factory = $('#content-factory');
  const generator = $('#prompt-generator');
  const providers = $('#ai-providers');
  const queue = $('#generation-queue');
  const integration = $('#ai-integration');
  const profile = $('#profile-workspace');
  const templates = $('#template-manager');
  const dialog = $('#project-dialog');
  const form = $('#project-form');
  const deleteDialog = $('#delete-project-dialog');
  const filters = ['#filter-status', '#filter-category', '#filter-brand', '#filter-date'].map($);
  let projects = readProjects();
  let editingId = null;
  let deletingId = null;
  let submitting = false;

  function readProjects() {
    try {
      const value = window.BackendFoundation?.storage.get(storageKey, []) ?? [];
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  }
  function saveProjects() { window.BackendFoundation.storage.set(storageKey, projects); window.BackendFoundation.SyncManager.sync('projects'); }
  async function api(url, options = {}) { const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || 'Permintaan project gagal'); return data; }
  function notify(message, error = false) { const toast = $('#project-toast'); toast.textContent = message; toast.classList.toggle('error', error); toast.classList.add('show'); clearTimeout(notify.timer); notify.timer = setTimeout(() => toast.classList.remove('show'), 3500); }
  function safe(value) { const node = document.createElement('span'); node.textContent = value || ''; return node.innerHTML; }
  function dateLabel(value) { return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)); }
  function relativeLabel(value) {
    const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
    if (days <= 0) return 'Hari ini';
    if (days === 1) return 'Kemarin';
    if (days < 30) return `${days} hari lalu`;
    return dateLabel(value);
  }
  function initials(name) { return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase(); }
  function projectCard(project) {
    return `<article class="project-card" data-project-id="${project.id}" tabindex="0">
      <div class="project-thumbnail" aria-hidden="true"><span>${safe(initials(project.name))}</span><i></i><i></i></div>
      <div class="project-card-body"><div class="project-card-top"><span class="status-pill status-${safe(project.status.toLowerCase())}"><i></i>${safe(project.status)}</span><div class="project-menu-wrap"><button class="project-menu" type="button" aria-label="Opsi untuk ${safe(project.name)}" aria-expanded="false">•••</button><div class="project-card-menu hidden"><button type="button" data-edit-project>Edit project</button><button type="button" class="danger-text" data-delete-project>Delete project</button></div></div></div>
      <h2>${safe(project.name)}</h2><p class="project-product"><strong>${safe(project.brand)}</strong> · ${safe(project.product)}</p>
      <span class="category-label">${safe(project.category)}</span>
      <div class="project-counts"><span><b>${project.promptCount || 0}</b> Prompt</span><span><b>${project.storyboardCount || 0}</b> Storyboard</span></div>
      <div class="project-dates"><span>Dibuat ${dateLabel(project.createdAt)}</span><span>Diubah ${relativeLabel(project.updatedAt)}</span></div></div>
    </article>`;
  }
  function updateFilterOptions() {
    [['#filter-category', 'category'], ['#filter-brand', 'brand']].forEach(([selector, key]) => {
      const select = $(selector); const current = select.value;
      const first = select.options[0].outerHTML;
      const values = [...new Set(projects.map(project => project[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
      select.innerHTML = first + values.map(value => `<option>${safe(value)}</option>`).join('');
      select.value = values.includes(current) ? current : '';
    });
  }
  function renderProjects() {
    updateFilterOptions();
    const query = $('#project-search').value.trim().toLocaleLowerCase('id');
    const [status, category, brand, date] = filters.map(input => input.value);
    const activeCount = filters.filter(input => input.value).length;
    $('#active-filter-count').textContent = activeCount;
    $('#active-filter-count').classList.toggle('hidden', !activeCount);
    const visible = projects.filter(project => {
      const searchable = `${project.name} ${project.brand} ${project.product}`.toLocaleLowerCase('id');
      return (!query || searchable.includes(query)) && (!status || project.status === status) && (!category || project.category === category) && (!brand || project.brand === brand) && (!date || project.createdAt.slice(0, 10) === date);
    });
    $('#project-results-label').textContent = projects.length ? `${visible.length} dari ${projects.length} project` : '';
    if (!projects.length) {
      $('#project-list').innerHTML = `<div class="project-empty"><div class="empty-illustration" aria-hidden="true"><span>✦</span><i></i><i></i><i></i></div><h2>Mulai workspace pertama Anda</h2><p>Buat project untuk mengumpulkan prompt, storyboard, aset, dan ide konten dalam satu tempat.</p><button type="button" data-create-project>＋ Create Project</button></div>`;
    } else if (!visible.length) {
      $('#project-list').innerHTML = `<div class="project-empty compact"><div class="empty-illustration small" aria-hidden="true"><span>⌕</span></div><h2>Project tidak ditemukan</h2><p>Coba kata kunci lain atau reset filter yang aktif.</p><button class="outline" type="button" data-reset-projects>Reset pencarian</button></div>`;
    } else $('#project-list').innerHTML = visible.map(projectCard).join('');
    document.querySelectorAll('[data-create-project]').forEach(button => button.onclick = openDialog);
    document.querySelectorAll('[data-reset-projects]').forEach(button => button.onclick = resetFilters);
    document.querySelectorAll('[data-project-id]').forEach(card => {
      card.onclick = event => {
        const menuButton = event.target.closest('.project-menu');
        if (menuButton) { event.stopPropagation(); const menu = menuButton.nextElementSibling; const opening = menu.classList.contains('hidden'); closeMenus(); if (opening) { menu.classList.remove('hidden'); menuButton.setAttribute('aria-expanded', 'true'); } return; }
        if (event.target.closest('[data-edit-project]')) { event.stopPropagation(); closeMenus(); return openEditDialog(card.dataset.projectId); }
        if (event.target.closest('[data-delete-project]')) { event.stopPropagation(); closeMenus(); return openDeleteDialog(card.dataset.projectId); }
        if (!event.target.closest('.project-card-menu')) openProject(card.dataset.projectId);
      };
      card.onkeydown = event => { if (event.key === 'Enter' && !event.target.closest('.project-menu-wrap')) openProject(card.dataset.projectId); };
    });
  }
  function closeMenus() { document.querySelectorAll('.project-card-menu').forEach(menu => menu.classList.add('hidden')); document.querySelectorAll('.project-menu').forEach(button => button.setAttribute('aria-expanded', 'false')); }
  function showView(view, title) {
    workspace.classList.toggle('hidden', view !== 'projects');
    detail.classList.toggle('hidden', view !== 'detail');
    studio.classList.toggle('hidden', view !== 'legacy');
    contentStudio.classList.toggle('hidden', view !== 'studio');
    placeholder.classList.toggle('hidden', view !== 'placeholder');
    consistency.classList.toggle('hidden', view !== 'consistency');
    workflow.classList.toggle('hidden', view !== 'workflow');
    factory.classList.toggle('hidden', view !== 'factory');
    generator.classList.toggle('hidden', view !== 'generator');
    providers.classList.toggle('hidden', view !== 'providers');
    queue.classList.toggle('hidden', view !== 'queue');
    integration.classList.toggle('hidden', view !== 'integration');
    profile.classList.toggle('hidden', view !== 'profile');
    templates.classList.toggle('hidden', view !== 'templates');
    document.querySelector('#asset-manager').classList.toggle('hidden', view !== 'assets');
    document.querySelector('#storage-settings').classList.toggle('hidden', view !== 'storage');
    if (view === 'placeholder') $('#placeholder-title').textContent = title;
    const legacyHeadings = { 'trend-reference': 'Referensi Tren', 'schedule-dashboard': 'Jadwal', 'history-section': 'Riwayat' };
    const heading = view === 'factory' ? 'AI Content Factory' : view === 'assets' ? 'Asset Manager' : view === 'storage' ? 'Storage Settings' : view === 'templates' ? 'Template Manager' : view === 'projects' ? 'Project Workspace' : view === 'profile' ? 'Workspace Profile' : view === 'studio' ? 'Dashboard Konten' : view === 'legacy' ? legacyHeadings[title] || 'Content Studio' : view === 'workflow' ? 'Workflow Orchestrator' : view === 'consistency' ? 'Consistency Engine' : view === 'generator' ? 'Prompt Generator' : view === 'providers' ? 'AI Providers' : view === 'queue' ? 'Generation Queue' : view === 'integration' ? 'AI Integration' : title || 'Project Detail';
    document.querySelector('.topbar-title strong').textContent = heading;
    document.querySelectorAll('.side-nav a').forEach(link => link.classList.toggle('active', (link.dataset.workspaceView === view && (view !== 'legacy' || link.dataset.legacySection === title)) || (view === 'placeholder' && link.dataset.placeholderView === title)));
    if (view === 'legacy' && title) requestAnimationFrame(() => document.getElementById(title)?.scrollIntoView({ block: 'start' }));
  }
  function openDialog() { editingId = null; form.reset(); $('#project-dialog-title').textContent = 'Create Project'; $('#project-status-field').classList.add('hidden'); $('#save-project').textContent = 'Buat Project'; $('#project-form-error').textContent = ''; $('#description-count').textContent = '0'; dialog.showModal(); setTimeout(() => $('#project-name').focus(), 0); }
  function openEditDialog(id) { const project = projects.find(item => item.id === id); if (!project) return; editingId = id; form.reset(); for (const key of ['name', 'brand', 'product', 'category', 'description', 'status']) if (form.elements[key]) form.elements[key].value = project[key] || ''; $('#project-dialog-title').textContent = 'Edit project'; $('#project-status-field').classList.remove('hidden'); $('#save-project').textContent = 'Save Changes'; $('#project-form-error').textContent = ''; $('#description-count').textContent = String(project.description?.length || 0); dialog.showModal(); setTimeout(() => $('#project-name').focus(), 0); }
  function closeDialog() { dialog.close(); }
  function openDeleteDialog(id) { deletingId = id; $('#delete-project-error').textContent = ''; deleteDialog.showModal(); }
  function resetFilters() { $('#project-search').value = ''; filters.forEach(input => { input.value = ''; }); renderProjects(); }
  function openProject(id) {
    const project = projects.find(item => item.id === id); if (!project) return;
    const modules = [['▤','Storyboards'],['⌘','Prompt'],['♙','Character'],['◇','Product'],['▧','Image'],['▶','Video'],['◉','Voice'],['□','Assets'],['≡','Notes'],['↺','Riwayat']];
    $('#project-detail-content').innerHTML = `<div class="detail-hero"><div class="detail-thumbnail">${safe(initials(project.name))}</div><div><span class="status-pill status-${safe(project.status.toLowerCase())}"><i></i>${safe(project.status)}</span><h1 id="project-detail-title">${safe(project.name)}</h1><p><strong>${safe(project.brand)}</strong> · ${safe(project.product)} · ${safe(project.category)}</p></div><button class="outline" type="button" data-open-studio>✦ Buka Content Studio</button></div>
      <div class="project-tabs" role="tablist" aria-label="Navigasi project"><button class="project-tab active" role="tab" aria-selected="true" data-project-tab="overview">Overview</button><button class="project-tab" role="tab" aria-selected="false" data-project-tab="prompts">Prompt Studio</button></div>
      <div id="project-overview-panel"><div class="project-overview"><div><small>DESKRIPSI</small><p>${safe(project.description) || 'Belum ada deskripsi untuk project ini.'}</p></div><div class="overview-dates"><span><small>DIBUAT</small>${dateLabel(project.createdAt)}</span><span><small>TERAKHIR DIUBAH</small>${relativeLabel(project.updatedAt)}</span></div></div>
      <div class="module-heading"><div><span class="eyebrow">PROJECT SPACE</span><h2>Ruang Kerja</h2></div><p>Semua kebutuhan produksi konten project ini akan tersedia di sini.</p></div>
      <div class="module-grid">${modules.map(([icon, name]) => `<article class="module-card"><span aria-hidden="true">${icon}</span><div><h3>${name}</h3><p>Siap untuk milestone berikutnya</p></div><small>0</small></article>`).join('')}</div></div><div id="prompt-studio-panel" class="hidden"></div>`;
    $('[data-open-studio]').onclick = () => { showView('studio'); location.hash = 'studio'; };
    document.querySelectorAll('[data-project-tab]').forEach(tab => tab.onclick = () => {
      const prompts = tab.dataset.projectTab === 'prompts';
      document.querySelectorAll('[data-project-tab]').forEach(item => { item.classList.toggle('active', item === tab); item.setAttribute('aria-selected', String(item === tab)); });
      $('#project-overview-panel').classList.toggle('hidden', prompts); $('#prompt-studio-panel').classList.toggle('hidden', !prompts);
      if (prompts) window.PromptStudio.mount(project.id, $('#prompt-studio-panel'), count => { project.promptCount = count; project.updatedAt = new Date().toISOString(); saveProjects(); });
    });
    showView('detail', project.name); location.hash = `project-${id}`;
  }

  $('#create-project-button').onclick = openDialog;
  $('#close-project-dialog').onclick = closeDialog;
  $('#cancel-project').onclick = closeDialog;
  dialog.onclick = event => { if (event.target === dialog) closeDialog(); };
  $('#project-description').oninput = event => { $('#description-count').textContent = event.target.value.length; };
  form.onsubmit = async event => {
    event.preventDefault();
    if (submitting || !form.reportValidity()) return;
    const data = new FormData(form); const payload = Object.fromEntries(data); payload.name = payload.name.trim();
    if (!payload.name) return form.elements.name.setCustomValidity('Nama project wajib diisi'), form.reportValidity();
    submitting = true; const button = $('#save-project'); const oldText = button.textContent; button.disabled = true; button.textContent = editingId ? 'Menyimpan…' : 'Membuat…'; $('#project-form-error').textContent = '';
    try {
      const project = await api(editingId ? `/api/projects/${editingId}` : '/api/projects', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      const index = projects.findIndex(item => item.id === project.id); if (index >= 0) projects[index] = project; else projects.unshift(project);
      saveProjects(); renderProjects(); closeDialog(); notify(editingId ? 'Project berhasil diperbarui.' : 'Project berhasil dibuat.');
    } catch (error) { $('#project-form-error').textContent = error.message; }
    finally { submitting = false; button.disabled = false; button.textContent = oldText; }
  };
  form.elements.name.addEventListener('input', () => form.elements.name.setCustomValidity(''));
  $('#cancel-delete-project').onclick = () => deleteDialog.close();
  deleteDialog.onclick = event => { if (event.target === deleteDialog && !submitting) deleteDialog.close(); };
  deleteDialog.querySelector('form').onsubmit = async event => { event.preventDefault(); if (submitting || !deletingId) return; submitting = true; const button = $('#confirm-delete-project'); button.disabled = true; button.textContent = 'Menghapus…'; $('#delete-project-error').textContent = ''; try { await api(`/api/projects/${deletingId}`, { method: 'DELETE' }); projects = projects.filter(project => project.id !== deletingId); saveProjects(); renderProjects(); deleteDialog.close(); notify('Project berhasil dihapus.'); deletingId = null; } catch (error) { $('#delete-project-error').textContent = error.message; } finally { submitting = false; button.disabled = false; button.textContent = 'Hapus project'; } };
  document.addEventListener('click', event => { if (!event.target.closest('.project-menu-wrap')) closeMenus(); });
  $('#toggle-project-filters').onclick = () => { const open = $('#project-filters').classList.toggle('hidden'); $('#toggle-project-filters').setAttribute('aria-expanded', String(!open)); };
  $('#reset-project-filters').onclick = resetFilters;
  $('#project-search').oninput = renderProjects; filters.forEach(input => input.onchange = renderProjects);
  $('#back-to-projects').onclick = () => { showView('projects'); renderProjects(); location.hash = 'projects'; };
  document.querySelectorAll('[data-back-projects]').forEach(button => button.onclick = () => { showView('projects'); location.hash = 'projects'; });
  document.querySelectorAll('[data-workspace-view]').forEach(link => link.addEventListener('click', () => showView(link.dataset.workspaceView, link.dataset.legacySection)));
  document.querySelectorAll('[data-placeholder-view]').forEach(link => link.addEventListener('click', () => showView('placeholder', link.dataset.placeholderView)));
  const legacyHash = () => ['trend-reference', 'schedule-dashboard', 'history-section'].find(id => location.hash === `#${id}`);
  const viewFromHash = () => legacyHash() ? 'legacy' : location.hash === '#content-factory' ? 'factory' : location.hash === '#assets' ? 'assets' : location.hash === '#storage' ? 'storage' : location.hash === '#templates' ? 'templates' : ['#profile', '#settings'].includes(location.hash) ? 'profile' : location.hash === '#workflow' ? 'workflow' : location.hash === '#studio' ? 'studio' : location.hash === '#consistency' ? 'consistency' : location.hash === '#prompt-generator' ? 'generator' : location.hash === '#ai-providers' ? 'providers' : location.hash === '#generation-queue' ? 'queue' : location.hash === '#ai-integration' ? 'integration' : 'projects';
  const showHashView = () => showView(viewFromHash(), legacyHash());
  window.addEventListener('hashchange', showHashView);
  async function loadProjects() { try { const remote = await api('/api/projects'); if (remote.length) projects = remote; else if (projects.length) projects = await Promise.all(projects.map(project => api('/api/projects', { method: 'POST', body: JSON.stringify(project) }))); saveProjects(); renderProjects(); } catch (error) { notify(error.message, true); } }
  renderProjects(); showHashView(); loadProjects();
})();
