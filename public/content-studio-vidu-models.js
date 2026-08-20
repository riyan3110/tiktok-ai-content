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
