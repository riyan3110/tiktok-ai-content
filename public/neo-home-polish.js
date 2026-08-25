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

    /* TikTok controls live beside READY instead of occupying a full-width row. */
    .neo-profile-top{flex-wrap:nowrap!important}
    .neo-status-cluster{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:6px!important;flex:0 0 auto!important;min-width:0!important}
    .neo-home-tiktok{margin:0!important;padding:0!important;min-height:0!important;background:transparent!important;border:0!important;border-radius:0!important;color:var(--neo-ink)!important;display:flex!important;align-items:center!important;gap:4px!important;justify-content:flex-end!important;flex:0 0 auto!important}
    .neo-home-tiktok .tiktok-status{display:none!important}
    .neo-home-tiktok .tiktok-actions{width:auto!important;margin:0!important;display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:4px!important;flex-wrap:nowrap!important}
    .neo-home-tiktok .tiktok-actions a,.neo-home-tiktok .tiktok-actions button{width:auto!important;min-width:0!important;min-height:25px!important;height:25px!important;padding:2px 7px!important;font-size:.57rem!important;line-height:1!important;margin:0!important;border-width:1.4px!important;border-radius:8px!important;box-shadow:none!important;white-space:nowrap!important}
    .neo-home-tiktok[data-state="connected"]{background:transparent!important}
    .neo-home-tiktok[data-state="connecting"],.neo-home-tiktok[data-state="loading"]{background:transparent!important}
    .neo-home-tiktok[data-state="error"]{background:transparent!important}
    .neo-profile-chip{transition:background .18s ease,color .18s ease,border-color .18s ease!important}
    .neo-profile-chip[data-tiktok-state="connected"]{background:#c9f7d7!important;color:#0a5b2c!important;border-color:#168448!important}
    .neo-profile-chip[data-tiktok-state="connecting"],.neo-profile-chip[data-tiktok-state="loading"]{background:var(--neo-yellow)!important;color:var(--neo-ink)!important}
    .neo-profile-chip[data-tiktok-state="error"]{background:var(--neo-pink)!important;color:#6b1722!important}
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
      .neo-profile-top{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto!important;gap:9px!important;align-items:center!important}
      .neo-status-cluster{gap:4px!important}
      .neo-home-tiktok .tiktok-actions a,.neo-home-tiktok .tiktok-actions button{height:24px!important;min-height:24px!important;padding:2px 6px!important;font-size:.54rem!important}
      .neo-profile-chip{font-size:.58rem!important;padding:4px 6px!important}
      .aiads-neo-theme .history-item{grid-template-columns:1fr!important;padding:12px!important}
      .aiads-neo-theme .history-item .delete-item{justify-self:start!important}
    }
    @media(max-width:430px){
      .neo-profile-top{grid-template-columns:auto minmax(0,1fr)!important}
      .neo-status-cluster{grid-column:1/-1!important;justify-content:flex-end!important;margin-top:-2px!important}
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

  function syncReadyState(connection, chip) {
    if (!connection || !chip) return false;
    const state = connection.dataset.state || 'loading';
    chip.dataset.tiktokState = state;
    chip.title = state === 'connected' ? 'TikTok terhubung' : state === 'error' ? 'Koneksi TikTok bermasalah' : state === 'connecting' || state === 'loading' ? 'Memeriksa koneksi TikTok' : 'TikTok belum terhubung';
    return true;
  }

  function moveTikTokHome() {
    const card = document.querySelector('.neo-profile-card');
    const top = card?.querySelector('.neo-profile-top');
    const connection = document.querySelector('#tiktok-connection');
    const chip = top?.querySelector('.neo-profile-chip');
    if (!card || !top || !connection || !chip) return false;

    let cluster = top.querySelector('.neo-status-cluster');
    if (!cluster) {
      cluster = document.createElement('div');
      cluster.className = 'neo-status-cluster';
      top.appendChild(cluster);
    }

    connection.classList.add('neo-home-tiktok');
    if (connection.parentElement !== cluster) cluster.appendChild(connection);
    if (chip.parentElement !== cluster) cluster.appendChild(chip);

    const connect = connection.querySelector('[data-tiktok-connect]');
    if (connect) connect.textContent = 'Connect TikTok';
    card.classList.add('has-home-tiktok');
    syncReadyState(connection, chip);
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
    const connection = document.querySelector('#tiktok-connection');
    const observer = new MutationObserver(queueApply);
    if (sidebar) observer.observe(sidebar, { childList: true });
    if (card) observer.observe(card, { childList: true });
    if (connection) observer.observe(connection, { attributes: true, attributeFilter: ['data-state'] });
  }

  function start() {
    apply();
    observeOnlyHomeChrome();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  window.addEventListener('resize', queueApply, { passive: true });
})();
