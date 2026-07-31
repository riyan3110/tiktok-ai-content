(() => {
  'use strict';
  const KEYS = { generator: 'prompt.generator', presets: 'prompt.presets', history: 'prompt.history' };
  const LIBRARIES = { character: 'consistency.characters', product: 'consistency.products', style: 'consistency.styles', voice: 'consistency.voice' };
  const PROJECTS = 'ai-ads-lab-projects-v1';
  const targets = ['Google Flow','Google Veo','Google Omni','Vidu','Kling','Hailuo','Runway','Pika','ChatGPT','Gemini','Claude','Custom'];
  const types = ['Storyboard','Image Prompt','Video Prompt','UGC','Commercial','Product Photography','Anime','Review','Tutorial','TikTok Ads','YouTube Shorts','Instagram Reel'];
  const modules = ['Project','Character','Product','Scene','Camera','Lighting','Voice','Style','Negative Prompt','Technical Notes'];
  const defaultEnabled = Object.fromEntries(modules.map(name => [name, true]));
  const $ = selector => document.querySelector(selector);
  const read = (key, fallback) => { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch (_) { return fallback; } };
  const safe = value => { const node = document.createElement('span'); node.textContent = value || ''; return node.innerHTML; };
  const options = (items, empty = 'None selected') => `<option value="">${empty}</option>${items.map(item => `<option value="${safe(item.id || item)}">${safe(item.name || item)}</option>`).join('')}`;
  const state = { project:'', character:'', product:'', style:'', voice:'', target:'Google Flow', language:'English', type:'UGC', duration:'15 seconds', ratio:'9:16', platform:'TikTok', scene:'Hook, product demonstration, social proof, and a clear call to action.', enabled: defaultEnabled, ...read(KEYS.generator, {}) };
  let undo = [], redo = [], timer, folded = false;
  const data = () => ({ projects: read(PROJECTS, []), character: read(LIBRARIES.character, []), product: read(LIBRARIES.product, []), style: read(LIBRARIES.style, []), voice: read(LIBRARIES.voice, []) });
  const selected = (kind, id) => data()[kind]?.find(item => item.id === id);
  const describe = value => value ? Object.entries(value).filter(([key, val]) => val && !['id','images','history','createdAt','updatedAt','favorite','preset','version'].includes(key)).map(([key,val]) => `${key.replace(/([A-Z])/g, ' $1')}: ${Array.isArray(val) ? val.join(', ') : val}`).join('; ') : '';
  function fields() {
    const lib = data();
    $('#generator-fields').innerHTML = `
      <label>Project<select data-field="project">${options(lib.projects, 'Select workspace project')}</select></label>
      <label>Character<select data-field="character">${options(lib.character, lib.character.length ? 'No character' : 'Library is empty')}</select></label>
      <label>Product<select data-field="product">${options(lib.product, lib.product.length ? 'No product' : 'Library is empty')}</select></label>
      <label>Style<select data-field="style">${options(lib.style, lib.style.length ? 'No style' : 'Library is empty')}</select></label>
      <label>Voice<select data-field="voice">${options(lib.voice, lib.voice.length ? 'No voice' : 'Library is empty')}</select></label>
      <label>Target AI<select data-field="target">${options(targets, 'Select target')}</select></label>
      <div class="field-pair"><label>Output Language<select data-field="language">${options(['English','Bahasa Indonesia','Japanese','Spanish'])}</select></label><label>Prompt Type<select data-field="type">${options(types)}</select></label></div>
      <div class="field-pair"><label>Duration<select data-field="duration">${options(['5 seconds','8 seconds','15 seconds','30 seconds','60 seconds'])}</select></label><label>Aspect Ratio<select data-field="ratio">${options(['9:16','16:9','1:1','4:5'])}</select></label></div>
      <label>Platform<select data-field="platform">${options(['TikTok','YouTube Shorts','Instagram Reels','Website','Marketplace'])}</select></label>
      <label>Scene Direction<textarea data-field="scene" rows="4" placeholder="Describe the scene sequence…">${safe(state.scene)}</textarea></label>`;
    document.querySelectorAll('[data-field]').forEach(input => { input.value = state[input.dataset.field] || ''; input.addEventListener(input.tagName === 'TEXTAREA' ? 'input' : 'change', () => { state[input.dataset.field] = input.value; generate(); }); });
  }
  function blocks() {
    const project = selected('projects', state.project), character = selected('character', state.character), product = selected('product', state.product), style = selected('style', state.style), voice = selected('voice', state.voice);
    return {
      Project: project ? `${project.name}. Brand: ${project.brand}; campaign product: ${project.product}; category: ${project.category}. ${project.description || ''}` : 'Create a focused advertising concept aligned with the selected campaign.',
      Character: describe(character), Product: describe(product), Scene: state.scene,
      Camera: style?.camera ? `${style.camera}; lens: ${style.lens || 'appropriate focal length'}; composition: ${style.composition || 'clear subject framing'}.` : 'Dynamic intentional framing, stable subject continuity, natural camera movement.',
      Lighting: style?.lighting ? `${style.lighting}; color tone: ${style.colorTone || 'balanced'}.` : 'Professional, coherent lighting with realistic shadows and controlled highlights.',
      Voice: describe(voice), Style: describe(style),
      'Negative Prompt': style?.negativePrompt || 'distorted anatomy, inconsistent identity, warped packaging, illegible text, flicker, low resolution, duplicate objects',
      'Technical Notes': `Target: ${state.target}. Format: ${state.type}. Output language: ${state.language}. Duration: ${state.duration}. Aspect ratio: ${state.ratio}. Platform: ${state.platform}. Preserve identity, product geometry, logo, and colors across every scene.`
    };
  }
  function assemble() { return Object.entries(blocks()).filter(([name, content]) => state.enabled[name] && content).map(([name, content]) => `## ${name}\n${content.trim()}`).join('\n\n'); }
  function metrics(text) { const words = text.trim() ? text.trim().split(/\s+/).length : 0; return { words, tokens: Math.ceil(words * 1.33), chars: text.length }; }
  function analyze(text) {
    const m = metrics(text), warnings = [];
    if (!state.character) warnings.push('Missing Character'); if (!state.product) warnings.push('Missing Product'); if (!state.style) warnings.push('Missing Style'); if (!state.voice) warnings.push('Missing Voice');
    const normalized = text.toLowerCase().match(/\b[\w-]{4,}\b/g) || []; const duplicate = normalized.some((word, i) => normalized.indexOf(word) !== i && normalized.filter(x => x === word).length > 7); if (duplicate) warnings.push('Duplicate Warning');
    const scenes = Math.max(0, (text.match(/scene|shot|adegan/gi) || []).length); let score = 100 - warnings.length * 12; if (m.words < 40) score -= 15; if (m.words > 600) score -= 10; score = Math.max(0, score);
    return { ...m, warnings, scenes, score, compatibility: targets.includes(state.target) && state.target !== 'Custom' ? `Optimized for ${state.target}` : 'Generic custom format' };
  }
  function highlight(text) { return safe(text).replace(/^(## .+)$/gm, '<mark>$1</mark>').replace(/\b(Target|Format|Duration|Aspect ratio|Platform):/g, '<b>$1:</b>'); }
  function render(text) {
    const report = analyze(text); $('#editor-metrics').textContent = `${report.words} words · ~${report.tokens} tokens`; $('#prompt-highlight').innerHTML = highlight(folded ? (text.match(/^## .+$/gm) || []).join('\n') : text) + '\n';
    $('#prompt-preview').innerHTML = text ? `<span class="preview-target">${safe(state.target)}</span><h3>${safe(state.type)}</h3><p>${safe(text.slice(0, 230))}${text.length > 230 ? '…' : ''}</p>` : `<div class="mini-empty"><span>✦</span><p>Configure inputs to build a prompt.</p></div>`;
    $('#quality-analysis').innerHTML = `<div class="quality-score"><div style="--score:${report.score * 3.6}deg"><strong>${report.score}</strong><small>/100</small></div><span><b>Quality Score</b><small>${report.compatibility}</small></span></div><div class="analysis-grid"><span><small>Prompt Length</small><b>${report.words} words</b></span><span><small>Estimated Length</small><b>~${report.tokens} tokens</b></span><span><small>Scene Count</small><b>${report.scenes}</b></span><span><small>Compatibility</small><b>${safe(state.target)}</b></span></div><div class="warning-list"><h3>Warnings <span>${report.warnings.length}</span></h3>${report.warnings.length ? report.warnings.map(w => `<p>! ${w}</p>`).join('') : '<p class="all-good">✓ All quality checks passed</p>'}</div>`;
  }
  function persist(text) { state.content = text; state.updatedAt = new Date().toISOString(); localStorage.setItem(KEYS.generator, JSON.stringify(state)); clearTimeout(timer); $('#generator-save-state').textContent = 'Menyimpan…'; timer = setTimeout(() => $('#generator-save-state').textContent = 'Tersimpan lokal', 450); }
  function generate() { const text = assemble(); const editor = $('#generated-prompt'); if (editor.value !== text) { undo.push(editor.value); if (undo.length > 50) undo.shift(); redo = []; editor.value = text; } persist(text); render(text); }
  function toggles() { $('#module-toggles').innerHTML = modules.map(name => `<label title="Toggle ${name}"><input type="checkbox" data-module="${name}" ${state.enabled[name] !== false ? 'checked' : ''}><span>${safe(name)}</span></label>`).join(''); document.querySelectorAll('[data-module]').forEach(input => input.onchange = () => { state.enabled[input.dataset.module] = input.checked; generate(); }); }
  function download(ext, type, content) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = `prompt-${Date.now()}.${ext}`; link.click(); URL.revokeObjectURL(link.href); toast(`Export ${ext.toUpperCase()} siap.`); }
  function toast(message, error = false) { const el = $('#consistency-toast'); el.textContent = message; el.className = `consistency-toast show${error ? ' error' : ''}`; setTimeout(() => el.className = 'consistency-toast', 2400); }
  function presets() { const list = read(KEYS.presets, []); $('#preset-count').textContent = list.length; $('#preset-list').innerHTML = list.length ? list.map(p => `<button class="preset-chip" data-preset-id="${p.id}"><span>✧</span><b>${safe(p.name)}</b><small>${safe(p.target)} · ${safe(p.type)}</small><i data-delete-preset="${p.id}" title="Delete">×</i></button>`).join('') : '<p class="preset-empty">Belum ada preset. Simpan konfigurasi favorit Anda.</p>'; document.querySelectorAll('[data-preset-id]').forEach(button => button.onclick = event => { if (event.target.matches('[data-delete-preset]')) { localStorage.setItem(KEYS.presets, JSON.stringify(list.filter(p => p.id !== button.dataset.presetId))); presets(); toast('Preset dihapus.'); return; } Object.assign(state, list.find(p => p.id === button.dataset.presetId).config); fields(); toggles(); generate(); toast('Preset diterapkan.'); }); }
  function action(name) { const editor = $('#generated-prompt'); if (name === 'fold') { folded = !folded; editor.closest('.syntax-editor').classList.toggle('folded', folded); const button = document.querySelector('[data-generator-action="fold"]'); button.textContent = folded ? 'Unfold' : 'Fold'; button.setAttribute('aria-pressed', String(folded)); render(editor.value); } else if (name === 'copy') navigator.clipboard?.writeText(editor.value).then(() => toast('Prompt copied.')).catch(() => { editor.select(); document.execCommand('copy'); toast('Prompt copied.'); }); else if (name === 'clear') { undo.push(editor.value); editor.value = ''; persist(''); render(''); } else if (name === 'undo' && undo.length) { redo.push(editor.value); editor.value = undo.pop(); persist(editor.value); render(editor.value); } else if (name === 'redo' && redo.length) { undo.push(editor.value); editor.value = redo.pop(); persist(editor.value); render(editor.value); } else if (name === 'txt') download('txt','text/plain',editor.value); else if (name === 'markdown') download('md','text/markdown',editor.value); else if (name === 'json') download('json','application/json',JSON.stringify({ config: state, prompt: editor.value, analysis: analyze(editor.value) }, null, 2)); else if (name === 'preset') { const nameValue = window.prompt('Preset name', `${state.target} ${state.type}`); if (!nameValue?.trim()) return; const list = read(KEYS.presets, []); list.unshift({ id: crypto.randomUUID?.() || String(Date.now()), name:nameValue.trim(), target:state.target, type:state.type, config:{...state, content:undefined}, createdAt:new Date().toISOString() }); localStorage.setItem(KEYS.presets, JSON.stringify(list)); presets(); toast('Preset disimpan.'); } }
  function init() { fields(); toggles(); const editor = $('#generated-prompt'); editor.value = state.content || assemble(); render(editor.value); presets(); document.querySelectorAll('[data-generator-action]').forEach(button => button.onclick = () => action(button.dataset.generatorAction)); editor.oninput = () => { persist(editor.value); render(editor.value); }; editor.onscroll = () => { $('#prompt-highlight').scrollTop = editor.scrollTop; $('#prompt-highlight').scrollLeft = editor.scrollLeft; }; window.addEventListener('beforeunload', () => { const history = read(KEYS.history, []); if (editor.value.trim() && history[0]?.prompt !== editor.value) { history.unshift({ prompt:editor.value, target:state.target, type:state.type, createdAt:new Date().toISOString() }); localStorage.setItem(KEYS.history, JSON.stringify(history.slice(0, 30))); } }); }
  init();
})();
