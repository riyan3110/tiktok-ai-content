(() => {
  'use strict';
  if (window.__AIADS_PERFORMANCE_SHELL__) return;
  window.__AIADS_PERFORMANCE_SHELL__ = true;

  const root = document.documentElement;
  const $ = selector => document.querySelector(selector);

  // Keep the app chrome usable without loading the large Text Content bundle.
  try {
    const saved = localStorage.getItem('ai-ads-lab-theme');
    root.dataset.theme = saved === 'light' ? 'light' : 'dark';
  } catch (_) {}

  function syncThemeButton() {
    const button = $('#theme-toggle');
    if (!button) return;
    const light = root.dataset.theme === 'light';
    button.innerHTML = `<span aria-hidden="true">${light ? '☾' : '☀'}</span>`;
    button.setAttribute('aria-label', light ? 'Gunakan tema gelap' : 'Gunakan tema terang');
  }

  const themeButton = $('#theme-toggle');
  if (themeButton) {
    themeButton.onclick = () => {
      root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('ai-ads-lab-theme', root.dataset.theme); } catch (_) {}
      syncThemeButton();
    };
  }
  syncThemeButton();

  function ensureBlackBackgroundOption() {
    const options = $('#background-options');
    if (!options || options.querySelector('input[name="carousel-background"][value="#0B0B0D"]')) return;
    const upload = options.querySelector('.background-upload-option');
    const black = document.createElement('label');
    black.className = 'background-option background-black-option';
    black.innerHTML = '<input type="radio" name="carousel-background" value="#0B0B0D"><span class="background-swatch" style="--swatch:#0B0B0D"><i>✓</i></span><b>Hitam</b>';
    if (upload) upload.before(black); else options.appendChild(black);
  }

  async function json(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Permintaan gagal (${response.status})`);
    return data;
  }

  const connection = $('#tiktok-connection');
  if (connection && !connection.dataset.performanceShellBound) {
    connection.dataset.performanceShellBound = 'true';
    const status = connection.querySelector('[data-tiktok-status]');
    const disconnect = connection.querySelector('[data-tiktok-disconnect]');
    const connectLinks = connection.querySelectorAll('[data-tiktok-connect],[data-tiktok-reconnect]');

    const render = (state, account) => {
      connection.dataset.state = state;
      if (status) {
        status.textContent = state === 'connected' ? 'TikTok Connected' : state === 'connecting' ? 'Menghubungkan TikTok…' : state === 'error' ? 'TikTok Error' : state === 'loading' ? 'Memuat TikTok…' : 'TikTok Disconnected';
        status.title = account?.displayName || '';
      }
    };

    const refresh = async () => {
      render('loading');
      try {
        const result = await json('/api/tiktok/status', { cache: 'no-store' });
        render(result.connected ? 'connected' : 'disconnected', result.account);
        return result;
      } catch (_) {
        render('error');
        return null;
      }
    };

    connectLinks.forEach(link => { link.addEventListener('click', () => render('connecting'), { passive: true }); });
    if (disconnect) disconnect.onclick = async () => {
      disconnect.disabled = true;
      try { await json('/api/tiktok/connection', { method: 'DELETE' }); await refresh(); }
      catch (_) { render('error'); }
      finally { disconnect.disabled = false; }
    };
    refresh();
  }

  // Intervals created by Text Content are UI refresh timers. Keep them asleep
  // while another workspace page is active so they do not steal bandwidth/CPU.
  const nativeSetInterval = window.setInterval.bind(window);
  window.setInterval = (callback, delay, ...args) => {
    const loadingGroup = window.__AIADS_LOADING_GROUP__;
    if (loadingGroup === 'text' && Number(delay) === 30000 && typeof callback === 'function') {
      return nativeSetInterval(() => {
        const legacy = $('#legacy-studio');
        if (document.visibilityState === 'visible' && legacy && !legacy.classList.contains('hidden')) callback(...args);
      }, delay);
    }
    return nativeSetInterval(callback, delay, ...args);
  };

  function optimizeMedia(node) {
    if (!node || node.nodeType !== 1) return;
    const items = node.matches?.('img,video,audio') ? [node] : [...(node.querySelectorAll?.('img,video,audio') || [])];
    for (const media of items) {
      if (media.tagName === 'IMG') {
        if (!media.hasAttribute('loading')) media.loading = 'lazy';
        if (!media.hasAttribute('decoding')) media.decoding = 'async';
      } else if (!media.hasAttribute('preload')) {
        media.preload = 'none';
      }
    }
  }

  function initializeDomShell() {
    ensureBlackBackgroundOption();
    optimizeMedia(document.body);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(optimizeMedia))).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeDomShell, { once: true });
  else initializeDomShell();

  // The service worker preserves the upload compatibility route and caches only
  // versioned/static GET assets. Registration itself must never block startup.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js?v=global-perf-20260825b').catch(() => {}), { once: true });
  }
})();
