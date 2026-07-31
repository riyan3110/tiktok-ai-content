(() => {
  'use strict';
  const KEYS = { config: 'providers.config', history: 'providers.history', defaults: 'providers.default' };
  const NAMES = ['Google Flow','Google Veo','Google Gemini','OpenAI','Claude','Runway','Kling','Vidu','Hailuo','Pika','Custom Provider'];
  const $ = selector => document.querySelector(selector);
  const safe = value => { const span = document.createElement('span'); span.textContent = String(value ?? ''); return span.innerHTML; };
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  const id = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const encodeKey = value => value ? btoa(unescape(encodeURIComponent(value))) : '';
  const decodeKey = value => { try { return value ? decodeURIComponent(escape(atob(value))) : ''; } catch (_) { return ''; } };
  const initial = (name, index) => ({ id:id(), name, status:'Disconnected', enabled:index < 4, baseUrl:'', model:'', apiKey:'', organization:'', projectId:'', timeout:30000, retry:2, maxTokens:2048, temperature:0.7, topP:1, topK:40, seed:'', systemPrompt:'', notes:'', builtIn:true });
  let providers = read(KEYS.config, null) || NAMES.map(initial);
  let defaults = read(KEYS.defaults, { text:'', image:'', video:'' });
  let selectedId = providers[0]?.id;
  let revealed = false;
  const persist = () => localStorage.setItem(KEYS.config, JSON.stringify(providers));
  const toast = (message, error=false) => { const node = $('#consistency-toast'); node.textContent = message; node.className = `consistency-toast show${error ? ' error' : ''}`; setTimeout(() => node.className='consistency-toast', 2200); };
  function providerIcon(name) { return name.split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase(); }
  function renderList() {
    const query = $('#provider-search').value.trim().toLowerCase();
    const filtered = providers.filter(p => p.name.toLowerCase().includes(query));
    $('#provider-list').innerHTML = filtered.length ? filtered.map(p => `<button class="provider-item ${p.id === selectedId ? 'active' : ''}" data-provider="${p.id}"><span>${safe(providerIcon(p.name))}</span><div><b>${safe(p.name)}</b><small class="connection-${p.status.toLowerCase()}">● ${safe(p.status)}</small></div><i class="${p.enabled ? 'enabled' : ''}">${p.enabled ? 'On' : 'Off'}</i></button>`).join('') : '<div class="provider-empty">No providers found.</div>';
    document.querySelectorAll('[data-provider]').forEach(button => button.onclick = () => { selectedId=button.dataset.provider; revealed=false; render(); });
  }
  function defaultSelectors() {
    const enabled = providers.filter(p => p.enabled); const html = `<option value="">Not selected</option>${enabled.map(p => `<option value="${p.id}">${safe(p.name)}</option>`).join('')}`;
    document.querySelectorAll('[data-default]').forEach(select => { select.innerHTML=html; select.value=defaults[select.dataset.default] || ''; select.onchange=() => { defaults[select.dataset.default]=select.value; localStorage.setItem(KEYS.defaults, JSON.stringify(defaults)); toast('Default provider updated.'); }; });
  }
  const field = (label, key, type='text', extra='') => `<label>${label}<input data-provider-field="${key}" type="${type}" value="${safe(current()[key])}" ${extra}></label>`;
  const current = () => providers.find(p => p.id === selectedId);
  function renderDetail() {
    const p=current(); if (!p) { $('#provider-detail').innerHTML='<div class="provider-empty large"><span>⬡</span><h2>No provider selected</h2><p>Add a provider to configure the adapter.</p></div>'; return; }
    const secret=decodeKey(p.apiKey);
    $('#provider-detail').innerHTML = `<div class="detail-heading"><div class="provider-avatar">${safe(providerIcon(p.name))}</div><div><span class="connection-${p.status.toLowerCase()}">● ${safe(p.status)}</span><h2>${safe(p.name)}</h2><p>Provider adapter configuration</p></div><label class="mini-switch"><input data-enable type="checkbox" ${p.enabled?'checked':''}><span></span>${p.enabled?'Enabled':'Disabled'}</label></div>
      <div class="provider-form"><div class="form-grid">${field('Provider Name','name')}${field('API Base URL','baseUrl','url','placeholder="https://api.example.com"')}${field('Model','model')}${field('Organization','organization')}${field('Project ID','projectId')}${field('Timeout (ms)','timeout','number','min="1000"')}${field('Retry','retry','number','min="0" max="10"')}${field('Max Tokens','maxTokens','number','min="1"')}${field('Temperature','temperature','number','min="0" max="2" step="0.1"')}${field('Top P','topP','number','min="0" max="1" step="0.1"')}${field('Top K','topK','number','min="0"')}${field('Seed','seed','number')}</div>
      <label>API Key<div class="secret-field"><input id="provider-api-key" type="${revealed?'text':'password'}" value="${safe(secret)}" autocomplete="off" placeholder="••••••••••••••••"><button data-secret="toggle" class="outline" type="button">${revealed?'Hide':'Show'}</button><button data-secret="copy" class="outline" type="button">Copy</button><button data-secret="clear" class="outline" type="button">Clear</button></div><small>Stored locally in obfuscated form and masked by default.</small></label>
      <label>System Prompt<textarea data-provider-field="systemPrompt" rows="4">${safe(p.systemPrompt)}</textarea></label><label>Notes<textarea data-provider-field="notes" rows="3">${safe(p.notes)}</textarea></label></div>
      <div class="provider-detail-actions"><button data-action="test" type="button">Test Connection</button><button data-action="duplicate" class="outline" type="button">Duplicate</button><button data-action="delete" class="danger" type="button">Delete</button></div>`;
    document.querySelectorAll('[data-provider-field]').forEach(input => input.onchange=() => { p[input.dataset.providerField] = input.type==='number' && input.value !== '' ? Number(input.value) : input.value; persist(); renderList(); });
    $('[data-enable]').onchange=e => { p.enabled=e.target.checked; persist(); render(); toast(p.enabled?'Provider enabled.':'Provider disabled.'); };
    $('#provider-api-key').onchange=e => { p.apiKey=encodeKey(e.target.value); persist(); toast('Credential saved locally.'); };
    document.querySelectorAll('[data-secret]').forEach(b => b.onclick=async () => { const action=b.dataset.secret; if(action==='toggle'){revealed=!revealed;renderDetail();} if(action==='clear'){p.apiKey='';persist();renderDetail();toast('API key cleared.');} if(action==='copy'){try{await navigator.clipboard.writeText(secret);toast('API key copied securely.');}catch(_){toast('Clipboard unavailable.',true);}} });
    document.querySelectorAll('[data-action]').forEach(b => b.onclick=() => action(b.dataset.action));
  }
  function action(name) { const p=current(); if(name==='test'){ p.status='Pending'; persist(); render(); setTimeout(()=>{p.status=p.enabled?'Connected':'Disconnected';persist();render();toast(p.enabled?'Mock connection successful.':'Enable provider before testing.',!p.enabled);},800); } if(name==='duplicate'){const copy={...p,id:id(),name:`${p.name} Copy`,status:'Disconnected',builtIn:false};providers.push(copy);selectedId=copy.id;persist();render();toast('Provider duplicated.');} if(name==='delete'){if(!confirm(`Delete ${p.name}?`))return;providers=providers.filter(x=>x.id!==p.id);selectedId=providers[0]?.id;persist();render();toast('Provider deleted.');} }
  function addProvider(){const p=initial('New Custom Provider',99);p.builtIn=false;providers.push(p);selectedId=p.id;persist();render();toast('Custom provider added.');}
  function history(){const items=read(KEYS.history,[]);$('#provider-history').innerHTML=`<div class="history-title"><h3>Generation History</h3><span>${items.length}</span></div>${items.length?`<div class="history-table"><div class="history-row head"><span>Provider / Model</span><span>Prompt</span><span>Duration</span><span>Status</span><span>Timestamp</span></div>${items.slice(0,20).map(x=>`<div class="history-row"><span><b>${safe(x.provider)}</b><small>${safe(x.model||'Default model')}</small></span><span title="${safe(x.prompt)}">${safe(x.prompt)}</span><span>${x.duration} ms</span><span class="history-success">${safe(x.status)}</span><span>${new Date(x.timestamp).toLocaleString('id-ID')}</span></div>`).join('')}</div>`:'<div class="provider-empty"><span>↺</span><p>No generations yet. Run the mock pipeline to see history.</p></div>'}`;}
  async function generate(){const p=current(),prompt=$('#provider-prompt').value.trim();if(!p||!prompt){toast('Select a provider and enter a prompt.',true);return;}const button=$('#mock-generate');button.disabled=true;const start=performance.now();for(const step of ['Preparing Prompt...','Sending Request...','Waiting AI...','Receiving Response...','Completed']){$('#pipeline-progress').innerHTML=`<span class="spinner"></span><b>${step}</b>`;await new Promise(resolve=>setTimeout(resolve,step==='Waiting AI...' ? 550:280));}const items=read(KEYS.history,[]);items.unshift({id:id(),provider:p.name,model:p.model,prompt,duration:Math.round(performance.now()-start),status:'Completed',timestamp:new Date().toISOString(),response:{mock:true,content:'Mock generation completed.'}});localStorage.setItem(KEYS.history,JSON.stringify(items.slice(0,50)));button.disabled=false;$('#pipeline-progress').innerHTML='<span class="complete-mark">✓</span><b>Completed</b>';history();toast('Mock response received. No network request was made.');}
  function render(){renderList();defaultSelectors();renderDetail();history();}
  $('#provider-search').oninput=renderList;$('#add-provider').onclick=addProvider;$('#mock-generate').onclick=generate;render();
})();
