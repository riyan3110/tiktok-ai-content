(() => {
  'use strict';
  if (window.__AIADS_PROVIDER_LEGAL_FIX__) return;
  window.__AIADS_PROVIDER_LEGAL_FIX__ = true;

  const root = document.documentElement;
  let shellMain = null;
  let provider = null;
  let footer = null;
  let footerAnchor = null;
  let queued = false;

  const style = document.createElement('style');
  style.dataset.aiadsProviderLegalFix = '20260826a';
  style.textContent = `
    @media(max-width:767px){
      html.aiads-provider-direct-host #ai-providers>footer.provider-legal-footer{
        position:static!important;
        inset:auto!important;
        transform:none!important;
        display:flex!important;
        width:100%!important;
        max-width:none!important;
        min-width:0!important;
        margin:32px 0 0!important;
        padding:20px 4px 8px!important;
        box-sizing:border-box!important;
        align-items:center!important;
        justify-content:space-between!important;
        flex-wrap:wrap!important;
        gap:10px 16px!important;
        background:transparent!important;
        border:0!important;
        box-shadow:none!important;
        z-index:auto!important;
      }
      html.aiads-provider-direct-host #ai-providers>footer.provider-legal-footer nav{
        display:flex!important;
        align-items:center!important;
        flex-wrap:wrap!important;
        gap:10px 16px!important;
      }
    }
  `;
  document.head.appendChild(style);

  function ensureRefs() {
    shellMain ||= document.querySelector('.app-shell > main');
    provider ||= document.querySelector('#ai-providers');
    footer ||= shellMain?.querySelector(':scope > footer') || document.querySelector('.app-shell > main > footer');

    if (footer && !footerAnchor && footer.parentNode) {
      footerAnchor = document.createComment('aiads-legal-footer-original-position');
      footer.parentNode.insertBefore(footerAnchor, footer);
    }

    return Boolean(shellMain && provider && footer && footerAnchor);
  }

  function directProviderActive() {
    return window.matchMedia('(max-width: 767px)').matches
      && root.classList.contains('aiads-provider-direct-host')
      && provider
      && !provider.classList.contains('hidden');
  }

  function sync() {
    queued = false;
    if (!ensureRefs()) return;

    if (directProviderActive()) {
      footer.classList.add('provider-legal-footer');
      if (footer.parentNode !== provider) provider.appendChild(footer);
      return;
    }

    footer.classList.remove('provider-legal-footer');
    if (footerAnchor.parentNode && footer.parentNode !== footerAnchor.parentNode) {
      footerAnchor.parentNode.insertBefore(footer, footerAnchor.nextSibling);
    }
  }

  function queueSync() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  function start() {
    if (!ensureRefs()) return;
    new MutationObserver(queueSync).observe(root, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(queueSync).observe(provider, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('hashchange', queueSync, { passive: true });
    window.addEventListener('resize', queueSync, { passive: true });
    document.addEventListener('click', queueSync, true);
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
