(() => {
  'use strict';
  if (window.__AIADS_PROVIDER_MOBILE_FLOW_FIX_V2__) return;
  window.__AIADS_PROVIDER_MOBILE_FLOW_FIX_V2__ = true;

  const root = document.documentElement;
  let provider = null;
  let pageContent = null;
  let observer = null;

  /*
   * The previous mobile workaround moved #ai-providers out of .page-content,
   * hid the real page and locked body scrolling. Besides breaking touch scroll
   * in embedded previews, that produced a visible first-frame/second-frame
   * swap while the route was being re-parented. Keep Providers in the normal
   * document flow instead and let the document own vertical scrolling.
   */
  const style = document.createElement('style');
  style.dataset.aiadsProviderMobileHostFix = '20260913-flow-v2';
  style.textContent = `
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
       * Providers stays inside .page-content. Vertical scrolling belongs to the
       * document/body, never to a fixed inner panel. These rules are scoped to
       * the active Providers route so every other page keeps its existing layout.
       */
      html.aiads-provider-page-flow,
      html.aiads-provider-page-flow body{
        width:100%!important;
        max-width:100%!important;
        height:auto!important;
        min-height:100%!important;
        max-height:none!important;
        overflow-x:hidden!important;
        overflow-y:auto!important;
      }

      html.aiads-provider-page-flow body{
        position:static!important;
        touch-action:pan-y!important;
        -webkit-overflow-scrolling:touch!important;
        overscroll-behavior-y:auto!important;
      }

      html.aiads-provider-page-flow .app-shell,
      html.aiads-provider-page-flow .app-shell>main{
        position:relative!important;
        height:auto!important;
        min-height:100dvh!important;
        max-height:none!important;
        overflow:visible!important;
      }

      html.aiads-provider-page-flow .app-shell>main>.page-content{
        display:block!important;
        position:relative!important;
        height:auto!important;
        min-height:0!important;
        max-height:none!important;
        overflow:visible!important;
        padding-bottom:calc(118px + env(safe-area-inset-bottom, 0px))!important;
      }

      html.aiads-provider-page-flow #ai-providers{
        display:block!important;
        position:static!important;
        inset:auto!important;
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        height:auto!important;
        min-height:0!important;
        max-height:none!important;
        margin:0!important;
        padding:0!important;
        overflow:visible!important;
        transform:none!important;
        box-sizing:border-box!important;
        touch-action:pan-y!important;
      }

      html.aiads-provider-page-flow #ai-providers .provider-heading,
      html.aiads-provider-page-flow #ai-providers .provider-defaults,
      html.aiads-provider-page-flow #ai-providers .provider-layout,
      html.aiads-provider-page-flow #ai-providers .provider-sidebar,
      html.aiads-provider-page-flow #ai-providers .provider-detail,
      html.aiads-provider-page-flow #ai-providers .provider-form,
      html.aiads-provider-page-flow #ai-providers .form-grid,
      html.aiads-provider-page-flow #ai-providers .pipeline-card,
      html.aiads-provider-page-flow #ai-providers .simple-provider-shell,
      html.aiads-provider-page-flow #ai-providers .simple-provider-card{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        box-sizing:border-box!important;
      }

      html.aiads-provider-page-flow #ai-providers .provider-layout{
        display:block!important;
        min-height:0!important;
      }

      html.aiads-provider-page-flow #ai-providers .provider-sidebar{
        overflow:hidden!important;
        border-right:0!important;
        border-bottom:2px solid var(--neo-line)!important;
      }

      html.aiads-provider-page-flow #ai-providers .provider-list{
        display:flex!important;
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        gap:7px!important;
        overflow-x:auto!important;
        overflow-y:hidden!important;
        touch-action:pan-x pan-y!important;
      }

      html.aiads-provider-page-flow #ai-providers .provider-item{
        flex:0 0 min(180px,58vw)!important;
        width:auto!important;
        max-width:180px!important;
        min-width:0!important;
      }

      html.aiads-provider-page-flow #ai-providers input,
      html.aiads-provider-page-flow #ai-providers select,
      html.aiads-provider-page-flow #ai-providers textarea{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
      }

      /* Keep the existing bottom-navigation alignment unchanged. */
      .aiads-neo-theme .neo-bottom-nav>button:nth-child(1){grid-column:1!important}
      .aiads-neo-theme .neo-bottom-nav>button:nth-child(2){grid-column:2!important}
      .aiads-neo-theme .neo-bottom-nav>button:nth-child(4){grid-column:4!important}
      .aiads-neo-theme .neo-bottom-nav>button:nth-child(5){grid-column:5!important}
      .aiads-neo-theme .neo-bottom-nav>button.neo-main{
        position:absolute!important;
        left:50%!important;
        top:50%!important;
        margin:0!important;
        transform:translate(-50%,-50%)!important;
      }

      /* Neutralize a stale style/class left by the retired direct-host build. */
      html.aiads-provider-direct-host body{overflow-y:auto!important}
      html.aiads-provider-direct-host .app-shell>main>.page-content{display:block!important}
      html.aiads-provider-direct-host .app-shell>main>#ai-providers{
        position:static!important;
        inset:auto!important;
        height:auto!important;
        max-height:none!important;
        overflow:visible!important;
      }
    }
  `;
  document.head.appendChild(style);

  function ensureRefs() {
    provider = document.querySelector('#ai-providers');
    pageContent = document.querySelector('.app-shell > main > .page-content') || document.querySelector('.page-content');
    return Boolean(provider && pageContent);
  }

  function restoreNormalFlow() {
    if (!ensureRefs()) return false;

    /* Recover cleanly if an older build already moved Providers beside page-content. */
    if (provider.parentElement !== pageContent) {
      const generationQueue = pageContent.querySelector('#generation-queue');
      pageContent.insertBefore(provider, generationQueue || null);
    }

    root.classList.remove('aiads-provider-direct-host');
    return true;
  }

  function sync() {
    if (!restoreNormalFlow()) return;
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const active = !provider.classList.contains('hidden');
    root.classList.toggle('aiads-provider-page-flow', mobile && active);
  }

  function start() {
    if (!restoreNormalFlow()) return;

    /* Apply the correct flow immediately; do not wait one animation frame. */
    sync();

    observer?.disconnect();
    observer = new MutationObserver(sync);
    observer.observe(provider, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('hashchange', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    window.visualViewport?.addEventListener('resize', sync, { passive: true });
    window.addEventListener('pageshow', sync, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
