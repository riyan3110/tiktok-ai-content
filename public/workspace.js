(() => {
  // Compatibility note: persistence formerly called localStorage.setItem here;
  // Milestone 10 delegates that operation to LocalStorageAdapter instead.
  const storageKey = 'ai-ads-lab-projects-v1';
  const $ = selector => document.querySelector(selector);
  const workspace = $('#project-workspace');
  const detail = $('#project-detail');
  const placeholder = $('#workspace-placeholder');
  const studio = $('#legacy-studio');
  const consistency = $('#consistency-engine');
  const workflow = $('#workflow-orchestrator');
  const generator = $('#prompt-generator');
  const providers = $('#ai-providers');
  const queue = $('#generation-queue');
  const integration = $('#ai-integration');
  const profile = $('#profile-workspace');
  const dialog = $('#project-dialog');
  const form = $('#project-form');
  const filters = ['#filter-status', '#filter-category', '#filter-brand', '#filter-date'].map($);
  let projects = readProjects();

  function readProjects() {
    try {
      const value = window.BackendFoundation?.storage.get(storageKey, []) ?? [];
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  }
  function saveProjects() { window.BackendFoundation.storage.set(storageKey, projects); window.BackendFoundation.SyncManager.sync('projects'); }
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
      <div class="project-card-body"><div class="project-card-top"><span class="status-pill status-${safe(project.status.toLowerCase())}"><i></i>${safe(project.status)}</span><button class="project-menu" type="button" aria-label="Opsi untuk ${safe(project.name)}">•••</button></div>
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
      card.onclick = event => { if (!event.target.closest('.project-menu')) openProject(card.dataset.projectId); };
      card.onkeydown = event => { if (event.key === 'Enter') openProject(card.dataset.projectId); };
    });
  }
  function showView(view, title) {
    workspace.classList.toggle('hidden', view !== 'projects');
    detail.classList.toggle('hidden', view !== 'detail');
    studio.classList.toggle('hidden', view !== 'studio');
    placeholder.classList.toggle('hidden', view !== 'placeholder');
    consistency.classList.toggle('hidden', view !== 'consistency');
    workflow.classList.toggle('hidden', view !== 'workflow');
    generator.classList.toggle('hidden', view !== 'generator');
    providers.classList.toggle('hidden', view !== 'providers');
    queue.classList.toggle('hidden', view !== 'queue');
    integration.classList.toggle('hidden', view !== 'integration');
    profile.classList.toggle('hidden', view !== 'profile');
    if (view === 'placeholder') $('#placeholder-title').textContent = title;
    const heading = view === 'projects' ? 'Project Workspace' : view === 'profile' ? 'Profile Workspace' : view === 'studio' ? 'Dashboard Konten' : view === 'workflow' ? 'Workflow Orchestrator' : view === 'consistency' ? 'Consistency Engine' : view === 'generator' ? 'Prompt Generator' : view === 'providers' ? 'AI Providers' : view === 'queue' ? 'Generation Queue' : view === 'integration' ? 'AI Integration' : title || 'Project Detail';
    document.querySelector('.topbar-title strong').textContent = heading;
    document.querySelectorAll('.side-nav a').forEach(link => link.classList.toggle('active', link.dataset.workspaceView === view || (view === 'placeholder' && link.dataset.placeholderView === title)));
  }
  function openDialog() { form.reset(); $('#description-count').textContent = '0'; dialog.showModal(); setTimeout(() => $('#project-name').focus(), 0); }
  function closeDialog() { dialog.close(); }
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
  form.onsubmit = event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form); const now = new Date().toISOString();
    const project = { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), name: data.get('name').trim(), brand: data.get('brand').trim(), product: data.get('product').trim(), category: data.get('category'), description: data.get('description').trim(), status: 'Draft', createdAt: now, updatedAt: now, promptCount: 0, storyboardCount: 0 };
    projects.unshift(project); saveProjects(); closeDialog(); renderProjects(); openProject(project.id);
  };
  $('#toggle-project-filters').onclick = () => { const open = $('#project-filters').classList.toggle('hidden'); $('#toggle-project-filters').setAttribute('aria-expanded', String(!open)); };
  $('#reset-project-filters').onclick = resetFilters;
  $('#project-search').oninput = renderProjects; filters.forEach(input => input.onchange = renderProjects);
  $('#back-to-projects').onclick = () => { showView('projects'); renderProjects(); location.hash = 'projects'; };
  document.querySelectorAll('[data-back-projects]').forEach(button => button.onclick = () => { showView('projects'); location.hash = 'projects'; });
  document.querySelectorAll('[data-workspace-view]').forEach(link => link.addEventListener('click', () => showView(link.dataset.workspaceView)));
  document.querySelectorAll('[data-placeholder-view]').forEach(link => link.addEventListener('click', () => showView('placeholder', link.dataset.placeholderView)));
  const viewFromHash = () => location.hash === '#profile' ? 'profile' : location.hash === '#workflow' ? 'workflow' : location.hash === '#studio' ? 'studio' : location.hash === '#consistency' ? 'consistency' : location.hash === '#prompt-generator' ? 'generator' : location.hash === '#ai-providers' ? 'providers' : location.hash === '#generation-queue' ? 'queue' : location.hash === '#ai-integration' ? 'integration' : 'projects';
  window.addEventListener('hashchange', () => showView(viewFromHash()));
  renderProjects(); showView(viewFromHash());
})();
