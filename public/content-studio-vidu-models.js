(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ContentStudioViduModels=api})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const MODEL_KEYS=Object.freeze({image:'contentStudio.vidu.imageModel',video:'contentStudio.vidu.videoModel'});
  const modelSets=Object.freeze({
    imageNoReference:['viduq2'],
    imageReference:['viduq2','viduq1'],
    text2video:['viduq3-turbo','viduq3-pro','viduq2','viduq1'],
    img2video:['viduq3-pro-fast','viduq3-turbo','viduq3-pro','viduq2-pro-fast','viduq2-pro','viduq2-turbo','viduq1','viduq1-classic'],
    reference2video:['viduq3-turbo','viduq3','viduq2','viduq1']
  });
  function modelsFor(media,assetCount){
    if(assetCount>7)return [];
    if(media==='image')return [...modelSets[assetCount?'imageReference':'imageNoReference']];
    if(media==='video')return [...modelSets[assetCount===0?'text2video':assetCount===1?'img2video':'reference2video']];
    return [];
  }
  function stateFor({media,assetCount=0,saved,configured}={}){
    const models=modelsFor(media,assetCount),choice=models.includes(saved)?saved:models.includes(configured)?configured:models[0]||'';
    return {models,choice,valid:Boolean(choice&&models.includes(choice)),message:assetCount>7?'Vidu mendukung maksimal 7 gambar referensi. Hapus gambar sebelum Generate.':''};
  }
  function validate(media,assetCount,model){
    if(assetCount>7)return {valid:false,message:'Vidu mendukung maksimal 7 gambar referensi. Hapus gambar sebelum Generate.'};
    if(media==='image'&&assetCount===0&&model==='viduq1')return {valid:false,message:'Model viduq1 Image memerlukan setidaknya satu gambar referensi.'};
    if(!modelsFor(media,assetCount).includes(model))return {valid:false,message:'Pilih model Vidu yang tersedia untuk endpoint ini.'};
    return {valid:true,message:''};
  }
  function applySelect(input,{models=[],choice='',valid=false,onchange=null},escape=value=>value){
    input.onchange=onchange;
    input.innerHTML=models.length?models.map(model=>`<option value="${escape(model)}">${escape(model)}</option>`).join(''):'<option value="">Not selected</option>';
    input.value=choice;
    input.disabled=!valid;
  }
  function genericState(model){const choice=String(model||'');return {models:choice?[choice]:[],choice,valid:Boolean(choice),onchange:null}}
  function clearHandler(input){input.onchange=null}
  return {MODEL_KEYS,modelsFor,stateFor,validate,applySelect,genericState,clearHandler};
});

(function setupZarkControls(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  const form=document.getElementById('studio-generate-form');
  const provider=document.getElementById('studio-provider');
  const prompt=document.getElementById('studio-prompt');
  const resolution=document.getElementById('studio-resolution');
  if(!form||!provider||!prompt||!resolution)return;

  const field=document.createElement('label');
  field.id='studio-zark-duration-field';
  field.className='hidden';
  field.innerHTML='Durasi Zark<select id="studio-zark-duration"><option value="">Auto</option><option value="5">5 detik</option><option value="10">10 detik</option><option value="15">15 detik</option><option value="30">30 detik</option></select><small>Storyboard bertimestamp sampai 30 detik juga dibaca otomatis.</small>';
  resolution.closest('.form-section-body')?.insertBefore(field,resolution.parentElement.nextSibling);
  const duration=document.getElementById('studio-zark-duration');
  if(!duration)return;

  const isVideoMode=()=>document.querySelector('[data-studio-type="video"]')?.classList.contains('active');
  const refresh=()=>field.classList.toggle('hidden',provider.value!=='zark'||!isVideoMode());
  provider.addEventListener('change',()=>queueMicrotask(refresh));
  document.querySelectorAll('[data-studio-type]').forEach(button=>button.addEventListener('click',()=>setTimeout(refresh,0)));
  new MutationObserver(refresh).observe(provider,{attributes:true,childList:true,subtree:true});

  form.addEventListener('submit',()=>{
    if(provider.value!=='zark'||!isVideoMode()||!duration.value)return;
    const original=prompt.value;
    if(!new RegExp(`\\b${duration.value}\\s*(?:s|sec|detik)\\b`,'i').test(original)) prompt.value=`${original.trim()}\n\nTarget duration: ${duration.value} detik.`;
    queueMicrotask(()=>{prompt.value=original});
  },true);
  refresh();
})();

(function setupPwa(){
  if(typeof window==='undefined'||typeof document==='undefined')return;
  if(!document.querySelector('link[rel="manifest"]')){
    const manifest=document.createElement('link');
    manifest.rel='manifest';
    manifest.href='/manifest.webmanifest';
    document.head.appendChild(manifest);
  }
  const metaValues=[
    ['mobile-web-app-capable','yes'],
    ['apple-mobile-web-app-capable','yes'],
    ['apple-mobile-web-app-title','AI Ads Lab']
  ];
  metaValues.forEach(([name,content])=>{
    if(document.querySelector(`meta[name="${name}"]`))return;
    const meta=document.createElement('meta');
    meta.name=name;
    meta.content=content;
    document.head.appendChild(meta);
  });
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/service-worker.js',{scope:'/'}).catch(error=>console.warn('PWA service worker gagal didaftarkan:',error));
  }
})();

(function setupFloatingChat(){
  if(typeof window==='undefined'||typeof document==='undefined'||window.__AIADS_FLOATING_CHAT_LOADER__)return;
  window.__AIADS_FLOATING_CHAT_LOADER__=true;
  const script=document.createElement('script');
  script.src='/floating-chat.js';
  script.defer=true;
  script.dataset.aiadsFloatingChat='1';
  document.head.appendChild(script);
})();
