(() => {
  'use strict';
  if (window.__AIADS_NEO_LAYOUT_FINAL__) return;
  window.__AIADS_NEO_LAYOUT_FINAL__ = true;

  const root = document.documentElement;
  const style = document.createElement('style');
  style.dataset.aiadsNeoLayoutFinal = '20260826b';
  style.textContent = `
    /* Stable mobile workspace header. */
    @media(max-width:767px){
      .aiads-neo-theme .neo-profile-top{
        display:grid!important;
        grid-template-columns:44px minmax(0,1fr) auto!important;
        align-items:center!important;
        column-gap:8px!important;
        row-gap:0!important;
        min-height:82px!important;
        padding:12px 14px!important;
      }
      .aiads-neo-theme .neo-profile-avatar{
        width:44px!important;
        height:44px!important;
        align-self:center!important;
        transform:translateY(3px)!important;
      }
      .aiads-neo-theme .neo-profile-copy{
        align-self:center!important;
        min-width:0!important;
        transform:translateY(3px)!important;
      }
      .aiads-neo-theme .neo-profile-copy small{
        display:block!important;
        margin:0 0 2px!important;
        font-size:.62rem!important;
        line-height:1.05!important;
        letter-spacing:.04em!important;
        white-space:nowrap!important;
      }
      .aiads-neo-theme .neo-profile-copy strong{
        display:block!important;
        margin:0!important;
        font-size:1rem!important;
        line-height:1.08!important;
        white-space:nowrap!important;
      }
      .aiads-neo-theme .neo-status-cluster{
        grid-column:3!important;
        grid-row:1!important;
        justify-self:end!important;
        align-self:center!important;
        display:flex!important;
        align-items:center!important;
        justify-content:flex-end!important;
        gap:5px!important;
        margin:0!important;
        padding:0!important;
        min-width:0!important;
        white-space:nowrap!important;
      }
      .aiads-neo-theme .neo-home-tiktok{
        display:flex!important;
        align-items:center!important;
        justify-content:flex-end!important;
        gap:5px!important;
        min-width:0!important;
      }
      .aiads-neo-theme .neo-home-tiktok .neo-tiktok-label{
        font-size:.96rem!important;
        font-weight:900!important;
        line-height:1!important;
      }
      .aiads-neo-theme .neo-home-tiktok .neo-tiktok-primary{
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        width:74px!important;
        min-width:74px!important;
        max-width:74px!important;
        height:30px!important;
        min-height:30px!important;
        padding:0 7px!important;
        margin:0!important;
        font-size:.68rem!important;
        line-height:1!important;
        text-align:center!important;
      }
      .aiads-neo-theme .neo-profile-chip{
        display:inline-flex!important;
        align-items:center!important;
        justify-content:center!important;
        min-height:28px!important;
        padding:4px 7px!important;
        margin:0!important;
        font-size:.58rem!important;
        line-height:1!important;
        white-space:nowrap!important;
      }
    }

    @media(max-width:420px){
      .aiads-neo-theme .neo-profile-top{
        grid-template-columns:42px minmax(0,1fr) auto!important;
        column-gap:6px!important;
        padding-inline:10px!important;
      }
      .aiads-neo-theme .neo-profile-avatar{width:42px!important;height:42px!important}
      .aiads-neo-theme .neo-profile-copy small{font-size:.58rem!important;letter-spacing:.02em!important}
      .aiads-neo-theme .neo-profile-copy strong{font-size:.94rem!important}
      .aiads-neo-theme .neo-status-cluster{gap:4px!important}
      .aiads-neo-theme .neo-home-tiktok{gap:4px!important}
      .aiads-neo-theme .neo-home-tiktok .neo-tiktok-label{font-size:.9rem!important}
      .aiads-neo-theme .neo-home-tiktok .neo-tiktok-primary{width:68px!important;min-width:68px!important;max-width:68px!important;height:28px!important;min-height:28px!important;font-size:.63rem!important;padding-inline:5px!important}
      .aiads-neo-theme .neo-profile-chip{min-height:26px!important;padding:3px 5px!important;font-size:.54rem!important}
    }

    /* Fixed navigation must be anchored by inset, not viewport-width math.
       This prevents it from changing the mobile layout width. */
    @media(max-width:767px){
      .aiads-neo-theme .neo-bottom-nav{
        position:fixed!important;
        left:12px!important;
        right:12px!important;
        width:auto!important;
        max-width:none!important;
        min-width:0!important;
        transform:none!important;
        grid-template-columns:minmax(0,1fr) minmax(0,1fr) 58px minmax(0,1fr) minmax(0,1fr)!important;
        overflow:visible!important;
        contain:none!important;
        box-sizing:border-box!important;
      }
      .aiads-neo-theme .neo-bottom-nav>button{
        min-width:0!important;
        max-width:100%!important;
        justify-self:stretch!important;
        align-self:center!important;
      }
      .aiads-neo-theme .neo-bottom-nav>button.neo-main{
        display:grid!important;
        grid-template-rows:auto auto!important;
        place-items:center!important;
        justify-self:center!important;
        align-self:center!important;
        width:56px!important;
        min-width:56px!important;
        max-width:56px!important;
        height:56px!important;
        min-height:56px!important;
        margin:0!important;
        margin-top:0!important;
        padding:5px!important;
        transform:none!important;
        line-height:1!important;
      }
      .aiads-neo-theme .neo-bottom-nav>button.neo-main i,
      .aiads-neo-theme .neo-bottom-nav>button.neo-main span{
        display:block!important;
        margin:0!important;
        line-height:1!important;
        text-align:center!important;
      }
      .aiads-neo-theme .neo-bottom-nav>button.neo-main span{font-size:.58rem!important;margin-top:2px!important}
    }

    /* AI Providers route: use an explicit JS-managed root class instead of :has().
       Some Android browsers were not consistently applying the :has() viewport rule. */
    @media(max-width:767px){
      html.aiads-provider-route,
      html.aiads-provider-route body,
      html.aiads-provider-route .app-shell{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        margin-left:0!important;
        overflow-x:hidden!important;
      }
      html.aiads-provider-route main{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        margin-left:0!important;
        overflow-x:hidden!important;
      }
      html.aiads-provider-route .topbar{
        left:0!important;
        right:0!important;
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        box-sizing:border-box!important;
      }
      html.aiads-provider-route .page-content{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        margin:0!important;
        padding-left:10px!important;
        padding-right:10px!important;
        box-sizing:border-box!important;
        overflow-x:hidden!important;
      }
      html.aiads-provider-route #ai-providers,
      html.aiads-provider-route #ai-providers .provider-heading,
      html.aiads-provider-route #ai-providers .provider-defaults,
      html.aiads-provider-route #ai-providers .provider-layout,
      html.aiads-provider-route #ai-providers .provider-sidebar,
      html.aiads-provider-route #ai-providers .provider-detail,
      html.aiads-provider-route #ai-providers .provider-form,
      html.aiads-provider-route #ai-providers .form-grid,
      html.aiads-provider-route #ai-providers .pipeline-card{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        box-sizing:border-box!important;
      }
      html.aiads-provider-route #ai-providers{
        margin:0!important;
        padding:0!important;
        overflow-x:hidden!important;
      }
      html.aiads-provider-route #ai-providers .provider-layout{display:block!important}
      html.aiads-provider-route #ai-providers .provider-sidebar{
        overflow:hidden!important;
        border-right:0!important;
      }
      html.aiads-provider-route #ai-providers .provider-list{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
        display:flex!important;
        overflow-x:auto!important;
        overflow-y:hidden!important;
      }
      html.aiads-provider-route #ai-providers .provider-item{
        flex:0 0 min(180px,58vw)!important;
        width:auto!important;
        max-width:180px!important;
        min-width:0!important;
      }
      html.aiads-provider-route #ai-providers input,
      html.aiads-provider-route #ai-providers select,
      html.aiads-provider-route #ai-providers textarea{
        width:100%!important;
        max-width:100%!important;
        min-width:0!important;
      }
    }
  `;

  document.head.appendChild(style);

  function syncProviderRoute() {
    const provider = document.querySelector('#ai-providers');
    const active = Boolean(provider && !provider.classList.contains('hidden'));
    root.classList.toggle('aiads-provider-route', active);
  }

  function watchProviderRoute() {
    const provider = document.querySelector('#ai-providers');
    if (provider) {
      const observer = new MutationObserver(syncProviderRoute);
      observer.observe(provider, { attributes: true, attributeFilter: ['class'] });
    }
    window.addEventListener('hashchange', syncProviderRoute, { passive: true });
    document.addEventListener('click', () => requestAnimationFrame(syncProviderRoute), true);
    syncProviderRoute();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchProviderRoute, { once: true });
  else watchProviderRoute();
})();
