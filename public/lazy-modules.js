(() => {
  'use strict';
  if (window.AIAdsLazyModules) return;

  const loaded = new Set();
  const pending = new Map();
  const groups = {
    assets: ['/assets.js'],
    studio: ['/assets.js', '/content-studio-vidu-models.js', '/content-studio.js'],
    workflow: ['/workflow-history.js', '/workflow.js'],
    factory: ['/content-factory.js'],
    'prompt-studio': ['/prompt-studio.js'],
    consistency: ['/consistency.js'],
    generator: ['/prompt-generator.js'],
    providers: ['/ai-providers.js'],
    queue: ['/generation-queue.js'],
    integration: ['/ai-integration.js'],
    profile: ['/account-workspace.js'],
    templates: ['/templates.js']
  };

  function markExisting() {
    document.querySelectorAll('script[src]').forEach(script => {
      loaded.add(new URL(script.src, location.href).pathname);
    });
  }

  function loadScript(src) {
    if (loaded.has(src)) return Promise.resolve();
    if (pending.has(src)) return pending.get(src);
    const task = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.aiadsLazy = 'true';
      script.onload = () => { loaded.add(src); pending.delete(src); resolve(); };
      script.onerror = () => { pending.delete(src); reject(new Error(`Gagal memuat modul ${src}`)); };
      document.head.appendChild(script);
    });
    pending.set(src, task);
    return task;
  }

  async function load(name) {
    for (const src of groups[name] || []) await loadScript(src);
  }

  function groupFromTarget(target) {
    if (!target) return null;
    if (target.matches('[data-workspace-view="assets"]')) return 'assets';
    if (target.matches('[data-workspace-view="studio"]')) return 'studio';
    if (target.matches('[data-workspace-view="workflow"]')) return 'workflow';
    if (target.matches('[data-workspace-view="factory"]')) return 'factory';
    if (target.matches('[data-workspace-view="consistency"]')) return 'consistency';
    if (target.matches('[data-workspace-view="generator"]')) return 'generator';
    if (target.matches('[data-workspace-view="providers"]')) return 'providers';
    if (target.matches('[data-workspace-view="queue"]')) return 'queue';
    if (target.matches('[data-workspace-view="integration"]')) return 'integration';
    if (target.matches('[data-workspace-view="profile"]')) return 'profile';
    if (target.matches('[data-workspace-view="templates"]')) return 'templates';
    return null;
  }

  function groupFromHash() {
    switch (location.hash) {
      case '#assets': return 'assets';
      case '#studio': return 'studio';
      case '#workflow': return 'workflow';
      case '#content-factory': return 'factory';
      case '#consistency': return 'consistency';
      case '#prompt-generator': return 'generator';
      case '#ai-providers': return 'providers';
      case '#generation-queue': return 'queue';
      case '#ai-integration': return 'integration';
      case '#profile':
      case '#settings': return 'profile';
      case '#templates': return 'templates';
      default: return null;
    }
  }

  function warm(name) {
    if (!name) return;
    load(name).catch(error => console.error('[AI Ads Lab lazy module]', error));
  }

  markExisting();
  document.addEventListener('click', event => warm(groupFromTarget(event.target.closest('[data-workspace-view]'))), true);
  window.addEventListener('hashchange', () => warm(groupFromHash()));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => warm(groupFromHash()), { once: true });
  else warm(groupFromHash());

  window.AIAdsLazyModules = {
    load,
    loaded: name => (groups[name] || []).every(src => loaded.has(src))
  };
})();
