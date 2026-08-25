(() => {
  'use strict';
  if (window.__AIADS_PROVIDER_MOBILE_HOST_FIX__) return;
  window.__AIADS_PROVIDER_MOBILE_HOST_FIX__ = true;

  const root = document.documentElement;
  let provider = null;
  let pageContent = null;
  let shellMain = null;
  let anchor = null;
  let queued = false;

  const style = document.createElement('style');
  style.dataset.aiadsProviderMobileHostFix = '20260826c';
  style.textContent = `
    /* Providers desktop/tablet stays inside the normal page container. */
    @media(min-width:768px){
      .aiads-neo-theme #ai-providers,
      .aiads-neo-theme #ai-providers .provider-heading,
      .aiads-neo-theme #ai-providers .provider-defaults,
      .aiads-neo-theme #ai-providers .provider-layout,
      .aiads-neo-theme #ai-providers .provider-detail,
      .aiads-neo-theme #ai-providers .pipeline-card{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        box-sizing:border-box!important;
      }
      .aiads-neo-theme #ai-providers{margin:0!important}
      .aiads-neo-theme #ai-providers .provider-layout{
        grid-template-columns:minmax(210px,260px) minmax(0,1fr)!important;
      }
      .aiads-neo-theme #ai-providers .provider-detail{min-width:0!important}
    }

    @media(min-width:1024px){
      .aiads-neo-theme #ai-providers .provider-layout{
        grid-template-columns:260px minmax(0,1fr)!important;
      }
      .aiads-neo-theme #ai-providers .provider-defaults{
        grid-template-columns:repeat(3,minmax(0,1fr))!important;
      }
    }

    @media(max-width:767px){
      /*
       * Do not use percentage width here. A stale/legacy parent can be narrower
       * than the visual viewport, making width:100% inherit the same bad width.
       * Pin the Providers route shell to the actual viewport instead.
       */
      html.aiads-provider-direct-host,
      html.aiads-provider-direct-host body,
      html.aiads-provider-direct-host .app-shell,
      html.aiads-provider-direct-host .app-shell>main{
        width:100vw!important;
        width:100dvw!important;
        max-width:100vw!important;
        max-width:100dvw!important;
        min-width:100vw!important;
        min-width:100dvw!important;
        margin:0!important;
        padding-left:0!important;
        padding-right:0!important;
        overflow-x:hidden!important;
        box-sizing:border-box!important;
      }

      html.aiads-provider-direct-host .app-shell>main>.topbar{
        width:100vw!important;
        width:100dvw!important;
        max-width:100vw!important;
        max-width:100dvw!important;
        min-width:100vw!important;
        min-width:100dvw!important;
        margin:0!important;
        left:0!important;
        right:auto!important;
        box-sizing:border-box!important;
      }

      html.aiads-provider-direct-host .app-shell>main>.page-content{
        display:none!important;
      }

      html.aiads-provider-direct-host .app-shell>main>#ai-providers{
        display:block!important;
        width:100vw!important;
        width:100dvw!important;
        max-width:100vw!important;
        max-width:100dvw!important;
        min-width:0!important;
        margin:0!important;
        padding:16px 10px 104px!important;
        box-sizing:border-box!important;
        overflow-x:hidden!important;
      }

      html.aiads-provider-direct-host #ai-providers .provider-heading,
      html.aiads-provider-direct-host #ai-providers .provider-defaults,
      html.aiads-provider-direct-host #ai-providers .provider-layout,
      html.aiads-provider-direct-host #ai-providers .provider-sidebar,
      html.aiads-provider-direct-host #ai-providers .provider-detail,
      html.aiads-provider-direct-host #ai-providers .provider-form,
      html.aiads-provider-direct-host #ai-providers .form-grid,
      html.aiads-provider-direct-host #ai-providers .pipeline-card{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        box-sizing:border-box!important;
      }

      html.aiads-provider-direct-host #ai-providers .provider-layout{
        display:block!important;
        min-height:0!important;
      }

      html.aiads-provider-direct-host #ai-providers .provider-sidebar{
        overflow:hidden!important;
        border-right:0!important;
        border-bottom:2px solid var(--neo-line)!important;
      }

      html.aiads-provider-direct-host #ai-providers .provider-list{
        display:flex!important;
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        gap:7px!important;
        overflow-x:auto!important;
        overflow-y:hidden!important;
      }

      html.aiads-provider-direct-host #ai-providers .provider-item{
        flex:0 0 min(180px,58vw)!important;
        width:auto!important;
        max-width:180px!important;
        min-width:0!important;
      }

      html.aiads-provider-direct-host #ai-providers input,
      html.aiads-provider-direct-host #ai-providers select,
      html.aiads-provider-direct-host #ai-providers textarea{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
      }

      /* Visual center: the previous 0px position still reads slightly low. */
      .aiads-neo-theme .neo-bottom-nav>button.neo-main{
        transform:translateY(-2px)!important;
      }
    }
  `;
  document.head.appendChild(style);

  function ensureRefs() {
    provider ||= document.querySelector('#ai-providers');
    shellMain ||= document.querySelector('.app-shell > main');
    pageContent ||= shellMain?.querySelector('.page-content') || document.querySelector('.page-content');
    if (provider && !anchor && provider.parentNode) {
      anchor = document.createComment('ai-providers-original-position');
      provider.parentNode.insertBefore(anchor, provider);
    }
    return Boolean(provider && shellMain && pageContent && anchor);
  }

  function providerActive() {
    return Boolean(provider && !provider.classList.contains('hidden'));
  }

  function sync() {
    queued = false;
    if (!ensureRefs()) return;
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const direct = mobile && providerActive();

    if (direct) {
      if (provider.parentNode !== shellMain) shellMain.insertBefore(provider, pageContent);
      root.classList.add('aiads-provider-direct-host');
      return;
    }

    root.classList.remove('aiads-provider-direct-host');
    if (anchor.parentNode && provider.parentNode !== anchor.parentNode) {
      anchor.parentNode.insertBefore(provider, anchor.nextSibling);
    }
  }

  function queueSync() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  function start() {
    if (!ensureRefs()) return;
    new MutationObserver(queueSync).observe(provider, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('hashchange', queueSync, { passive: true });
    window.addEventListener('resize', queueSync, { passive: true });
    window.visualViewport?.addEventListener('resize', queueSync, { passive: true });
    document.addEventListener('click', queueSync, true);
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
