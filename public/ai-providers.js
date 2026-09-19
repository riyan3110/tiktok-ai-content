(() => {
  'use strict';

  // The public/static app still loads this legacy entrypoint directly.
  // Do not initialize the old provider connector UI anymore.
  window.__AIADS_LEGACY_PROVIDER_DISABLED__ = true;

  const mountLoader = () => {
    const section = document.getElementById('ai-providers');
    if (section && !section.querySelector('#simple-provider-root')) {
      section.innerHTML = '<div style="padding:24px;text-align:center;opacity:.72">Memuat Provider AI…</div>';
    }

    const src = '/ai-providers-simple.js?v=cache-20260912j-static-entrypoint';
    const alreadyLoaded = [...document.scripts].some(script => {
      try { return new URL(script.src, location.href).pathname === '/ai-providers-simple.js'; }
      catch (_) { return false; }
    });

    if (!alreadyLoaded) {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.dataset.aiadsProviderEntrypoint = 'unified-text-image';
      script.onerror = () => {
        if (section) section.innerHTML = '<div style="padding:24px"><b>Provider AI gagal dimuat.</b><br>Refresh halaman sekali.</div>';
      };
      document.head.appendChild(script);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountLoader, { once: true });
  else mountLoader();

  // Compatibility for modules that only need text execution.
  window.AIProviderConnector = {
    execute: async (prompt) => {
      const response = await fetch('/api/dynamic-ai/generate', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    },
    cancel: async () => ({ cancelled: false, dynamicProvider: true })
  };
})();
