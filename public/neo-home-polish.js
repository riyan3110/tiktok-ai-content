(() => {
  'use strict';
  if (window.__AIADS_NEO_HOME_POLISH__) return;
  window.__AIADS_NEO_HOME_POLISH__ = true;

  const style = document.createElement('style');
  style.dataset.aiadsNeoHomePolish = '20260826';
  style.textContent = `
    /* Sidebar is redundant after the dashboard redesign. */
    .aiads-neo-theme .sidebar,
    .aiads-neo-theme .mobile-backdrop,
    .aiads-neo-theme .menu-button{display:none!important}
    .aiads-neo-theme body.drawer-open{overflow:auto!important}
    .aiads-neo-theme main{margin-left:0!important;width:100%!important;max-width:100%!important;min-width:0!important}
    .aiads-neo-theme .page-content{min-width:0!important;margin-inline:auto!important}
    .aiads-neo-theme .page-content>section{max-width:100%!important;min-width:0!important}

    /* Use the real AI Ads Lab mark inside the workspace header. */
    .neo-profile-avatar{overflow:hidden;padding:0!important;background:var(--neo-white)!important}
    .neo-profile-avatar img{display:block;width:100%;height:100%;object-fit:cover;border-radius:10px}
    .neo-profile-copy{min-width:0!important}
    .neo-profile-copy small,.neo-profile-copy strong{white-space:nowrap!important;overflow:visible!important;text-overflow:clip!important}

    /* One clear TikTok control beside READY. */
    .neo-profile-top{flex-wrap:nowrap!important}
    .neo-status-cluster{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:8px!important;flex:0 0 auto!important;min-width:0!important}
    .neo-home-tiktok{margin:0!important;padding:0!important;min-height:0!important;background:transparent!important;border:0!important;border-radius:0!important;color:var(--neo-ink)!important;display:flex!important;align-items:center!important;gap:7px!important;justify-content:flex-end!important;flex:0 0 auto!important;white-space:nowrap!important}
    .neo-home-tiktok .neo-tiktok-label{display:inline-flex!important;align-items:center!important;font-size:1rem!important;font-weight:900!important;line-height:1!important;color:var(--neo-ink)!important;white-space:nowrap!important}
    .neo-home-tiktok .tiktok-status,.neo-home-tiktok [data-tiktok-connect],.neo-home-tiktok [data-tiktok-reconnect],.neo-home-tiktok [data-tiktok-disconnect]{display:none!important}
    .neo-home-tiktok .tiktok-actions{width:auto!important;margin:0!important;display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:0!important;flex-wrap:nowrap!important}
    .neo-home-tiktok .neo-tiktok-primary{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:auto!important;min-width:78px!important;max-width:92px!important;min-height:30px!important;height:30px!important;padding:4px 10px!important;font-size:.72rem!important;font-weight:850!important;line-height:1!important;text-align:center!important;margin:0!important;border-width:1.5px!important;border-radius:9px!important;box-shadow:none!important;white-space:nowrap!important}
    .neo-home-tiktok .neo-tiktok-primary.connected{background:#c9f7d7!important;color:#0a5b2c!important;border-color:#168448!important;pointer-events:none!important}
    .neo-home-tiktok[data-state="connected"],.neo-home-tiktok[data-state="connecting"],.neo-home-tiktok[data-state="loading"],.neo-home-tiktok[data-state="error"]{background:transparent!important}
    .neo-profile-chip{transition:background .18s ease,color .18s ease,border-color .18s ease!important}
    .neo-profile-chip[data-tiktok-state="connected"]{background:#c9f7d7!important;color:#0a5b2c!important;border-color:#168448!important}
    .neo-profile-chip[data-tiktok-state="connecting"],.neo-profile-chip[data-tiktok-state="loading"]{background:var(--neo-yellow)!important;color:var(--neo-ink)!important}
    .neo-profile-chip[data-tiktok-state="error"]{background:var(--neo-pink)!important;color:#6b1722!important}
    .neo-profile-card.has-home-tiktok .neo-profile-stats{grid-template-columns:repeat(2,1fr)!important}
    .neo-profile-card.has-home-tiktok .neo-profile-stats>span:first-child{display:none!important}

    /* Providers must use the same parent width as every other page. */
    .aiads-neo-theme #ai-providers,.aiads-neo-theme #ai-providers .provider-heading,.aiads-neo-theme #ai-providers .provider-defaults,.aiads-neo-theme #ai-providers .provider-layout,.aiads-neo-theme #ai-providers .provider-sidebar,.aiads-neo-theme #ai-providers .provider-detail,.aiads-neo-theme #ai-providers .provider-form,.aiads-neo-theme #ai-providers .form-grid{width:100%!important;max-width:100%!important;min-width:0!important;box-sizing:border-box!important}
    .aiads-neo-theme #ai-providers{margin:0!important;overflow-x:hidden!important}
    .aiads-neo-theme #ai-providers .provider-sidebar{overflow:hidden!important}
    .aiads-neo-theme #ai-providers .provider-list{max-width:100%!important;min-width:0!important}
    .aiads-neo-theme #ai-providers .provider-item{max-width:100%!important;min-width:0!important}
    .aiads-neo-theme #ai-providers .provider-item>div,.aiads-neo-theme #ai-providers .detail-heading>div:nth-child(2){min-width:0!important}
    .aiads-neo-theme #ai-providers .provider-item b,.aiads-neo-theme #ai-providers .provider-item small{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
    .aiads-neo-theme #ai-providers .provider-form *{max-width:100%;min-width:0}
    .aiads-neo-theme #ai-providers input,.aiads-neo-theme #ai-providers select,.aiads-neo-theme #ai-providers textarea{max-width:100%!important;min-width:0!important}
    .aiads-neo-theme #ai-providers .provider-detail-actions{flex-wrap:wrap!important}
    .aiads-neo-theme #ai-providers .provider-health{max-width:100%!important;overflow-wrap:anywhere!important}

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
      .neo-status-cluster{gap:7px!important}
      .neo-home-tiktok .neo-tiktok-label{font-size:.92rem!important}
      .neo-home-tiktok .neo-tiktok-primary{min-width:72px!important;max-width:86px!important;height:29px!important;min-height:29px!important;padding:3px 9px!important;font-size:.68rem!important}
      .neo-profile-chip{font-size:.58rem!important;padding:4px 6px!important}
      .aiads-neo-theme #ai-providers{width:100%!important;max-width:100%!important;margin:0!important;padding:0!important}
      .aiads-neo-theme #ai-providers .provider-heading{display:block!important;width:100%!important}
      .aiads-neo-theme #ai-providers .provider-heading h1{font-size:1.7rem!important;line-height:1.05!important;overflow-wrap:normal!important}
      .aiads-neo-theme #ai-providers .provider-defaults{grid-template-columns:1fr!important;gap:10px!important;padding:12px!important}
      .aiads-neo-theme #ai-providers .provider-layout{display:block!important;width:100%!important;min-height:0!important}
      .aiads-neo-theme #ai-providers .provider-sidebar{width:100%!important;padding:10px!important;border-right:0!important;border-bottom:2px solid var(--neo-line)!important}
      .aiads-neo-theme #ai-providers .provider-list{display:flex!important;width:100%!important;overflow-x:auto!important;overscroll-behavior-x:contain!important;gap:6px!important;padding-bottom:2px!important}
      .aiads-neo-theme #ai-providers .provider-item{flex:0 0 min(180px,58vw)!important;width:auto!important;max-width:180px!important}
      .aiads-neo-theme #ai-providers .provider-detail{width:100%!important;padding:13px!important}
      .aiads-neo-theme #ai-providers .detail-heading{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto!important;gap:9px!important;align-items:center!important}
      .aiads-neo-theme #ai-providers .provider-avatar{width:44px!important;height:44px!important}
      .aiads-neo-theme #ai-providers .detail-heading h2{font-size:1.05rem!important}
      .aiads-neo-theme #ai-providers .provider-form .form-grid{grid-template-columns:1fr!important}
      .aiads-neo-theme #ai-providers .provider-detail-actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:7px!important}
      .aiads-neo-theme #ai-providers .provider-detail-actions button{width:100%!important;min-width:0!important;padding-inline:8px!important;font-size:.7rem!important}
      .aiads-neo-theme .history-item{grid-template-columns:1fr!important;padding:12px!important}
      .aiads-neo-theme .history-item .delete-item{justify-self:start!important}
    }
    @media(max-width:520px){
      .neo-profile-top{grid-template-columns:auto minmax(0,1fr)!important}
      .neo-status-cluster{grid-column:1/-1!important;justify-content:flex-start!important;margin-top:2px!important;padding-left:51px!important}
    }
    @media(min-width:1024px){
      .aiads-neo-theme #ai-providers .provider-layout{grid-template-columns:260px minmax(0,1fr)!important}
      .aiads-neo-theme #ai-providers .provider-detail{padding:24px!important}
      .aiads-neo-theme #ai-providers .provider-defaults{grid-template-columns:repeat(3,minmax(0,1fr))!important}
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

  function syncPrimaryTikTokButton(connection) {
    const actions = connection?.querySelector('.tiktok-actions');
    if (!actions) return false;

    let label = connection.querySelector('.neo-tiktok-label');
    if (!label) {
      label = document.createElement('span');
      label.className = 'neo-tiktok-label';
      label.textContent = 'TikTok';
      connection.insertBefore(label, actions);
    }

    let primary = actions.querySelector('[data-tiktok-primary]');
    if (!primary) {
      primary = document.createElement('a');
      primary.className = 'outline neo-tiktok-primary';
      primary.dataset.tiktokPrimary = '';
      actions.appendChild(primary);
    }

    const state = connection.dataset.state || 'loading';
    const connected = state === 'connected';
    primary.textContent = connected ? 'Connected' : state === 'connecting' || state === 'loading' ? 'Checking…' : 'Connect';
    primary.classList.toggle('connected', connected);
    primary.setAttribute('aria-disabled', connected ? 'true' : 'false');
    if (connected || state === 'connecting' || state === 'loading') primary.removeAttribute('href');
    else primary.setAttribute('href', '/auth/tiktok');
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

    syncPrimaryTikTokButton(connection);
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
