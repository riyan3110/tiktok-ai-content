(() => {
  'use strict';
  if (window.__AIADS_NEO_HOME_POLISH__) return;
  window.__AIADS_NEO_HOME_POLISH__ = true;

  const style = document.createElement('style');
  style.dataset.aiadsNeoHomePolish = '20260825';
  style.textContent = `
    /* Sidebar is redundant after the dashboard redesign. */
    .aiads-neo-theme .sidebar,
    .aiads-neo-theme .mobile-backdrop,
    .aiads-neo-theme .menu-button{display:none!important}
    .aiads-neo-theme body.drawer-open{overflow:auto!important}

    /* Use the real AI Ads Lab mark inside the workspace header. */
    .neo-profile-avatar{overflow:hidden;padding:0!important;background:var(--neo-white)!important}
    .neo-profile-avatar img{display:block;width:100%;height:100%;object-fit:cover;border-radius:10px}

    /* Real TikTok connection controls live on Home now, but stay compact. */
    .neo-home-tiktok{margin:0 10px 8px!important;padding:6px 8px!important;min-height:40px!important;background:var(--neo-white)!important;border:1.7px solid var(--neo-line)!important;border-radius:12px!important;color:var(--neo-ink)!important;display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important;gap:6px!important}
    .neo-home-tiktok .tiktok-status{min-width:0!important;margin:0!important;font-size:.66rem!important;line-height:1.15!important;font-weight:900!important;color:var(--neo-ink)!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
    .neo-home-tiktok .tiktok-actions{width:auto!important;margin:0 0 0 auto!important;display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:4px!important;flex-wrap:nowrap!important}
    .neo-home-tiktok .tiktok-actions a,.neo-home-tiktok .tiktok-actions button{width:auto!important;min-width:0!important;min-height:26px!important;height:26px!important;padding:2px 7px!important;font-size:.58rem!important;line-height:1!important;margin:0!important;border-width:1.5px!important;border-radius:8px!important;box-shadow:none!important;white-space:nowrap!important}
    .neo-home-tiktok[data-state="connected"]{background:var(--neo-mint)!important}
    .neo-home-tiktok[data-state="connecting"],.neo-home-tiktok[data-state="loading"]{background:var(--neo-blue)!important}
    .neo-home-tiktok[data-state="error"]{background:var(--neo-pink)!important}
    .neo-profile-card.has-home-tiktok .neo-profile-stats{grid-template-columns:repeat(2,1fr)!important}
    .neo-profile-card.has-home-tiktok .neo-profile-stats>span:first-child{display:none!important}

    /* History cards must stay readable in the new light theme. */
    .aiads-neo-theme #history{display:grid!important;gap:12px!important}
    .aiads-neo-theme .history-item{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:end!important;gap:12px!important;padding:14px!important;background:var(--neo-white)!important;background-image:none!important;color:var(--neo-ink)!important;border:2px solid var(--neo-line)!important;border-radius:16px!important;box-shadow:3px 4px 0 rgba(21,27,43,.10)!important}
    .aiads-neo-theme .history-item .history-content{min-width:0!important;cursor:pointer!important}
    .aiads-neo-theme .history-item .history-content b{display:block!important;color:var(--neo-ink)!important;font-size:.93rem!important;line-height:1.3!important}
    .aiads-neo-theme .history-item .history-content p{margin:8px 0 10px!important;color:#566174!important;line-height:1.45!important}
    .aiads-neo-theme .history-item .history-content small{color:var(--neo-muted)!important}
    .aiads-neo-theme .history-item .badge{background:var(--neo-mint)!important;color:var(--neo-ink)!important;border:1.3px solid var(--neo-line)!important}
    .aiads-neo-theme .history-item .delete-item{align-self:end!important;background:var(--neo-danger)!important;color:#5a1017!important;white-space:nowrap!important}

    @media(max-width:767px){
      .aiads-neo-theme .topbar{justify-content:flex-end!important}
      .neo-home-tiktok{grid-template-columns:minmax(0,1fr) auto!important;align-items:center!important}
      .neo-home-tiktok .tiktok-actions{width:auto!important;justify-content:flex-end!important}
      .aiads-neo-theme .history-item{grid-template-columns:1fr!important;padding:12px!important}
      .aiads-neo-theme .history-item .delete-item{justify-self:start!important}
    }
  `;
  document.head.appendChild(style);

  function disableDrawer() {
    const sidebar = document.querySelector('#sidebar');
    const backdrop = document.querySelector('#mobile-backdrop');
    const menu = document.querySelector('#menu-toggle');
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('open');
    backdrop?.setAttribute('aria-hidden', 'true');
    if (menu) menu.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('drawer-open');
    try { localStorage.setItem('ai-ads-lab-drawer-open', 'false'); } catch (_) {}
  }

  function mountLogo() {
    const avatar = document.querySelector('.neo-profile-avatar');
    if (!avatar || avatar.querySelector('img')) return Boolean(avatar);
    const source = document.querySelector('.sidebar-brand img');
    if (!source) return false;
    const logo = source.cloneNode(true);
    logo.removeAttribute('width');
    logo.removeAttribute('height');
    logo.alt = 'AI Ads Lab';
    avatar.replaceChildren(logo);
    return true;
  }

  function moveTikTokHome() {
    const card = document.querySelector('.neo-profile-card');
    const top = card?.querySelector('.neo-profile-top');
    const stats = card?.querySelector('.neo-profile-stats');
    const connection = document.querySelector('#tiktok-connection');
    if (!card || !top || !connection) return false;
    if (connection.parentElement !== card) {
      connection.classList.add('neo-home-tiktok');
      card.insertBefore(connection, stats || top.nextSibling);
    } else {
      connection.classList.add('neo-home-tiktok');
    }
    card.classList.add('has-home-tiktok');
    return true;
  }

  function apply() {
    disableDrawer();
    mountLogo();
    moveTikTokHome();
  }

  let applyQueued = false;
  function queueApply() {
    if (applyQueued) return;
    applyQueued = true;
    requestAnimationFrame(() => {
      applyQueued = false;
      apply();
    });
  }

  function observeOnlyHomeChrome() {
    const sidebar = document.querySelector('#sidebar');
    const card = document.querySelector('.neo-profile-card');
    const observer = new MutationObserver(queueApply);
    if (sidebar) observer.observe(sidebar, { childList: true });
    if (card) observer.observe(card, { childList: true });
  }

  function start() {
    apply();
    observeOnlyHomeChrome();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.addEventListener('resize', queueApply, { passive: true });
})();
