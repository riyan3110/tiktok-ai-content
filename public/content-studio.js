(() => {
  const $ = s => document.querySelector(s), terminal = new Set(['Completed','Failed','Cancelled']);
  const HANDOFF_KEY='aiads-image-generator-prompt';
  const Icons = window.Icons || {}; const ic = name => Icons.svg ? Icons.svg(name) : '';
  let mode='image', jobs=[], providers=[], selectedAssets=[], providerState={providers:[],defaults:{}}, providerLoad=0, selecting=false;
  // Retired model selections are never used to repopulate the active catalog.
  try { for (const key of Object.keys(localStorage)) if (/^contentStudio\..*Model$/.test(key)) localStorage.removeItem(key); } catch (_) {}
  const safe=v=>{const n=document.createElement('span');n.textContent=v??'';return n.innerHTML};
  const api=async(url,options={})=>{const response=await fetch(url,{cache:'no-store',headers:{'Content-Type':'application/json'},...options});const data=await response.json().catch(()=>({}));if(!response.ok){const message=data.unresolvedVariables?.length?`Lengkapi variabel template: ${data.unresolvedVariables.join(', ')}`:(data.error||data.message||`HTTP ${response.status}`);throw new Error(message)}return data};
  const date=v=>v?new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v)):'—';
  const toast=(message,error=false)=>{const el=$('#studio-generate-message');el.textContent=message;el.classList.toggle('error',error);clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.textContent='',3500)};
  const mediaForMode=()=>'image';
  function applyPromptHandoff(value){
    let prompt=String(value||'').trim();
    if(!prompt){try{prompt=String(sessionStorage.getItem(HANDOFF_KEY)||'').trim()}catch(_){}}
    if(!prompt||!$('#studio-prompt'))return false;
    $('#studio-prompt').value=prompt;
    const manual=document.querySelector('[name="studio-prompt-source"][value="manual"]');if(manual)manual.checked=true;
    try{sessionStorage.removeItem(HANDOFF_KEY)}catch(_){}
    $('#studio-prompt').dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  }
  function renderModel(media, selectedProvider){
    const input=$('#studio-model'),status=$('#studio-model-status');
    const models=selectedProvider?.models||[], selected=providerState.defaults?.[media]?.model;
    input.innerHTML='<option value="">Pilih model</option>'+models.map(model=>`<option value="${safe(model)}">${safe(model)}</option>`).join('');
    input.value=models.includes(selected)?selected:'';
    input.disabled=selecting||!selectedProvider;
    input.onchange=()=>selectDefault(media,selectedProvider?.id,input.value);
    status.classList.toggle('hidden',Boolean(input.value));
    status.textContent=selectedProvider?'Pilih model dari katalog provider.':'';
    $('#studio-model-retry').classList.add('hidden');
    return Boolean(input.value);
  }
  async function selectDefault(role,providerId,model){
    if(!providerId||!model)return;
    selecting=true;renderProviders();
    try{providerState=await api(`/api/dynamic-ai/defaults/${role}`,{method:'PUT',body:JSON.stringify({providerId,model})});providers=providerState.providers||[];}
    catch(error){toast(error.message,true);await loadProviders();}
    finally{selecting=false;renderProviders();}
  }
  function renderProviders(type=mediaForMode()){
    const media=type==='batch'?'image':type,visible=providers.filter(p=>p.roles?.includes(media)),select=$('#studio-provider');
    const selected=visible.find(p=>p.id===providerState.defaults?.[media]?.providerId);
    select.innerHTML='<option value="">Pilih provider</option>'+visible.map(p=>`<option value="${safe(p.id)}">${safe(p.name)}</option>`).join('');
    select.value=selected?.id||'';select.disabled=selecting;
    select.onchange=()=>{const chosen=visible.find(p=>p.id===select.value);if(chosen)selectDefault(media,chosen.id,chosen[media+'Model']||chosen.models?.[0]);};
    const empty=!selected,single=visible.length===1&&Boolean(selected),modelsReady=renderModel(media,selected);
    $('#studio-provider-field').classList.toggle('hidden',!visible.length||single);
    $('#studio-active-provider').classList.toggle('hidden',!single);
    $('#studio-active-provider').textContent=single?`Provider aktif: ${selected.name}`:'';
    $('#studio-model-field').classList.toggle('hidden',empty);
    $('#studio-generate').disabled=empty||!modelsReady||selecting;
    $('#studio-provider-warning').classList.toggle('hidden',!empty);
    $('#studio-provider-warning-title').textContent=media==='video'?'Belum ada provider video yang aktif.':'Belum ada provider gambar yang aktif.';
    $('#studio-provider-warning-text').textContent='Simpan Base URL dan API key, lalu pilih provider dan model melalui Provider AI.';
    return visible;
  }

  function configureMode(next){mode=['image','batch','history'].includes(next)?next:'image';const batch=mode==='batch',history=mode==='history',media=batch?'image':mode;$('#studio-create-panel').classList.toggle('hidden',history);$('#studio-history-panel').classList.toggle('history-only',history);document.querySelectorAll('[data-studio-type]').forEach(b=>b.classList.toggle('active',b.dataset.studioType===mode));$('#studio-form-title').textContent=batch?'Batch Generation':`Generate ${media[0].toUpperCase()+media.slice(1)}`;$('#studio-kind-pill').textContent=batch?'BATCH':media.toUpperCase();$('#studio-batch-field').classList.toggle('hidden',!batch);$('#studio-generate').innerHTML=`${ic('sparkles')} ${batch?'Generate Batch':`Generate ${media[0].toUpperCase()+media.slice(1)}`}`;renderProviders(media)}
  async function loadAssets(){try{const chosen=await window.AssetManager.select({selectedIds:selectedAssets.map(asset=>asset.id),multiple:true});if(!chosen)return;selectedAssets=chosen;renderSelected()}catch(e){toast(e.message,true)}}
  function renderSelected(){$('#studio-selected-assets').innerHTML=selectedAssets.map(a=>`<span class="selected-asset"><img src="${safe(a.previewUrl||a.preview_url)}" alt=""><button type="button" data-remove-asset="${safe(a.id)}" aria-label="Remove asset">${ic('x')}</button></span>`).join('');document.querySelectorAll('[data-remove-asset]').forEach(b=>b.onclick=()=>{selectedAssets=selectedAssets.filter(a=>a.id!==b.dataset.removeAsset);renderSelected()});renderProviders(mediaForMode())}
  const preview=j=>j.result_missing?`<div class="result-placeholder"><span>${ic('circle-alert')}</span><small>File hasil tidak ditemukan</small></div>`:j.result_url?(j.media_type==='video'?`<video src="${safe(j.result_url)}" controls preload="metadata"></video>`:`<img src="${safe(j.result_url)}" alt="Generated result">`):`<div class="result-placeholder"><span>${j.media_type==='video'?ic('play'):ic('image')}</span><small>${safe(j.status)}</small></div>`;
  function renderActive(){const active=jobs.filter(j=>!terminal.has(j.status));$('#studio-active-jobs').innerHTML=active.length?active.map(j=>`<article class="active-job" data-view-job="${safe(j.id)}"><div><span class="queue-status status-${j.status.toLowerCase()}">${safe(j.status)}</span><small>${safe(j.provider)}</small></div><p>${safe(j.prompt)}</p><div class="queue-progress"><i style="width:${j.progress}%"></i></div><b>${j.progress}%</b></article>`).join(''):'<div class="empty-state">Tidak ada job aktif.</div>';bind()}
  function renderHistory(){const query=$('#studio-search').value.toLowerCase(),type=$('#studio-filter-type').value,status=$('#studio-filter-status').value;const list=jobs.filter(j=>(!query||`${j.prompt} ${j.provider}`.toLowerCase().includes(query))&&(!type||j.media_type===type)&&(!status||j.status===status));$('#studio-history').innerHTML=list.length?list.map(j=>`<article class="result-card"><button class="result-preview" data-view-job="${safe(j.id)}">${preview(j)}</button><div class="result-card-body"><div><span class="queue-status status-${j.status.toLowerCase()}">${safe(j.status)}</span><small>${safe(j.media_type)} · ${safe(j.provider)}</small></div><p>${safe(j.prompt)}</p><div class="result-actions">${j.status==='Completed'&&!j.result_missing?`<a class="outline button" href="/api/content-studio/jobs/${safe(j.id)}/download">${ic('download')} Download</a>`:''}${j.status==='Failed'?`<button class="outline" data-view-job="${safe(j.id)}">Lihat error</button><button class="outline" data-job="${safe(j.id)}" data-action="retry">${ic('refresh-cw')} Retry</button>`:''}<button class="outline" data-job="${safe(j.id)}" data-action="duplicate">${ic('copy')} Duplicate</button><button class="danger" data-delete-job="${safe(j.id)}">Delete</button></div></div></article>`).join(''):'<div class="empty-state">Belum ada hasil yang sesuai filter.</div>';bind()}
  function bind(){document.querySelectorAll('[data-view-job]').forEach(b=>b.onclick=()=>showResult(b.dataset.viewJob));document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>jobAction(b.dataset.job,b.dataset.action));document.querySelectorAll('[data-delete-job]').forEach(b=>b.onclick=()=>remove(b.dataset.deleteJob))}
  function showResult(id){const j=jobs.find(x=>x.id===id);if(!j)return;const v=$('#studio-result-viewer');v.classList.remove('hidden');v.innerHTML=`<div class="detail-heading"><div><span class="eyebrow">RESULT VIEWER</span><h2>${safe(j.media_type)} Generation</h2></div><button class="icon-button" data-close-viewer>${ic('x')}</button></div><div class="viewer-preview">${preview(j)}</div><dl class="result-metadata"><div><dt>Status</dt><dd>${safe(j.status)}</dd></div><div><dt>Model</dt><dd>${safe(j.model||'—')}</dd></div><div><dt>Provider status</dt><dd>${safe(j.provider_status||'—')}</dd></div><div><dt>Request ID</dt><dd>${safe(j.provider_request_id||'—')}</dd></div><div><dt>Endpoint</dt><dd>${safe(j.endpoint||'—')}</dd></div><div><dt>Created</dt><dd>${date(j.created_at)}</dd></div><div class="wide"><dt>Prompt</dt><dd>${safe(j.prompt)}</dd></div>${j.error_message?`<div class="wide error-box"><dt>${safe(j.error_code||j.error_type||'Error')}</dt><dd>${safe(j.error_message)}</dd></div>`:''}</dl><div class="viewer-actions">${j.status==='Completed'&&!j.result_missing?`<a class="button" href="/api/content-studio/jobs/${safe(j.id)}/download">${ic('download')} Download</a><button class="outline" data-copy-url>Copy URL</button>`:''}${j.status==='Failed'?`<button data-retry>${ic('refresh-cw')} Retry</button>`:''}<button class="danger" data-delete>Delete</button></div>`;$('[data-close-viewer]').onclick=()=>v.classList.add('hidden');$('[data-copy-url]')?.addEventListener('click',()=>navigator.clipboard.writeText(j.result_url).then(()=>toast('URL copied')));$('[data-retry]')?.addEventListener('click',()=>jobAction(id,'retry'));$('[data-delete]').onclick=()=>remove(id)}
  async function jobAction(id,action){try{await api(`/api/content-studio/jobs/${id}/${action}`,{method:'POST'});$('#studio-result-viewer').classList.add('hidden');await refresh();toast(action==='retry'?'Retry masuk antrean.':'Job diduplikasi.')}catch(e){toast(e.message,true)}}
  async function remove(id){if(!confirm('Delete job dan file hasil ini?'))return;try{await api(`/api/content-studio/jobs/${id}`,{method:'DELETE'});$('#studio-result-viewer').classList.add('hidden');await refresh();toast('Result deleted.')}catch(e){toast(e.message,true)}}
  async function refreshResultUrls(items){const ids=[...new Set(items.map(j=>j.asset_id).filter(Boolean).map(String))];if(!ids.length)return items;try{const assets=await api('/api/assets/resolve',{method:'POST',body:JSON.stringify({assetIds:ids})});const urls=new Map(assets.map(asset=>[String(asset.id),asset.preview_url||asset.url||'']));return items.map(job=>{const freshUrl=urls.get(String(job.asset_id));return freshUrl?{...job,result_url:freshUrl}:job})}catch(e){console.warn('[Content Studio] gagal memperbarui URL media',e);return items}}
  async function refresh(){try{jobs=await api('/api/content-studio/jobs');jobs=await refreshResultUrls(jobs);renderActive();renderHistory()}catch(e){toast(e.message,true)}}
  $('#studio-generate-form').onsubmit=async event=>{event.preventDefault();const provider=$('#studio-provider').value;if(!provider)return;const media=mediaForMode(),model=$('#studio-model').value;const body={provider,model:model||undefined,prompt:$('#studio-prompt').value.trim(),negativePrompt:$('#studio-negative-prompt').value.trim(),resolution:$('#studio-resolution').value,mediaType:'image',promptSource:document.querySelector('[name="studio-prompt-source"]:checked').value,assetIds:selectedAssets.map(a=>a.id),count:mode==='batch'?Number($('#studio-batch-count').value):1};try{$('#studio-generate').disabled=true;toast('Memeriksa provider...');const result=await api('/api/content-studio/generate',{method:'POST',body:JSON.stringify(body)});toast(`${result.ids.length} job masuk antrean.`);await refresh()}catch(e){toast(e.message,true)}finally{renderProviders(mediaForMode())}};
  document.querySelectorAll('[data-studio-type]').forEach(b=>b.onclick=()=>{configureMode(b.dataset.studioType)});$('#studio-load-assets').onclick=loadAssets;$('#studio-refresh').onclick=refresh;['#studio-search','#studio-filter-type','#studio-filter-status'].forEach(s=>$(s).oninput=renderHistory);document.querySelectorAll('[name="studio-prompt-source"]').forEach(input=>input.onchange=()=>{if(input.checked&&input.value==='generator'){const generated=document.querySelector('#generator-output,#prompt-output,[data-generated-prompt]');if(generated)$('#studio-prompt').value=generated.value||generated.textContent||'';if(!$('#studio-prompt').value)toast('Buat prompt di Prompt Generator terlebih dahulu.',true)}});
  async function loadProviders(){
    const version=++providerLoad;
    providers=[];providerState={providers:[],defaults:{}};renderProviders();
    try{const state=await api('/api/dynamic-ai/providers');if(version!==providerLoad)return;providerState=state;providers=state.providers||[];renderProviders();}
    catch(e){if(version===providerLoad){providers=[];renderProviders();toast(e.message,true);}}
  }
  $('#studio-model-retry').onclick=loadProviders;
  window.addEventListener('ai-provider-state-changed',loadProviders);
  window.addEventListener('aiads:image-prompt-handoff',event=>applyPromptHandoff(event.detail?.prompt));
  async function loadStorage(){const badge=$('#studio-storage-badge'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const storage=await api('/api/storage/settings',{signal:controller.signal});badge.innerHTML=storage.provider==='tencent-cos'?`${ic('cloud')} Tencent COS`:`${ic('database')} Local Storage`}catch(e){badge.textContent='Storage unavailable';badge.title='Storage tidak dapat diperiksa';toast('Storage tidak dapat diperiksa',true)}finally{clearTimeout(timer)}}
  $('#studio-open-providers').onclick=()=>{location.hash='ai-providers'};window.addEventListener('hashchange',()=>{if(location.hash==='#studio'){applyPromptHandoff();loadProviders()}});window.addEventListener('pageshow',()=>{if(location.hash==='#studio'){applyPromptHandoff();loadProviders()}});configureMode('image');applyPromptHandoff();loadProviders();loadStorage();refresh();setInterval(()=>{if(!document.hidden&&jobs.some(j=>!terminal.has(j.status)))refresh()},1500);
})();