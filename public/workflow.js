(() => {
  const STORAGE_KEY = 'ai-ads-lab-workflow-v1';
  const HISTORY_KEY = 'ai-ads-lab-workflow-history-v1';
  const PROJECTS_KEY = 'ai-ads-lab-projects-v1';
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
    if (step.id === 'project') { const projects=read(PROJECTS_KEY,[]); return `<div class="workflow-form"><label>Pilih Project<select data-workflow-project><option value="">Manual topic / project baru</option>${projects.map(project=>`<option value="${safe(project.id)}" ${d.projectId===project.id?'selected':''}>${safe(project.name)}</option>`).join('')}</select></label>${input('name','Nama workflow','Contoh: Launch Serum Agustus')}${input('brand','Brand','Nama brand')}${input('product','Produk / topik manual','Produk atau topik')}<label>Tujuan<textarea data-workflow-field="goal" required placeholder="Hasil campaign yang ingin dicapai">${safe(d.goal)}</textarea></label></div>`; }
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
    if (state.status === 'Draft' && completedCount() === steps.length) state.status = 'Ready';
    $('#workflow-status').className=`status-pill status-${state.status.toLowerCase()}`; $('#workflow-status').innerHTML = `<i></i>${safe(state.status)}`;
    $('#workflow-generate').disabled = completedCount() !== steps.length || state.status === 'Running';
  }
  function renderHistory() {
    const history = read(HISTORY_KEY, []);
    $('#workflow-history-list').innerHTML = history.length ? history.map(item => { const asset=item.data?.generator?.assetLabels?.[0]; return `<article><div class="workflow-history-thumb">${asset?.previewUrl?`<img src="${safe(asset.previewUrl)}" alt="">`:'✦'}</div><div><b>${safe(item.name || 'Untitled workflow')}</b><p>${safe(item.data?.provider?.name||'—')} · ${safe(item.data?.generator?.prompt||'Belum ada prompt')}</p><small>${new Date(item.updatedAt).toLocaleString('id-ID')} · ${safe(item.status)}</small></div><button class="outline" data-resume-workflow="${safe(item.id)}" type="button">Lihat</button></article>`; }).join('') : '<div class="empty-state"><span class="state-icon">↺</span><strong>Belum ada history</strong><p>Workflow yang dijalankan akan muncul di sini.</p></div>';
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
    document.querySelector('[data-workflow-project]')?.addEventListener('change',event=>{const project=read(PROJECTS_KEY,[]).find(item=>item.id===event.target.value);if(!project)return;const previous=snapshot();Object.assign(state.data.project,{projectId:project.id,name:project.name,brand:project.brand,product:project.product,goal:project.description||project.category});state.data.consistency.character=read('consistency.characters',[])[0]?.name||state.data.consistency.character||'';state.data.consistency.style=read('consistency.styles',[])[0]?.name||state.data.consistency.style||'';state.data.consistency.voice=read('consistency.voice',[])[0]?.name||state.data.consistency.voice||'';const preset=read('prompt.presets',[])[0];if(preset?.config)state.data.generator.prompt=preset.config.content||state.data.generator.prompt||'';commit(previous);});
    document.querySelector('[data-workflow-assets]')?.addEventListener('click', async () => { const d=state.data[step.id]||{}; const chosen = await window.AssetManager.select({ selectedIds: d.assetIds || [], multiple: true }); if (!chosen) return; attachAssets(chosen); });
  }
  function attachAssets(assets){const previous=snapshot();['consistency','studio','generator','provider'].forEach(id=>{state.data[id].assetIds=assets.map(asset=>asset.id);state.data[id].assetLabels=assets;});commit(previous);}
  function saveHistory(){const history=read(HISTORY_KEY,[]).filter(x=>x.id!==state.id);history.unshift(JSON.parse(JSON.stringify({...state,name:state.data.project.name})));localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(0,100)));}
  function renderResult(){const root=$('#workflow-result'),result=state.result;if(!result){root.classList.add('hidden');return;}const url=result.url||result.previewUrl||result.downloadUrl||'';root.classList.remove('hidden');root.innerHTML=`<div class="history-heading"><div><span class="eyebrow">RESULT VIEWER</span><h2>Hasil Workflow</h2></div><span class="status-pill status-${state.status.toLowerCase()}">${safe(state.status)}</span></div><div class="workflow-result-grid"><div class="workflow-result-preview">${url?(state.data.provider.media==='video'?`<video controls src="${safe(url)}"></video>`:`<img src="${safe(url)}" alt="Hasil workflow">`):'<span>✦</span><p>Provider menyelesaikan proses tanpa URL preview.</p>'}</div><div><dl><dt>Provider</dt><dd>${safe(state.data.provider.name)}</dd><dt>Prompt</dt><dd>${safe(state.data.generator.prompt)}</dd><dt>Asset</dt><dd>${safe(state.data.generator.assetLabels?.map(x=>x.name).join(', ')||'—')}</dd></dl><div class="pipeline-actions">${url?`<a class="button" href="${safe(url)}" download>Download</a>`:''}<button class="outline" data-copy-result="prompt">Copy prompt</button><button class="outline" data-copy-result="url" ${url?'':'disabled'}>Copy URL</button></div></div></div>`;root.querySelector('[data-copy-result="prompt"]').onclick=()=>navigator.clipboard?.writeText(state.data.generator.prompt);root.querySelector('[data-copy-result="url"]')?.addEventListener('click',()=>navigator.clipboard?.writeText(url));}
  $('#workflow-previous').onclick=()=>{if(state.currentStep){state.currentStep--;persist();render();}};
  $('#workflow-next').onclick=()=>{const errors=validate();if(errors.length)return showError(errors);if(state.currentStep<steps.length-1){state.currentStep++;persist();render();}else $('#workflow-summary-title').scrollIntoView({behavior:'smooth'});};
  $('#workflow-undo').onclick=()=>{if(!undoStack.length)return;redoStack.push(snapshot());state=JSON.parse(undoStack.pop());persist();render();};
  $('#workflow-redo').onclick=()=>{if(!redoStack.length)return;undoStack.push(snapshot());state=JSON.parse(redoStack.pop());persist();render();};
  $('#workflow-generate').onclick=async()=>{const all=steps.flatMap((_,i)=>validate(i));if(all.length){showError(['Lengkapi seluruh tahap sebelum menjalankan workflow.']);return;}state.status='Running';state.progress=10;state.error='';renderSummary();persist(true);const prompt=state.data.generator.prompt,provider=state.data.provider.name;const job=window.GenerationQueue?.enqueue({project:state.data.project.name,provider,model:state.data.provider.model,prompt,promptType:state.data.provider.media,assetIds:state.data.generator.assetIds});state.queueJobId=job?.id;try{if(!window.AIProviderConnector)throw new Error('Konektor provider belum siap.');const result=await window.AIProviderConnector.execute(prompt,provider,state.data.provider.model);state.result={...result,url:result.url||result.previewUrl||result.downloadUrl};state.status='Completed';state.progress=100;}catch(error){state.status='Failed';state.error=error.message;state.result={error:error.message};showError([`Provider gagal: ${error.message}. Periksa koneksi lalu tekan Jalankan Workflow untuk retry tanpa reload.`]);}saveHistory();persist(true);render();renderResult();};
  $('#workflow-new').onclick=()=>{if(!confirm('Mulai workflow baru? Draft saat ini tetap tersimpan di history.'))return;const history=read(HISTORY_KEY,[]);history.unshift({...JSON.parse(snapshot()),name:state.data.project.name||'Untitled workflow'});localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(0,25)));state=defaults();undoStack=[];redoStack=[];persist(true);render();};
  window.addEventListener('aiads:assets-selected',event=>{if(event.detail?.assets?.length)attachAssets(event.detail.assets);});
  window.addEventListener('aiads:prompt-generated',event=>{const previous=snapshot();state.data.generator.prompt=event.detail.prompt;state.data.provider.name=event.detail.provider;state.data.provider.media=event.detail.outputType;state.data.generator.assetIds=event.detail.assetIds||[];state.promptGeneratedAt=event.detail.createdAt;commit(previous);saveHistory();});
  recover(); render(); renderResult(); persist(true);
  window.WorkflowOrchestrator={ validate:()=>steps.flatMap((_,i)=>validate(i)), getState:()=>JSON.parse(snapshot()), attachAssets, retry:()=>$('#workflow-generate').click() };
})();
