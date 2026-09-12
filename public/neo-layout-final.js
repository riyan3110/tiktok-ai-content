(() => {
  'use strict';
  if (window.__AIADS_NEO_LAYOUT_FINAL__) return;
  window.__AIADS_NEO_LAYOUT_FINAL__ = true;

  const style = document.createElement('style');
  style.dataset.aiadsNeoLayoutFinal = '20260912-icons-v1';
  style.textContent = `
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
        width:44px!important;height:44px!important;align-self:center!important;
        transform:translateY(3px)!important;
      }
      .aiads-neo-theme .neo-profile-copy{
        align-self:center!important;min-width:0!important;transform:translateY(3px)!important;
      }
      .aiads-neo-theme .neo-profile-copy small{
        display:block!important;margin:0 0 2px!important;font-size:.62rem!important;
        line-height:1.05!important;letter-spacing:.04em!important;white-space:nowrap!important;
      }
      .aiads-neo-theme .neo-profile-copy strong{
        display:block!important;margin:0!important;font-size:1rem!important;
        line-height:1.08!important;white-space:nowrap!important;
      }
      .aiads-neo-theme .neo-status-cluster{
        grid-column:3!important;grid-row:1!important;justify-self:end!important;align-self:center!important;
        display:flex!important;align-items:center!important;justify-content:flex-end!important;
        gap:5px!important;margin:0!important;padding:0!important;min-width:0!important;white-space:nowrap!important;
      }
      .aiads-neo-theme .neo-home-tiktok{
        display:flex!important;align-items:center!important;justify-content:flex-end!important;
        gap:5px!important;min-width:0!important;
      }
      .aiads-neo-theme .neo-home-tiktok .neo-tiktok-label{
        font-size:.96rem!important;font-weight:900!important;line-height:1!important;
      }
      .aiads-neo-theme .neo-home-tiktok .neo-tiktok-primary{
        display:inline-flex!important;align-items:center!important;justify-content:center!important;
        width:74px!important;min-width:74px!important;max-width:74px!important;
        height:30px!important;min-height:30px!important;padding:0 7px!important;margin:0!important;
        font-size:.68rem!important;line-height:1!important;text-align:center!important;
      }
      .aiads-neo-theme .neo-profile-chip{
        display:inline-flex!important;align-items:center!important;justify-content:center!important;
        min-height:28px!important;padding:4px 7px!important;margin:0!important;
        font-size:.58rem!important;line-height:1!important;white-space:nowrap!important;
      }

      .aiads-neo-theme .neo-bottom-nav{
        position:fixed!important;left:12px!important;right:12px!important;width:auto!important;
        max-width:none!important;min-width:0!important;transform:none!important;
        grid-template-columns:minmax(0,1fr) minmax(0,1fr) 58px minmax(0,1fr) minmax(0,1fr)!important;
        overflow:visible!important;contain:none!important;box-sizing:border-box!important;
      }
      .aiads-neo-theme .neo-bottom-nav>button{
        min-width:0!important;max-width:100%!important;justify-self:stretch!important;align-self:center!important;
      }
      .aiads-neo-theme .neo-bottom-nav>button.neo-main{
        display:grid!important;grid-template-rows:auto auto!important;place-items:center!important;
        justify-self:center!important;align-self:center!important;width:56px!important;min-width:56px!important;
        max-width:56px!important;height:56px!important;min-height:56px!important;margin:0!important;
        padding:5px!important;transform:translateY(0)!important;line-height:1!important;
      }
      .aiads-neo-theme .neo-bottom-nav>button.neo-main i,
      .aiads-neo-theme .neo-bottom-nav>button.neo-main span{
        display:block!important;margin:0!important;line-height:1!important;text-align:center!important;
      }
      .aiads-neo-theme .neo-bottom-nav>button.neo-main span{font-size:.58rem!important;margin-top:2px!important}
    }

    .aiads-neo-theme .neo-shortcut i svg,
    .aiads-neo-theme .neo-bottom-nav i svg,
    .aiads-neo-theme .neo-coach-art svg,
    .aiads-neo-theme .neo-feature-art svg{
      display:block!important;
      width:100%!important;
      height:100%!important;
      fill:none!important;
      stroke:currentColor!important;
      stroke-width:2.15!important;
      stroke-linecap:round!important;
      stroke-linejoin:round!important;
    }
    .aiads-neo-theme .neo-shortcut i{width:27px!important;height:27px!important}
    .aiads-neo-theme .neo-bottom-nav i{width:22px!important;height:22px!important;display:grid!important;place-items:center!important}
    .aiads-neo-theme .neo-bottom-nav .neo-main i{width:23px!important;height:23px!important}
    .aiads-neo-theme .neo-coach-art svg{width:30px!important;height:30px!important}

    @media(max-width:420px){
      .aiads-neo-theme .neo-profile-top{
        grid-template-columns:42px minmax(0,1fr) auto!important;column-gap:6px!important;padding-inline:10px!important;
      }
      .aiads-neo-theme .neo-profile-avatar{width:42px!important;height:42px!important}
      .aiads-neo-theme .neo-profile-copy small{font-size:.58rem!important;letter-spacing:.02em!important}
      .aiads-neo-theme .neo-profile-copy strong{font-size:.94rem!important}
      .aiads-neo-theme .neo-status-cluster{gap:4px!important}
      .aiads-neo-theme .neo-home-tiktok{gap:4px!important}
      .aiads-neo-theme .neo-home-tiktok .neo-tiktok-label{font-size:.9rem!important}
      .aiads-neo-theme .neo-home-tiktok .neo-tiktok-primary{
        width:68px!important;min-width:68px!important;max-width:68px!important;height:28px!important;
        min-height:28px!important;font-size:.63rem!important;padding-inline:5px!important;
      }
      .aiads-neo-theme .neo-profile-chip{min-height:26px!important;padding:3px 5px!important;font-size:.54rem!important}
    }
  `;
  document.head.appendChild(style);

  const ICON_VERSION = '20260912-v1';
  const svg = paths => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;
  const icons = {
    assets: svg('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>'),
    prompt: svg('<path d="m15 4 5 5L7 22H2v-5Z"/><path d="m14 5 5 5"/><path d="M6 3v4"/><path d="M8 5H4"/><path d="M19 16v4"/><path d="M21 18h-4"/>'),
    providers: svg('<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M8 16h8"/><path d="M12 7V3"/><path d="M9 3h6"/>'),
    templates: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M9 9h12"/><path d="M9 15h12"/>'),
    schedule: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/>'),
    history: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>'),
    home: svg('<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>'),
    text: svg('<path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/><path d="M9 9h2"/>'),
    create: svg('<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-5.76-1.49a.6.6 0 0 1 0-1.14L8.5 9.94A2 2 0 0 0 9.94 8.5l1.49-5.76a.6.6 0 0 1 1.14 0l1.49 5.76a2 2 0 0 0 1.44 1.44l5.76 1.49a.6.6 0 0 1 0 1.14l-5.76 1.49a2 2 0 0 0-1.44 1.44l-1.49 5.76a.6.6 0 0 1-1.14 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>'),
    account: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    coach: svg('<path d="M12 3v18"/><path d="M3 12h18"/><path d="m5 5 14 14"/><path d="m19 5-14 14"/>'),
    studio: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L5 21"/>')
  };

  function paint(target, html) {
    if (!target || target.dataset.neoIconVersion === ICON_VERSION) return;
    target.innerHTML = html;
    target.dataset.neoIconVersion = ICON_VERSION;
  }

  function applyIconPolish() {
    paint(document.querySelector('.neo-shortcut[data-neo-target="assets"] i'), icons.assets);
    paint(document.querySelector('.neo-shortcut[data-neo-target="generator"] i'), icons.prompt);
    paint(document.querySelector('.neo-shortcut[data-neo-target="providers"] i'), icons.providers);
    paint(document.querySelector('.neo-shortcut[data-neo-target="templates"] i'), icons.templates);
    paint(document.querySelector('.neo-shortcut[data-neo-target="schedule"] i'), icons.schedule);
    paint(document.querySelector('.neo-shortcut[data-neo-target="history"] i'), icons.history);

    paint(document.querySelector('.neo-bottom-nav [data-neo-target="home"] i'), icons.home);
    paint(document.querySelector('.neo-bottom-nav [data-neo-target="text"] i'), icons.text);
    paint(document.querySelector('.neo-bottom-nav [data-neo-target="studio"] i'), icons.create);
    paint(document.querySelector('.neo-bottom-nav [data-neo-target="assets"] i'), icons.assets);
    paint(document.querySelector('.neo-bottom-nav [data-neo-target="profile"] i'), icons.account);

    paint(document.querySelector('.neo-coach-art'), icons.create);
    paint(document.querySelector('.neo-feature-card[data-neo-target="text"] .neo-feature-art'), icons.text);
    paint(document.querySelector('.neo-feature-card[data-neo-target="studio"] .neo-feature-art'), icons.studio);
  }

  let queued = false;
  const queuePaint = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      applyIconPolish();
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queuePaint, { once: true });
  else queuePaint();

  const observer = new MutationObserver(queuePaint);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
