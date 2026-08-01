(() => {
  const STORAGE_KEY = 'ai-ads-lab-workflow-v1';
  const HISTORY_KEY = 'ai-ads-lab-workflow-history-v1';
  const steps = [
    { id: 'project', label: 'Project', description: 'Campaign foundation' },
    { id: 'consistency', label: 'Consistency', description: 'Creative DNA' },
    { id: 'studio', label: 'Prompt Studio', description: 'Creative direction' },
    { id: 'generator', label: 'Prompt Generator', description: 'Production prompt' },
    { id: 'provider', label: 'AI Provider', description: 'Local adapter' },
    { id: 'queue', label: 'Generation Queue', description: 'Job settings' },
    { id: 'integration', label: 'AI Integration', description: 'Final review' }
  ];
  const defaults = () => ({ id: crypto.randomUUID?.() || String(Date.now()), currentStep: 0, status: 'Draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), data: { project: {}, consistency: {}, studio: {}, generator: {}, provider: {}, queue: {}, integration: {} } });
  const $ = selector => document.querySelector(selector);
  const safe = value => { const node = document.createElement('span'); node.textContent = value == null ? '' : String(value); return node.innerHTML; };
  const read = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch (_) { return fallback; } };
  let state = defaults(); let undoStack = []; let redoStack = []; let saveTimer;

  function recover() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      if (!saved?.data || !Number.isInteger(saved.currentStep)) throw new Error('Invalid workflow schema');
      state = { ...defaults(), ...saved, currentStep: Math.max(0, Math.min(steps.length - 1, saved.currentStep)) };
      $('#workflow-recovery').innerHTML = '<b>Sesi dipulihkan.</b><span>Draft terakhir dilanjutkan dari penyimpanan lokal.</span><button type="button" data-dismiss-recovery>×</button>';
      $('#workflow-recovery').classList.remove('hidden');
      $('[data-dismiss-recovery]').onclick = () => $('#workflow-recovery').classList.add('hidden');
    } catch (_) {
      localStorage.removeItem(STORAGE_KEY); state = defaults();
      $('#workflow-recovery').innerHTML = '<b>Draft rusak dipulihkan.</b><span>Data yang tidak valid diisolasi dan workflow baru dibuat.</span><button type="button" data-dismiss-recovery>×</button>';
      $('#workflow-recovery').classList.remove('hidden');
      $('[data-dismiss-recovery]').onclick = () => $('#workflow-recovery').classList.add('hidden');
    }
  }
  function snapshot() { return JSON.stringify(state); }
  function commit(previous) { undoStack.push(previous); if (undoStack.length > 50) undoStack.shift(); redoStack = []; persist(); render(); }
  function persist(immediate = false) {
    state.updatedAt = new Date().toISOString(); clearTimeout(saveTimer);
    $('#workflow-save-label').textContent = 'Menyimpan…';
    const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); $('#workflow-save-label').textContent = 'Draft tersimpan'; $('#workflow-save-time').textContent = `Disimpan ${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`; } catch (_) { $('#workflow-save-label').textContent = 'Gagal menyimpan'; showError(['Penyimpanan browser penuh. Hapus draft lama lalu coba lagi.']); } };
    if (immediate) save(); else saveTimer = setTimeout(save, 300);
  }
  function fields(step) {
    const d = state.data[step.id] || {};
    const assetPicker = ['consistency','studio','generator','provider'].includes(step.id) ? `<div class="asset-attachment workflow-assets"><div><b>Managed image assets</b><small>${(d.assetIds || []).length} attached · IDs stored, URLs resolved internally</small></div><button class="outline" type="button" data-workflow-assets>□ Select from Assets</button><div class="selected-assets">${(d.assetLabels || []).map(asset => `<span class="selected-asset"><img src="${safe(asset.previewUrl)}" alt=""><b>${safe(asset.name)}</b></span>`).join('')}</div></div>` : '';
    const input = (name, label, placeholder, required = true) => `<label>${label}<input data-workflow-field="${name}" value="${safe(d[name])}" placeholder="${placeholder}" ${required ? 'required' : ''}></label>`;
    if (step.id === 'project') return `<div class="workflow-form">${input('name','Nama project','Contoh: Launch Serum Agustus')}${input('brand','Brand','Nama brand')}${input('product','Produk','Produk atau layanan')}<label>Tujuan<textarea data-workflow-field="goal" required placeholder="Hasil campaign yang ingin dicapai">${safe(d.goal)}</textarea></label></div>`;
    if (step.id === 'consistency') return `<div class="workflow-form">${input('character','Character','Talent atau persona utama')}${input('style','Visual style','Cinematic, editorial…')}${input('voice','Brand voice','Hangat, tegas…')}<label class="workflow-checkbox"><input type="checkbox" data-workflow-field="locked" ${d.locked ? 'checked' : ''}> Kunci konsistensi di semua output</label>${assetPicker}</div>`;
    if (step.id === 'studio') return `<div class="workflow-form"><label>Creative brief<textarea data-workflow-field="brief" required placeholder="Audience, message, dan direction">${safe(d.brief)}</textarea></label>${input('hook','Hook utama','Kalimat pembuka')}${input('format','Format','UGC, tutorial, review…')}${assetPicker}</div>`;
    if (step.id === 'generator') return `<div class="workflow-form"><label>Production prompt<textarea data-workflow-field="prompt" required placeholder="Prompt siap produksi">${safe(d.prompt)}</textarea></label><label>Negative prompt<textarea data-workflow-field="negative" placeholder="Hal yang harus dihindari">${safe(d.negative)}</textarea></label>${assetPicker}</div>`;
    if (step.id === 'provider') return `<div class="workflow-form">${input('name','Provider','Mock Provider')}<label>Media<select data-workflow-field="media"><option value="text" ${d.media==='text'?'selected':''}>Text</option><option value="image" ${d.media==='image'?'selected':''}>Image</option><option value="video" ${d.media==='video'?'selected':''}>Video</option></select></label>${input('model','Model','mock-v1')}${assetPicker}</div>`;
    if (step.id === 'queue') return `<div class="workflow-form"><label>Prioritas<select data-workflow-field="priority"><option>Normal</option><option ${d.priority==='High'?'selected':''}>High</option><option ${d.priority==='Low'?'selected':''}>Low</option></select></label><label>Jumlah output<input type="number" min="1" max="10" data-workflow-field="outputs" value="${safe(d.outputs || 1)}" required></label></div>`;
    return `<div class="workflow-form"><label>System instruction<textarea data-workflow-field="system" required placeholder="Aturan final untuk mock pipeline">${safe(d.system)}</textarea></label><label class="workflow-checkbox"><input type="checkbox" data-workflow-field="reviewed" ${d.reviewed ? 'checked' : ''}> Saya sudah meninjau konfigurasi final</label></div>`;
  }
  function validate(index = state.currentStep) {
    const id = steps[index].id, d = state.data[id] || {}, errors = [];
    const required = { project: [['name','Nama project'],['brand','Brand'],['product','Produk'],['goal','Tujuan']], consistency: [['character','Character'],['style','Visual style'],['voice','Brand voice']], studio: [['brief','Creative brief'],['hook','Hook'],['format','Format']], generator: [['prompt','Production prompt']], provider: [['name','Provider'],['model','Model']], queue: [['outputs','Jumlah output']], integration: [['system','System instruction'],['reviewed','Konfirmasi review']] }[id];
    required.forEach(([key,label]) => { if (!d[key] || (key === 'reviewed' && d[key] !== true)) errors.push(`${label} wajib dilengkapi.`); });
    if (id === 'queue' && (+d.outputs < 1 || +d.outputs > 10)) errors.push('Jumlah output harus antara 1–10.');
    return errors;
  }
  function showError(errors) { $('#workflow-errors').innerHTML = `<strong>Periksa kembali tahap ini</strong><ul>${errors.map(x=>`<li>${safe(x)}</li>`).join('')}</ul>`; $('#workflow-errors').classList.toggle('hidden', !errors.length); }
  function completedCount() { return steps.filter((_, index) => validate(index).length === 0).length; }
  function renderSummary() {
    const labels = [['project','name','Project'],['project','brand','Brand'],['consistency','style','Style'],['studio','format','Format'],['provider','name','Provider'],['queue','outputs','Output']];
    $('#workflow-summary-content').innerHTML = labels.map(([group,key,label]) => `<dl><dt>${label}</dt><dd>${safe(state.data[group]?.[key] || 'Belum diisi')}</dd></dl>`).join('');
    $('#workflow-status').innerHTML = `<i></i>${safe(state.status)}`;
    $('#workflow-generate').disabled = completedCount() !== steps.length || state.status === 'Generating';
  }
  function renderHistory() {
    const history = read(HISTORY_KEY, []);
    $('#workflow-history-list').innerHTML = history.length ? history.map(item => `<article><div><b>${safe(item.name || 'Untitled workflow')}</b><p>${new Date(item.updatedAt).toLocaleString('id-ID')} · ${safe(item.status)}</p></div><button class="outline" data-resume-workflow="${safe(item.id)}" type="button">Resume</button></article>`).join('') : '<div class="empty-state"><span class="state-icon">↺</span><strong>Belum ada history</strong><p>Workflow yang dijalankan akan muncul di sini.</p></div>';
    document.querySelectorAll('[data-resume-workflow]').forEach(button => button.onclick = () => { const item = history.find(x => x.id === button.dataset.resumeWorkflow); if (item) { const previous=snapshot(); state=JSON.parse(JSON.stringify(item)); state.status='Draft'; commit(previous); } });
  }
  function render() {
    const step = steps[state.currentStep], complete = completedCount(), percent = Math.round(complete / steps.length * 100);
    $('#workflow-stepper').innerHTML = steps.map((item,index) => `<button type="button" data-workflow-step="${index}" class="${index===state.currentStep?'active':''} ${validate(index).length===0?'complete':''}" aria-current="${index===state.currentStep?'step':'false'}"><span>${validate(index).length===0?'✓':index+1}</span><b>${item.label}</b><small>${item.description}</small></button>`).join('');
    $('#workflow-panel-title').textContent=step.label; $('#workflow-state').innerHTML=fields(step); $('#workflow-position').textContent=`Langkah ${state.currentStep+1} dari ${steps.length}`; $('#workflow-previous').disabled=state.currentStep===0; $('#workflow-next').textContent=state.currentStep===steps.length-1?'Tinjau ringkasan':'Berikutnya →';
    $('#workflow-progress-text').textContent=`${percent}% selesai`; $('#workflow-progress-bar').value=percent; $('#workflow-progress-bar').textContent=`${percent}%`; $('#workflow-step-label').textContent=step.label;
    $('#workflow-undo').disabled=!undoStack.length; $('#workflow-redo').disabled=!redoStack.length; showError([]); renderSummary(); renderHistory();
    document.querySelectorAll('[data-workflow-step]').forEach(button => button.onclick=()=>{state.currentStep=+button.dataset.workflowStep;persist();render();});
    document.querySelectorAll('[data-workflow-field]').forEach(field => field.onchange=field.oninput=()=>{const previous=snapshot();state.data[step.id][field.dataset.workflowField]=field.type==='checkbox'?field.checked:field.value;undoStack.push(previous);if(undoStack.length>50)undoStack.shift();redoStack=[];persist();renderSummary();const completeNow=completedCount(), p=Math.round(completeNow/steps.length*100);$('#workflow-progress-text').textContent=`${p}% selesai`;$('#workflow-progress-bar').value=p;});
    document.querySelector('[data-workflow-assets]')?.addEventListener('click', async () => { const chosen = await window.AssetManager.select({ selectedIds: d.assetIds || [], multiple: true }); if (!chosen) return; const previous = snapshot(); state.data[step.id].assetIds = chosen.map(asset => asset.id); state.data[step.id].assetLabels = chosen; commit(previous); });
  }
  $('#workflow-previous').onclick=()=>{if(state.currentStep){state.currentStep--;persist();render();}};
  $('#workflow-next').onclick=()=>{const errors=validate();if(errors.length)return showError(errors);if(state.currentStep<steps.length-1){state.currentStep++;persist();render();}else $('#workflow-summary-title').scrollIntoView({behavior:'smooth'});};
  $('#workflow-undo').onclick=()=>{if(!undoStack.length)return;redoStack.push(snapshot());state=JSON.parse(undoStack.pop());persist();render();};
  $('#workflow-redo').onclick=()=>{if(!redoStack.length)return;undoStack.push(snapshot());state=JSON.parse(redoStack.pop());persist();render();};
  $('#workflow-generate').onclick=()=>{const all=steps.flatMap((_,i)=>validate(i));if(all.length){showError(['Lengkapi seluruh tahap sebelum generate.']);return;}state.status='Generating';renderSummary();setTimeout(()=>{state.status='Completed';const history=read(HISTORY_KEY,[]).filter(x=>x.id!==state.id);history.unshift(JSON.parse(JSON.stringify({...state,name:state.data.project.name})));localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(0,25)));persist(true);render();},700);};
  $('#workflow-new').onclick=()=>{if(!confirm('Mulai workflow baru? Draft saat ini tetap tersimpan di history.'))return;const history=read(HISTORY_KEY,[]);history.unshift({...JSON.parse(snapshot()),name:state.data.project.name||'Untitled workflow'});localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(0,25)));state=defaults();undoStack=[];redoStack=[];persist(true);render();};
  recover(); render(); persist(true);
  window.WorkflowOrchestrator={ validate:()=>steps.flatMap((_,i)=>validate(i)), getState:()=>JSON.parse(snapshot()) };
})();
