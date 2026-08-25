(() => {
  const SUSPENDED_MESSAGE = 'Jadwal otomatis sementara dinonaktifkan.';

  function hideElement(element) {
    if (!element) return;
    element.hidden = true;
    element.setAttribute('aria-hidden', 'true');
    element.style.setProperty('display', 'none', 'important');
  }

  function applySuspendedUi() {
    const toggle = document.getElementById('automation-toggle');
    if (toggle) {
      toggle.checked = false;
      toggle.disabled = true;
      hideElement(toggle.closest('label'));
    }

    hideElement(document.getElementById('automation-settings'));
    hideElement(document.getElementById('schedule-dashboard'));

    const help = document.getElementById('mode-help');
    if (help && /otomatis/i.test(help.textContent || '')) {
      help.textContent = 'Mode manual: konten dibuat dan diunggah hanya melalui tombol.';
    }
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input?.url;
    if (raw) {
      try {
        const url = new URL(raw, window.location.origin);
        if (url.pathname === '/automation/today') {
          return Promise.resolve(new Response('[]', {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
        if (url.pathname.startsWith('/automation/') && String(init.method || 'GET').toUpperCase() !== 'GET') {
          return Promise.resolve(new Response(JSON.stringify({ error: SUSPENDED_MESSAGE }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          }));
        }
      } catch (_) {}
    }
    return nativeFetch(input, init);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applySuspendedUi, { once: true });
  else applySuspendedUi();

  window.addEventListener('hashchange', applySuspendedUi);
  new MutationObserver(applySuspendedUi).observe(document.documentElement, { childList: true, subtree: true });
})();
