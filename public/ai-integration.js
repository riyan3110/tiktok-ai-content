(() => {
  'use strict';
  const KEYS = { config: 'integration.config', logs: 'integration.logs', health: 'integration.health' };
  const PROVIDERS = ['Gemini Mock', 'OpenAI Mock', 'Claude Mock', 'Flow Mock', 'Veo Mock'];
  const PIPELINE = ['Prompt', 'Request Builder', 'Provider Adapter', 'Transport', 'Response Parser', 'Queue', 'History'];
  const STREAM = ['Connecting', 'Streaming', 'Receiving', 'Completed'];
  const $ = selector => document.querySelector(selector);
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const safe = value => { const node = document.createElement('span'); node.textContent = String(value ?? ''); return node.innerHTML; };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
  const id = () => crypto.randomUUID?.() || `mock-${Date.now()}`;
  let config = { provider: PROVIDERS[0], model: 'mock-v1', ...read(KEYS.config, {}) };
  let logs = read(KEYS.logs, []);
  let health = read(KEYS.health, Object.fromEntries(PROVIDERS.map((name, index) => [name, index === 3 ? 'Warning' : 'Healthy'])));
  let activeController = null;

  class ProviderAdapter {
    constructor(name) { this.name = name; this.controller = null; }
    buildRequest(input) {
      return { prompt: input.prompt, systemPrompt: input.systemPrompt || '', temperature: Number(input.temperature), topP: Number(input.topP), topK: Number(input.topK), seed: input.seed === '' ? null : Number(input.seed), model: input.model || 'mock-v1', files: input.files || [], metadata: { ...input.metadata, provider: this.name, mock: true } };
    }
    validate(request) { if (!request.prompt.trim()) throw createError('Validation Error', 'Prompt is required.'); return true; }
    async send(request, onStream) {
      this.controller = new AbortController();
      for (const state of STREAM) { if (this.controller.signal.aborted) throw createError('Unknown Error', 'Request cancelled.'); onStream(state); await delay(360); }
      return { output: `Mock response from ${this.name}: ${request.prompt.slice(0, 120)}`, promptTokens: Math.ceil(request.prompt.length / 4), completionTokens: 28, finishReason: 'mock_complete' };
    }
    parse(response) { return { content: response.output, usage: { unit: 'tokens', mock: true }, tokens: { prompt: response.promptTokens, completion: response.completionTokens, total: response.promptTokens + response.completionTokens }, images: [], videos: [], warnings: ['Simulation only — no network request was made.'], finishReason: response.finishReason }; }
    cancel() { this.controller?.abort(); }
    health() { return { provider: this.name, status: health[this.name] || 'Offline', checkedAt: new Date().toISOString() }; }
  }
  const createError = (type, message) => Object.assign(new Error(message), { type });
  const adapters = new Map(PROVIDERS.map(name => [name, new ProviderAdapter(name)]));

  function toast(message, error = false) { const node = $('#consistency-toast'); node.textContent = message; node.className = `consistency-toast show${error ? ' error' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.className = 'consistency-toast'; }, 2300); }
  function renderProviders() { $('#integration-providers').innerHTML = PROVIDERS.map(name => `<button type="button" data-integration-provider="${safe(name)}" class="integration-provider ${name === config.provider ? 'active' : ''}"><span>${safe(name.split(' ')[0].slice(0, 2).toUpperCase())}</span><b>${safe(name)}</b><i class="health-${safe((health[name] || 'Offline').toLowerCase())}">● ${safe(health[name] || 'Offline')}</i></button>`).join(''); document.querySelectorAll('[data-integration-provider]').forEach(button => button.onclick = () => { config.provider = button.dataset.integrationProvider; $('#integration-provider').value = config.provider; write(KEYS.config, config); renderProviders(); renderMonitor(); }); }
  function renderMonitor(job = {}) { const values = { 'Current Job': job.id || '—', Latency: job.latency ? `${job.latency} ms` : '—', Provider: job.provider || config.provider, Model: job.model || config.model, Retry: job.retry ?? 0, Duration: job.duration ? `${job.duration} ms` : '—', Status: job.status || 'Idle' }; $('#integration-monitor').innerHTML = Object.entries(values).map(([key, value]) => `<div><dt>${key}</dt><dd>${safe(value)}</dd></div>`).join(''); }
  function renderLogs() { $('#integration-log-empty').classList.toggle('hidden', logs.length > 0); $('#integration-log-rows').innerHTML = logs.map(log => `<tr><td>${new Date(log.timestamp).toLocaleString('id-ID')}</td><td>${safe(log.provider)}</td><td>${log.duration} ms</td><td>${log.requestSize} B</td><td>${log.responseSize} B</td><td><span class="log-${safe(log.status.toLowerCase())}">${safe(log.status)}</span></td></tr>`).join(''); }
  function setStage(name) { document.querySelectorAll('[data-pipeline-stage]').forEach(node => node.classList.toggle('active', node.dataset.pipelineStage === name)); }
  function setBusy(busy) { $('#integration-run').disabled = busy; $('#integration-cancel').disabled = !busy; }
  function showError(error) { const type = ['Timeout', 'Rate Limit', 'Authentication Error', 'Validation Error', 'Network Error'].includes(error.type) ? error.type : 'Unknown Error'; $('#integration-error').classList.remove('hidden'); $('#integration-error').innerHTML = `<b>${safe(type)}</b><span>${safe(error.message)}</span>`; toast(`${type}: ${error.message}`, true); }
  async function run(event) {
    event.preventDefault(); $('#integration-error').classList.add('hidden');
    const adapter = adapters.get($('#integration-provider').value); const started = performance.now(); const jobId = `INT-${Date.now().toString(36).toUpperCase()}`;
    let request; let response; setBusy(true); activeController = adapter;
    try {
      setStage('Request Builder'); request = adapter.buildRequest({ prompt: $('#integration-prompt').value, systemPrompt: $('#integration-system-prompt').value, temperature: $('#integration-temperature').value, topP: $('#integration-top-p').value, topK: $('#integration-top-k').value, seed: $('#integration-seed').value, model: $('#integration-model').value, files: [], metadata: { jobId, source: 'ai-integration-ui' } }); adapter.validate(request);
      config = { provider: adapter.name, model: request.model }; write(KEYS.config, config); setStage('Provider Adapter'); await delay(200); setStage('Transport');
      const raw = await adapter.send(request, state => { $('#integration-stream').textContent = state; $('#integration-stream').className = `stream-state stream-${state.toLowerCase()}`; renderMonitor({ id: jobId, provider: adapter.name, model: request.model, latency: Math.round(performance.now() - started), status: state }); });
      setStage('Response Parser'); response = adapter.parse(raw); await delay(180); setStage('Queue'); if (window.GenerationQueue) window.GenerationQueue.enqueue({ prompt: request.prompt, provider: adapter.name, model: request.model, project: 'AI Integration', promptType: 'Normalized' }); setStage('History');
      $('#integration-result').innerHTML = `<div><span>✓</span><b>Normalized Response</b></div><p>${safe(response.content)}</p><small>${response.tokens.total} tokens · ${safe(response.finishReason)}</small><ul>${response.warnings.map(item => `<li>${safe(item)}</li>`).join('')}</ul>`;
      const duration = Math.round(performance.now() - started); logs.unshift({ timestamp: new Date().toISOString(), provider: adapter.name, duration, requestSize: bytes(request), responseSize: bytes(response), status: 'Completed' }); logs = logs.slice(0, 100); write(KEYS.logs, logs); renderLogs(); renderMonitor({ id: jobId, provider: adapter.name, model: request.model, latency: duration, duration, status: 'Completed' }); toast('Mock response normalized and queued.');
    } catch (error) { showError(error); const duration = Math.round(performance.now() - started); logs.unshift({ timestamp: new Date().toISOString(), provider: adapter?.name || 'Unknown', duration, requestSize: request ? bytes(request) : 0, responseSize: 0, status: 'Error' }); write(KEYS.logs, logs); renderLogs(); renderMonitor({ id: jobId, provider: adapter?.name, duration, status: error.message === 'Request cancelled.' ? 'Cancelled' : 'Error' }); }
    finally { activeController = null; setBusy(false); }
  }
  function checkHealth() { $('#integration-health-check').disabled = true; PROVIDERS.forEach((name, index) => { health[name] = index === 4 ? 'Offline' : index === 3 ? 'Warning' : 'Healthy'; }); setTimeout(() => { write(KEYS.health, health); renderProviders(); $('#integration-health-check').disabled = false; toast('Mock health check completed.'); }, 650); }

  $('#integration-flow').innerHTML = PIPELINE.map((name, index) => `<div data-pipeline-stage="${safe(name)}"><span>${String(index + 1).padStart(2, '0')}</span><b>${safe(name)}</b></div>${index < PIPELINE.length - 1 ? '<i>↓</i>' : ''}`).join('');
  $('#integration-provider').innerHTML = PROVIDERS.map(name => `<option>${safe(name)}</option>`).join(''); $('#integration-provider').value = config.provider; $('#integration-model').value = config.model;
  $('#integration-provider').onchange = event => { config.provider = event.target.value; write(KEYS.config, config); renderProviders(); renderMonitor(); }; $('#integration-form').onsubmit = run; $('#integration-cancel').onclick = () => activeController?.cancel(); $('#integration-health-check').onclick = checkHealth; $('#integration-clear-logs').onclick = () => { logs = []; write(KEYS.logs, logs); renderLogs(); toast('Integration logs cleared.'); };
  renderProviders(); renderMonitor(); renderLogs(); window.ProviderAdapter = ProviderAdapter;
})();
