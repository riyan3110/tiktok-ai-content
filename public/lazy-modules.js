(() => {
  'use strict';
  if (window.AIAdsLazyModules) return;

  const VERSION = 'global-perf-20260825a';
  const loaded = new Set();
  const pending = new Map();
  const prefetched = new Set();
  const groups = {
    text: ['/background-state.js', '/app.js'],
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

  const versioned = src => `${src}${src.includes('?') ? '&' : '?'}v=${VERSION}`;

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
      script.src = versioned(src);
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
    const scripts = groups[name] || [];
    if (!scripts.length) return;
    const previousGroup = window.__AIADS_LOADING_GROUP__;
    window.__AIADS_LOADING_GROUP__ = name;
    document.documentElement.dataset.aiadsModuleLoading = name;
    try {
      for (const src of scripts) await loadScript(src);
    } finally {
      if (previousGroup) window.__AIADS_LOADING_GROUP__ = previousGroup;
      else delete window.__AIADS_LOADING_GROUP__;
      if (document.documentElement.dataset.aiadsModuleLoading === name) delete document.documentElement.dataset.aiadsModuleLoading;
    }
  }

  function prefetchScript(src) {
    if (loaded.has(src) || prefetched.has(src)) return;
    prefetched.add(src);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'script';
    link.href = versioned(src);
    link.dataset.aiadsPrefetch = src;
    try { link.fetchPriority = 'low'; } catch (_) {}
    document.head.appendChild(link);
  }

  function prefetch(name) {
    for (const src of groups[name] || []) prefetchScript(src);
  }

  function groupFromTarget(target) {
    if (!target) return null;
    if (target.matches('[data-workspace-view="legacy"]')) return 'text';
    if (target.matches('[data-workspace-view="assets"],[data-workspace-view="storage"]')) return 'assets';
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
      case '#trend-reference':
      case '#schedule-dashboard':
      case '#history-section': return 'text';
      case '#assets':
      case '#storage': return 'assets';
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

  function scheduleIdlePrefetch() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection?.saveData) return;
    const order = ['text', 'studio', 'assets', 'workflow', 'generator', 'providers', 'templates', 'factory', 'consistency', 'profile', 'queue', 'integration'];
    let index = 0;
    const next = () => {
      if (document.visibilityState === 'hidden' || index >= order.length) return;
      prefetch(order[index++]);
      setTimeout(() => {
        if ('requestIdleCallback' in window) requestIdleCallback(next, { timeout: 1500 });
        else next();
      }, 450);
    };
    setTimeout(() => {
      if ('requestIdleCallback' in window) requestIdleCallback(next, { timeout: 1200 });
      else next();
    }, 700);
  }

  markExisting();
  document.addEventListener('click', async event => {
    const assetPicker = event.target.closest('#studio-select-assets');
    if (assetPicker && !window.AssetManager) {
      event.preventDefault();
      event.stopImmediatePropagation();
      try { await load('assets'); assetPicker.click(); }
      catch (error) { console.error('[AI Ads Lab lazy module]', error); }
      return;
    }

    const promptTab = event.target.closest('[data-project-tab="prompts"]');
    if (promptTab && !window.PromptStudio) {
      event.preventDefault();
      event.stopImmediatePropagation();
      try { await load('prompt-studio'); promptTab.click(); }
      catch (error) { console.error('[AI Ads Lab lazy module]', error); }
      return;
    }

    warm(groupFromTarget(event.target.closest('[data-workspace-view]')));
  }, true);

  window.addEventListener('hashchange', () => warm(groupFromHash()));
  window.addEventListener('load', scheduleIdlePrefetch, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => warm(groupFromHash()), { once: true });
  else warm(groupFromHash());

  window.AIAdsLazyModules = {
    load,
    prefetch,
    loaded: name => (groups[name] || []).every(src => loaded.has(src))
  };
})();
