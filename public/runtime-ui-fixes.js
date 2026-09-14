(() => {
  'use strict';
  if (window.__AIADS_RUNTIME_UI_FIXES__) return;
  window.__AIADS_RUNTIME_UI_FIXES__ = true;

  const root = document.documentElement;
  const themeStorageKey = 'ai-ads-lab-theme';
  const drawerStorageKey = 'ai-ads-lab-drawer-open';

  try {
    const savedTheme = localStorage.getItem(themeStorageKey);
    root.dataset.theme = savedTheme === 'light' ? 'light' : 'dark';
    // A stale remembered mobile drawer must never lock every page on startup.
    localStorage.removeItem(drawerStorageKey);
  } catch {
    root.dataset.theme = root.dataset.theme === 'light' ? 'light' : 'dark';
  }

  const style = document.createElement('style');
  style.id = 'aiads-runtime-ui-fixes';
  style.textContent = `
    html.aiads-neo-theme,
    html.aiads-neo-theme body{
      min-height:100%;
      height:auto!important;
      max-height:none!important;
    }
    html.aiads-neo-theme body:not(.drawer-open){
      overflow-x:hidden!important;
      overflow-y:auto!important;
      touch-action:auto!important;
      overscroll-behavior-y:auto!important;
    }
    html.aiads-neo-theme body:not(.drawer-open) .app-shell,
    html.aiads-neo-theme body:not(.drawer-open) main,
    html.aiads-neo-theme body:not(.drawer-open) .page-content,
    html.aiads-neo-theme body:not(.drawer-open) .page-view:not(.hidden){
      height:auto!important;
      max-height:none!important;
    }
    html.aiads-neo-theme body:not(.drawer-open) main,
    html.aiads-neo-theme body:not(.drawer-open) .page-content,
    html.aiads-neo-theme body:not(.drawer-open) .page-view:not(.hidden){
      overflow-y:visible!important;
    }

    html.aiads-neo-theme[data-theme="light"]{
      color-scheme:light!important;
    }
    html.aiads-neo-theme[data-theme="dark"]{
      color-scheme:dark!important;
      --neo-ink:#f2f4f8;
      --neo-paper:#0b0e14;
      --neo-white:#151a23;
      --neo-soft:#202735;
      --neo-line:#7d8798;
      --neo-muted:#d1d9e6;
      --neo-lime:#2c4f26;
      --neo-yellow:#4b3d19;
      --neo-purple:#382c60;
      --neo-blue:#173e59;
      --neo-mint:#174a38;
      --neo-peach:#5a3b1d;
      --neo-pink:#5a2c40;
      --neo-danger:#702f38;
      --neo-shadow:4px 5px 0 rgba(0,0,0,.42);
      background:var(--neo-paper)!important;
    }
    html.aiads-neo-theme[data-theme="dark"] body{
      background:var(--neo-paper)!important;
      color:var(--neo-ink)!important;
    }
    html.aiads-neo-theme[data-theme="dark"] body::before{
      background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px)!important;
    }
    html.aiads-neo-theme[data-theme="dark"] .topbar,
    html.aiads-neo-theme[data-theme="dark"] .sidebar,
    html.aiads-neo-theme[data-theme="dark"] .sidebar-brand,
    html.aiads-neo-theme[data-theme="dark"] .sidebar>.tiktok-connection,
    html.aiads-neo-theme[data-theme="dark"] #legacy-studio .actions,
    html.aiads-neo-theme[data-theme="dark"] .studio-panel,
    html.aiads-neo-theme[data-theme="dark"] .studio-card,
    html.aiads-neo-theme[data-theme="dark"] .content-studio-card{
      background:var(--neo-white)!important;
      color:var(--neo-ink)!important;
    }
    html.aiads-neo-theme[data-theme="dark"] input,
    html.aiads-neo-theme[data-theme="dark"] select,
    html.aiads-neo-theme[data-theme="dark"] textarea,
    html.aiads-neo-theme[data-theme="dark"] option{
      background:#10151e!important;
      color:var(--neo-ink)!important;
    }
    html.aiads-neo-theme[data-theme="dark"] .neo-profile-top{
      background:linear-gradient(125deg,#173448,#202b3b 58%,#173f35)!important;
    }
    html.aiads-neo-theme[data-theme="dark"] p,
    html.aiads-neo-theme[data-theme="dark"] small,
    html.aiads-neo-theme[data-theme="dark"] .neo-feature-card small,
    html.aiads-neo-theme[data-theme="dark"] .history-item .history-content p{
      color:var(--neo-muted)!important;opacity:1!important;
    }
    html.aiads-neo-theme[data-theme="dark"] .neo-home-banner,
    html.aiads-neo-theme[data-theme="dark"] .simple-provider-panel{
      background:var(--neo-white)!important;color:var(--neo-ink)!important;
    }
    html.aiads-neo-theme[data-theme="dark"] .simple-provider-active,
    html.aiads-neo-theme[data-theme="dark"] [id$="-save-status"],
    html.aiads-neo-theme[data-theme="dark"] .aiads-chat-error,
    html.aiads-neo-theme[data-theme="dark"] .danger,
    html.aiads-neo-theme[data-theme="dark"] .history-item .delete-item{
      color:var(--neo-ink)!important;opacity:1!important;
    }
    html.aiads-neo-theme[data-theme="dark"] input::placeholder,
    html.aiads-neo-theme[data-theme="dark"] textarea::placeholder{
      color:#b7c4d6!important;opacity:1!important;
    }
    html.aiads-neo-theme[data-theme="dark"] .slide-button,
    html.aiads-neo-theme[data-theme="dark"] .asset-preview,
    html.aiads-neo-theme[data-theme="dark"] .preview-frame{
      background:#10151e!important;
    }
  `;
  document.head.appendChild(style);

  function syncThemeButton() {
    const button = document.querySelector('#theme-toggle');
    if (!button) return;
    const light = root.dataset.theme === 'light';
    button.setAttribute('aria-label', light ? 'Gunakan tema gelap' : 'Gunakan tema terang');
    button.setAttribute('title', light ? 'Gunakan tema gelap' : 'Gunakan tema terang');
  }

  function bindThemeButton() {
    const button = document.querySelector('#theme-toggle');
    if (!button || button.dataset.runtimeThemeBound === 'true') return;
    button.dataset.runtimeThemeBound = 'true';
    if (typeof button.onclick !== 'function') {
      button.onclick = () => {
        root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
        try { localStorage.setItem(themeStorageKey, root.dataset.theme); } catch {}
        syncThemeButton();
      };
    }
    syncThemeButton();
  }

  function releaseStaleScrollLock() {
    const sidebar = document.querySelector('#sidebar');
    const backdrop = document.querySelector('#mobile-backdrop');
    const mobile = window.matchMedia('(max-width: 1023px)').matches;
    const drawerReallyOpen = Boolean(
      mobile && sidebar?.classList.contains('open') && backdrop?.classList.contains('open')
    );
    if (drawerReallyOpen) return;

    document.body.classList.remove('drawer-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('overflow-y');
    document.body.style.removeProperty('touch-action');
    root.style.removeProperty('overflow');
    root.style.removeProperty('overflow-y');
    root.style.removeProperty('touch-action');
  }

  bindThemeButton();
  releaseStaleScrollLock();

  window.addEventListener('pageshow', releaseStaleScrollLock);
  window.addEventListener('hashchange', () => setTimeout(releaseStaleScrollLock, 0));
  window.addEventListener('resize', releaseStaleScrollLock, { passive: true });
  document.addEventListener('click', event => {
    if (event.target.closest('.side-nav a,[data-workspace-view],[data-view],[data-page]')) {
      setTimeout(releaseStaleScrollLock, 0);
    }
  });

  new MutationObserver(() => {
    bindThemeButton();
  }).observe(document.body, { childList: true, subtree: true });
})();
