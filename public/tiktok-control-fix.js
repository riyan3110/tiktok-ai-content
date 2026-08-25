(() => {
  'use strict';
  if (window.__AIADS_TIKTOK_CONTROL_FIX__) return;
  window.__AIADS_TIKTOK_CONTROL_FIX__ = true;

  const style = document.createElement('style');
  style.dataset.aiadsTikTokControlFix = '20260826a';
  style.textContent = `
    .aiads-neo-theme .neo-home-tiktok .neo-tiktok-primary.connected{
      pointer-events:auto!important;
      cursor:pointer!important;
    }
    .aiads-neo-theme .neo-home-tiktok .neo-tiktok-primary[data-tiktok-busy="true"]{
      pointer-events:none!important;
      opacity:.72!important;
      cursor:wait!important;
    }
  `;
  document.head.appendChild(style);

  function getConnection() {
    return document.querySelector('#tiktok-connection');
  }

  function syncPrimary() {
    const connection = getConnection();
    const primary = connection?.querySelector('[data-tiktok-primary]');
    if (!connection || !primary) return false;

    const state = connection.dataset.state || 'loading';
    const connected = state === 'connected';
    const busy = state === 'connecting' || state === 'loading';

    primary.dataset.tiktokBusy = String(busy);
    primary.setAttribute('aria-disabled', String(busy));
    primary.tabIndex = busy ? -1 : 0;
    primary.title = connected
      ? 'Putuskan koneksi TikTok'
      : busy
        ? 'Memeriksa koneksi TikTok'
        : 'Hubungkan TikTok';
    return true;
  }

  function activatePrimary(event) {
    const primary = event.target.closest?.('[data-tiktok-primary]');
    if (!primary) return;

    const connection = primary.closest('#tiktok-connection');
    if (!connection) return;

    event.preventDefault();
    event.stopPropagation();

    const state = connection.dataset.state || 'loading';
    if (state === 'connecting' || state === 'loading') return;

    if (state === 'connected') {
      connection.querySelector('[data-tiktok-disconnect]')?.click();
      return;
    }

    const connect = connection.querySelector('[data-tiktok-connect]')
      || connection.querySelector('[data-tiktok-reconnect]');
    if (connect) {
      connect.click();
      return;
    }

    window.location.assign('/auth/tiktok');
  }

  function start() {
    const connection = getConnection();
    if (!connection) return;

    document.addEventListener('click', activatePrimary, true);
    new MutationObserver(() => requestAnimationFrame(syncPrimary)).observe(connection, {
      attributes: true,
      attributeFilter: ['data-state'],
      childList: true,
      subtree: true
    });
    syncPrimary();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
