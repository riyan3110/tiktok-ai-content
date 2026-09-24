(() => {
  'use strict';
  if (window.__AIADS_CHAT_COPY_PULL_REFRESH_V2__) return;
  window.__AIADS_CHAT_COPY_PULL_REFRESH_V2__ = true;

  // NOTE: The per-message copy button now lives in floating-chat.js (small,
  // bottom-right, on every assistant bubble). This module used to add its own
  // copy button too, which produced duplicate/overlapping buttons. That copy
  // logic has been removed; this module now only provides pull-to-refresh.

  const style = document.createElement('style');
  style.textContent = `
    html,body{overscroll-behavior-y:contain}
    .aiads-pull-refresh{position:fixed;left:50%;top:calc(8px + env(safe-area-inset-top));z-index:10020;transform:translate(-50%,-70px);opacity:0;pointer-events:none;background:rgba(18,18,24,.94);color:#f5f3ff;border:1px solid rgba(139,92,246,.38);border-radius:999px;padding:8px 13px;font:600 12px/1.2 system-ui,-apple-system,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.35);transition:opacity .12s ease,transform .12s ease}
    .aiads-pull-refresh.visible{opacity:1}
  `;
  document.head.appendChild(style);

  const indicator = document.createElement('div');
  indicator.className = 'aiads-pull-refresh';
  indicator.textContent = 'Tarik untuk refresh';
  document.body.appendChild(indicator);

  let tracking = false;
  let startY = 0;
  let rawDistance = 0;
  const threshold = 58;

  function blockedTarget(target) {
    return Boolean(target?.closest?.('.aiads-chat-panel,input,textarea,select,button,a,[contenteditable="true"]'));
  }

  function resetPull() {
    tracking = false;
    startY = 0;
    rawDistance = 0;
    indicator.classList.remove('visible');
    indicator.style.transform = 'translate(-50%,-70px)';
    indicator.textContent = 'Tarik untuk refresh';
  }

  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || window.scrollY > 2 || blockedTarget(event.target)) return;
    tracking = true;
    startY = event.touches[0].clientY;
    rawDistance = 0;
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    if (!tracking || event.touches.length !== 1) return;
    const delta = event.touches[0].clientY - startY;
    if (delta <= 0 || window.scrollY > 2) {
      resetPull();
      return;
    }
    if (delta < 4) return;

    // Take ownership of the downward gesture at the top of the page so Android
    // does not consume it as native browser overscroll/pull-to-refresh.
    if (event.cancelable) event.preventDefault();

    rawDistance = Math.min(140, delta);
    const ready = rawDistance >= threshold;
    const visualDistance = Math.min(88, rawDistance * 0.68);
    indicator.classList.add('visible');
    indicator.textContent = ready ? 'Lepas untuk refresh' : 'Tarik untuk refresh';
    indicator.style.transform = `translate(-50%,${Math.min(14, -38 + visualDistance * 0.62)}px)`;
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (!tracking) return;
    const reload = rawDistance >= threshold;
    if (!reload) {
      resetPull();
      return;
    }
    tracking = false;
    indicator.classList.add('visible');
    indicator.textContent = 'Memuat ulang…';
    indicator.style.transform = 'translate(-50%,10px)';
    setTimeout(() => window.location.reload(), 80);
  }, { passive: true });

  document.addEventListener('touchcancel', resetPull, { passive: true });
})();
