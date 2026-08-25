(() => {
  'use strict';
  if (window.__AIADS_FLOATING_CHAT_THEME__) return;
  window.__AIADS_FLOATING_CHAT_THEME__ = true;

  document.documentElement.classList.add('aiads-neo-theme');

  const css = document.createElement('style');
  css.dataset.aiadsNeoTheme = '2026-dashboard';
  css.textContent = `
    html.aiads-neo-theme{
      --neo-ink:#151b2b;--neo-paper:#f7f7f2;--neo-white:#fffefa;--neo-soft:#eef1f3;
      --neo-line:#1b2435;--neo-muted:#667085;--neo-lime:#c7f53c;--neo-yellow:#ffe666;
      --neo-purple:#b7a1ff;--neo-blue:#dff2ff;--neo-mint:#d9f6e5;--neo-peach:#ffe8c9;
      --neo-pink:#ffdce5;--neo-danger:#ffb5bd;--neo-shadow:4px 5px 0 rgba(21,27,43,.13);
      color-scheme:light!important;background:var(--neo-paper)!important;
    }
    html.aiads-neo-theme body{background:var(--neo-paper)!important;color:var(--neo-ink)!important;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
    html.aiads-neo-theme body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background-image:linear-gradient(rgba(21,27,43,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(21,27,43,.035) 1px,transparent 1px);background-size:22px 22px}
    .aiads-neo-theme *{scrollbar-color:#b9bec7 transparent}
    .aiads-neo-theme p,.aiads-neo-theme small{color:var(--neo-muted)}
    .aiads-neo-theme h1,.aiads-neo-theme h2,.aiads-neo-theme h3,.aiads-neo-theme h4,.aiads-neo-theme strong,.aiads-neo-theme b{color:var(--neo-ink)}
    .aiads-neo-theme .eyebrow,.aiads-neo-theme .section-kicker{color:var(--neo-ink)!important;font-weight:900!important;letter-spacing:.13em!important}

    /* Global chrome */
    .aiads-neo-theme main{background:transparent!important}
    .aiads-neo-theme .topbar{height:64px!important;padding:0 22px!important;background:rgba(255,254,250,.96)!important;border-bottom:2px solid var(--neo-line)!important;backdrop-filter:blur(14px)!important;box-shadow:none!important}
    .aiads-neo-theme .topbar-title small{color:var(--neo-muted)!important}.aiads-neo-theme .topbar-title strong{color:var(--neo-ink)!important;font-weight:900!important}
    .aiads-neo-theme .icon-button,.aiads-neo-theme .account-button,.aiads-neo-theme .connection-status{background:var(--neo-white)!important;color:var(--neo-ink)!important;border:2px solid var(--neo-line)!important;border-radius:12px!important;box-shadow:none!important}
    .aiads-neo-theme .connection-status i{box-shadow:none!important}.aiads-neo-theme .account-avatar{background:var(--neo-lime)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important}
    .aiads-neo-theme .page-content{width:min(calc(100% - 40px),1280px)!important;padding:30px 0 110px!important}

    /* Sidebar / drawer */
    .aiads-neo-theme .sidebar{background:var(--neo-white)!important;background-image:none!important;border-right:2px solid var(--neo-line)!important;animation:none!important;padding:18px 14px!important;color:var(--neo-ink)!important}
    .aiads-neo-theme .sidebar-brand{margin:-18px -14px 10px!important;padding:20px 16px 14px!important;background:var(--neo-white)!important;border-bottom:2px solid var(--neo-line)!important;color:var(--neo-ink)!important}
    .aiads-neo-theme .sidebar-brand strong{color:var(--neo-ink)!important}.aiads-neo-theme .sidebar-brand small{color:var(--neo-muted)!important}
    .aiads-neo-theme .side-nav{gap:7px!important}.aiads-neo-theme .side-nav a{min-height:44px!important;padding:9px 11px!important;border:1.5px solid transparent!important;border-radius:11px!important;color:var(--neo-ink)!important;background:transparent!important;font-weight:800!important}
    .aiads-neo-theme .side-nav a span:first-child{color:var(--neo-ink)!important}.aiads-neo-theme .side-nav a:hover{background:var(--neo-soft)!important;transform:none!important}.aiads-neo-theme .side-nav a.active{background:var(--neo-lime)!important;border-color:var(--neo-line)!important;color:var(--neo-ink)!important;box-shadow:2px 3px 0 rgba(21,27,43,.16)!important}
    .aiads-neo-theme .sidebar-note{background:var(--neo-blue)!important;border:2px solid var(--neo-line)!important;border-radius:13px!important}.aiads-neo-theme .sidebar-note strong{color:var(--neo-ink)!important}.aiads-neo-theme .sidebar-note small{color:var(--neo-muted)!important}
    .aiads-neo-theme .sidebar>.tiktok-connection{background:var(--neo-white)!important;border-bottom:1.5px solid #d7dbe0!important;color:var(--neo-ink)!important;margin:0 -14px 12px!important;padding:5px 16px 14px!important}.aiads-neo-theme .tiktok-status{color:var(--neo-ink)!important;font-weight:800!important}

    /* Generic cards and forms */
    .aiads-neo-theme button,.aiads-neo-theme .button,.aiads-neo-theme .outline{border:2px solid var(--neo-line)!important;border-radius:11px!important;background:var(--neo-yellow)!important;color:var(--neo-ink)!important;font-weight:850!important;box-shadow:2px 3px 0 rgba(21,27,43,.14)!important}
    .aiads-neo-theme button:hover,.aiads-neo-theme .button:hover,.aiads-neo-theme .outline:hover{filter:none!important;transform:translate(-1px,-1px)!important;box-shadow:3px 4px 0 rgba(21,27,43,.16)!important}
    .aiads-neo-theme .outline{background:var(--neo-white)!important}.aiads-neo-theme .text-button{background:transparent!important;border:0!important;box-shadow:none!important;color:var(--neo-ink)!important}.aiads-neo-theme .danger{background:var(--neo-danger)!important;color:#5a1017!important}.aiads-neo-theme button:disabled{box-shadow:none!important;opacity:.55!important}
    .aiads-neo-theme input,.aiads-neo-theme select,.aiads-neo-theme textarea{background:var(--neo-white)!important;color:var(--neo-ink)!important;border:1.8px solid var(--neo-line)!important;border-radius:11px!important;box-shadow:none!important}.aiads-neo-theme input:focus,.aiads-neo-theme select:focus,.aiads-neo-theme textarea:focus{outline:3px solid rgba(199,245,60,.55)!important;outline-offset:1px!important;border-color:var(--neo-line)!important}
    .aiads-neo-theme label{color:var(--neo-ink)!important}.aiads-neo-theme option{background:#fff;color:#111}
    .aiads-neo-theme .actions,.aiads-neo-theme #editor,.aiads-neo-theme #schedule-dashboard,.aiads-neo-theme .history-section,.aiads-neo-theme .trend-reference,.aiads-neo-theme .studio-card,.aiads-neo-theme .factory-panel,.aiads-neo-theme .generator-panel,.aiads-neo-theme .provider-layout,.aiads-neo-theme .provider-defaults,.aiads-neo-theme .pipeline-card,.aiads-neo-theme .integration-card,.aiads-neo-theme .queue-table-wrap,.aiads-neo-theme .workflow-builder,.aiads-neo-theme .workflow-summary,.aiads-neo-theme .workflow-history,.aiads-neo-theme .settings-block,.aiads-neo-theme .template-card,.aiads-neo-theme .template-layout>aside,.aiads-neo-theme .asset-drop,.aiads-neo-theme .storage-settings form,.aiads-neo-theme .profile-hero,.aiads-neo-theme .profile-stats article,.aiads-neo-theme .profile-grid section{
      background:var(--neo-white)!important;background-image:none!important;border:2px solid var(--neo-line)!important;border-radius:18px!important;box-shadow:var(--neo-shadow)!important;color:var(--neo-ink)!important;backdrop-filter:none!important;
    }
    .aiads-neo-theme .actions:hover,.aiads-neo-theme #editor:hover,.aiads-neo-theme #schedule-dashboard:hover,.aiads-neo-theme .history-section:hover{border-color:var(--neo-line)!important;transform:none!important}
    .aiads-neo-theme .project-search,.aiads-neo-theme .favorite-filter,.aiads-neo-theme .library-filters,.aiads-neo-theme .prompt-source,.aiads-neo-theme .studio-assets,.aiads-neo-theme .asset-attachment,.aiads-neo-theme .workflow-progress,.aiads-neo-theme .consistency-tabs,.aiads-neo-theme .factory-progress{background:var(--neo-white)!important;border:1.7px solid var(--neo-line)!important;border-radius:12px!important}
    .aiads-neo-theme .status-pill,.aiads-neo-theme .badge,.aiads-neo-theme .local-badge,.aiads-neo-theme .factory-workflow-badge{background:var(--neo-mint)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important;border-radius:999px!important}
    .aiads-neo-theme .state-icon,.aiads-neo-theme .settings-icon,.aiads-neo-theme .panel-title>span,.aiads-neo-theme .integration-card-title>span{background:var(--neo-purple)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important}
    .aiads-neo-theme .loading-state,.aiads-neo-theme .empty-state,.aiads-neo-theme .error-state,.aiads-neo-theme .project-empty,.aiads-neo-theme .consistency-empty,.aiads-neo-theme .prompt-empty{background:var(--neo-soft)!important;background-image:none!important;border:2px dashed var(--neo-line)!important;color:var(--neo-ink)!important}

    /* Workspace / project cards */
    .aiads-neo-theme #project-workspace>.workspace-heading{display:none!important}
    .aiads-neo-theme .project-toolbar{margin-top:20px!important;padding:12px!important;background:var(--neo-white)!important;border:2px solid var(--neo-line)!important;border-radius:15px!important;box-shadow:var(--neo-shadow)!important}
    .aiads-neo-theme .project-filters{background:var(--neo-blue)!important;border:2px solid var(--neo-line)!important}
    .aiads-neo-theme .project-grid{gap:14px!important}.aiads-neo-theme .project-card{background:var(--neo-white)!important;border:2px solid var(--neo-line)!important;border-radius:17px!important;box-shadow:var(--neo-shadow)!important;overflow:hidden!important}.aiads-neo-theme .project-card:hover{transform:translate(-1px,-1px)!important;border-color:var(--neo-line)!important}
    .aiads-neo-theme .project-thumbnail,.aiads-neo-theme .detail-thumbnail{background:linear-gradient(135deg,var(--neo-lime),var(--neo-blue))!important;color:var(--neo-ink)!important;border-bottom:2px solid var(--neo-line)!important}.aiads-neo-theme .module-card{background:var(--neo-white)!important;border:2px solid var(--neo-line)!important;border-radius:14px!important;box-shadow:2px 3px 0 rgba(21,27,43,.1)!important}.aiads-neo-theme .module-card>span{background:var(--neo-yellow)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important}
    .aiads-neo-theme .detail-hero,.aiads-neo-theme .project-overview{background:var(--neo-white)!important;border:2px solid var(--neo-line)!important;box-shadow:var(--neo-shadow)!important}

    /* Text Content */
    .aiads-neo-theme #legacy-studio .hero{padding:15px 0 10px!important}.aiads-neo-theme #legacy-studio .hero h1{color:var(--neo-ink)!important}.aiads-neo-theme #legacy-studio .hero-stat{background:var(--neo-blue)!important;border:2px solid var(--neo-line)!important;border-radius:14px!important;padding:13px!important}
    .aiads-neo-theme #legacy-studio .actions{background:#fffdf5!important}.aiads-neo-theme .segment-options span{background:var(--neo-white)!important;border:1.8px solid var(--neo-line)!important;color:var(--neo-ink)!important;border-radius:11px!important}.aiads-neo-theme .segment-options input:checked+span{background:var(--neo-lime)!important;color:var(--neo-ink)!important;border-color:var(--neo-line)!important;box-shadow:2px 3px 0 rgba(21,27,43,.12)!important}
    .aiads-neo-theme .switch-control{background:#cfd4da!important;border:1.5px solid var(--neo-line)!important}.aiads-neo-theme .switch-row input:checked+.switch-control{background:var(--neo-lime)!important}.aiads-neo-theme .switch-control::after{background:var(--neo-white)!important;border:1px solid var(--neo-line)!important}
    .aiads-neo-theme .carousel-background{border:0!important;padding:0!important;background:transparent!important}.aiads-neo-theme .background-swatch{border:2px solid var(--neo-line)!important;border-radius:13px!important}.aiads-neo-theme .background-option input:checked+.background-swatch{border-color:var(--neo-line)!important;box-shadow:0 0 0 4px rgba(199,245,60,.55)!important}
    .aiads-neo-theme .slide-button{background:#fff!important;border:2px solid var(--neo-line)!important;border-radius:13px!important;box-shadow:2px 3px 0 rgba(21,27,43,.12)!important}

    /* Assets */
    .aiads-neo-theme .asset-toolbar{padding:10px!important;background:var(--neo-white)!important;border:2px solid var(--neo-line)!important;border-radius:15px!important;box-shadow:var(--neo-shadow)!important}.aiads-neo-theme .asset-card,.aiads-neo-theme .selector-card{background:var(--neo-white)!important;border:2px solid var(--neo-line)!important;border-radius:14px!important;box-shadow:2px 3px 0 rgba(21,27,43,.1)!important}.aiads-neo-theme .asset-preview{background:#edf1f4!important}.aiads-neo-theme .asset-selector,.aiads-neo-theme .asset-preview-modal{background:var(--neo-paper)!important;color:var(--neo-ink)!important;border:2px solid var(--neo-line)!important}.aiads-neo-theme .asset-selector-preview{background:var(--neo-white)!important;border:2px solid var(--neo-line)!important}.aiads-neo-theme .selector-check{background:var(--neo-white)!important;color:var(--neo-ink)!important;border:2px solid var(--neo-line)!important}.aiads-neo-theme .selector-card.selected{box-shadow:inset 0 0 0 3px var(--neo-lime),2px 3px 0 rgba(21,27,43,.1)!important}

    /* Factory / generator / providers / workflow */
    .aiads-neo-theme .factory-template,.aiads-neo-theme .consistency-card,.aiads-neo-theme .result-card,.aiads-neo-theme .prompt-row,.aiads-neo-theme .preset-chip{background:var(--neo-white)!important;color:var(--neo-ink)!important;border:1.7px solid var(--neo-line)!important}.aiads-neo-theme .factory-template.active,.aiads-neo-theme .factory-template:hover{background:var(--neo-lime)!important;border-color:var(--neo-line)!important}.aiads-neo-theme .factory-template-icon,.aiads-neo-theme .factory-selected-icon{background:var(--neo-purple)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important}
    .aiads-neo-theme .generator-panel,.aiads-neo-theme .provider-layout{overflow:hidden!important}.aiads-neo-theme .syntax-editor{background:#fbfbf7!important;border-top:1.5px solid var(--neo-line)!important;border-bottom:1.5px solid var(--neo-line)!important}.aiads-neo-theme .syntax-editor textarea{caret-color:var(--neo-ink)!important}.aiads-neo-theme .syntax-editor pre{color:#515866!important}.aiads-neo-theme .provider-sidebar{background:var(--neo-blue)!important;border-right:2px solid var(--neo-line)!important}.aiads-neo-theme .provider-item{color:var(--neo-ink)!important;border-radius:10px!important}.aiads-neo-theme .provider-item.active{background:var(--neo-lime)!important;box-shadow:inset 4px 0 var(--neo-line)!important}.aiads-neo-theme .provider-item>span,.aiads-neo-theme .provider-avatar{background:var(--neo-yellow)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important}.aiads-neo-theme .pipeline-flow{background:var(--neo-blue)!important;border:1.5px solid var(--neo-line)!important}.aiads-neo-theme .pipeline-flow span{background:var(--neo-white)!important;border:1px solid var(--neo-line)!important}
    .aiads-neo-theme .workflow-stepper button{background:var(--neo-white)!important;color:var(--neo-ink)!important;border:1.7px solid var(--neo-line)!important}.aiads-neo-theme .workflow-stepper button.active{background:var(--neo-lime)!important}.aiads-neo-theme .workflow-stepper button span{background:var(--neo-yellow)!important;color:var(--neo-ink)!important;border:1px solid var(--neo-line)!important}

    /* Tables, dialogs, notifications */
    .aiads-neo-theme .queue-summary article{background:var(--neo-white)!important;border:2px solid var(--neo-line)!important;box-shadow:2px 3px 0 rgba(21,27,43,.1)!important}.aiads-neo-theme .queue-table th,.aiads-neo-theme .history-row.head{background:var(--neo-blue)!important;color:var(--neo-ink)!important}.aiads-neo-theme .queue-table td{background:var(--neo-white)!important;color:var(--neo-ink)!important}.aiads-neo-theme .project-dialog,.aiads-neo-theme .consistency-dialog,.aiads-neo-theme .notification-panel,.aiads-neo-theme .job-detail{background:var(--neo-paper)!important;color:var(--neo-ink)!important;border:2px solid var(--neo-line)!important;box-shadow:8px 10px 0 rgba(21,27,43,.18)!important}.aiads-neo-theme dialog::backdrop{background:rgba(21,27,43,.42)!important;backdrop-filter:blur(3px)!important}.aiads-neo-theme .notice>span{background:var(--neo-yellow)!important;color:var(--neo-ink)!important;border:1px solid var(--neo-line)!important}

    /* Home dashboard inspired by the reference */
    .neo-home-dashboard{display:grid;gap:16px;margin-bottom:22px}.neo-profile-card,.neo-coach-card,.neo-shortcut-shell,.neo-action-stack,.neo-home-banner{border:2px solid var(--neo-line);border-radius:18px;background:var(--neo-white);box-shadow:var(--neo-shadow)}
    .neo-profile-card{overflow:hidden}.neo-profile-top{display:flex;align-items:center;gap:12px;padding:14px;background:linear-gradient(125deg,var(--neo-blue),#f4fbff 58%,var(--neo-mint));border-bottom:2px solid var(--neo-line)}.neo-profile-avatar{display:grid;place-items:center;width:47px;height:47px;flex:0 0 47px;border:2px solid var(--neo-line);border-radius:13px;background:var(--neo-yellow);font-weight:950}.neo-profile-copy{min-width:0;flex:1}.neo-profile-copy small{display:block;font-size:.72rem}.neo-profile-copy strong{display:block;font-size:1rem}.neo-profile-chip{padding:5px 9px;border:1.5px solid var(--neo-line);border-radius:999px;background:var(--neo-white);font-size:.68rem;font-weight:900}.neo-profile-stats{display:grid;grid-template-columns:repeat(3,1fr)}.neo-profile-stats span{display:grid;gap:2px;padding:10px 8px;text-align:center;border-right:1.5px solid var(--neo-line);font-size:.7rem}.neo-profile-stats span:last-child{border-right:0}.neo-profile-stats b{font-size:.86rem}
    .neo-coach-card{display:grid;grid-template-columns:70px 1fr auto;align-items:center;gap:12px;padding:12px}.neo-coach-art{display:grid;place-items:center;aspect-ratio:1;border:2px solid var(--neo-line);border-radius:12px;background:var(--neo-lime);font-size:1.6rem}.neo-coach-copy b{display:block}.neo-coach-copy small{display:block;margin-top:3px}.neo-arrow{min-width:64px!important;background:var(--neo-white)!important}
    .neo-feature-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.neo-feature-card{position:relative;display:grid;align-content:end;min-height:168px;padding:14px;border:2px solid var(--neo-line);border-radius:18px;background:var(--neo-yellow);box-shadow:var(--neo-shadow);overflow:hidden;cursor:pointer}.neo-feature-card:nth-child(2){background:var(--neo-purple)}.neo-feature-card::before{content:attr(data-icon);position:absolute;right:10px;top:6px;font-size:4rem;opacity:.18}.neo-feature-card b{font-size:1.05rem}.neo-feature-card small{margin-top:5px;line-height:1.35;color:#475166}.neo-feature-card .neo-card-button{justify-self:start;margin-top:11px;padding:7px 11px;border:1.5px solid var(--neo-line);border-radius:9px;background:var(--neo-white);font-size:.72rem;font-weight:900}
    .neo-shortcut-shell{padding:12px}.neo-section-label{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:.72rem;font-weight:950}.neo-section-label span{padding:4px 8px;border:1.5px solid var(--neo-line);border-radius:999px;background:var(--neo-yellow)}.neo-shortcuts{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.neo-shortcut{display:grid;justify-items:center;align-content:center;gap:6px;min-height:78px;padding:7px;border:1.6px solid var(--neo-line);border-radius:12px;background:var(--neo-white);cursor:pointer;text-align:center}.neo-shortcut:nth-child(2n){background:var(--neo-blue)}.neo-shortcut:nth-child(3n){background:var(--neo-mint)}.neo-shortcut i{font-style:normal;font-size:1.25rem}.neo-shortcut b{font-size:.62rem;line-height:1.15}
    .neo-action-stack{padding:12px}.neo-action-row{display:grid;grid-template-columns:46px 1fr auto;align-items:center;gap:10px;margin-top:9px;padding:10px;border:1.7px solid var(--neo-line);border-radius:13px;background:var(--neo-blue);cursor:pointer}.neo-action-row:nth-child(3){background:var(--neo-pink)}.neo-action-row:nth-child(4){background:var(--neo-mint)}.neo-action-row:nth-child(5){background:var(--neo-peach)}.neo-action-icon{display:grid;place-items:center;width:42px;height:42px;border:1.5px solid var(--neo-line);border-radius:10px;background:var(--neo-white);font-size:1.1rem}.neo-action-copy b{display:block;font-size:.84rem}.neo-action-copy small{display:block;font-size:.66rem;margin-top:2px}.neo-action-go{font-size:1.15rem;font-weight:950}
    .neo-home-banner{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px;background:var(--neo-ink);color:#fff}.neo-home-banner b{color:#fff;font-size:1.05rem}.neo-home-banner small{color:#ccd1da;display:block;margin-top:4px}.neo-home-banner button{background:var(--neo-yellow)!important;white-space:nowrap!important}
    .neo-project-label{margin:24px 0 4px;font-size:.76rem;font-weight:950;letter-spacing:.08em;text-transform:uppercase;color:var(--neo-ink)}

    /* Mobile bottom navigation */
    .neo-bottom-nav{display:none;position:fixed;z-index:9980;left:12px;right:12px;bottom:calc(8px + env(safe-area-inset-bottom));height:66px;padding:6px;border:2px solid var(--neo-line);border-radius:18px;background:var(--neo-yellow);box-shadow:0 8px 24px rgba(21,27,43,.18)}.neo-bottom-nav button{display:grid!important;place-items:center!important;gap:1px!important;min-width:0!important;min-height:50px!important;padding:4px!important;background:transparent!important;border:0!important;box-shadow:none!important;color:var(--neo-ink)!important;border-radius:12px!important;font-size:.62rem!important}.neo-bottom-nav button i{font-style:normal;font-size:1.05rem}.neo-bottom-nav button.neo-main{width:54px!important;height:54px!important;margin-top:-17px!important;border:2px solid var(--neo-line)!important;border-radius:50%!important;background:var(--neo-purple)!important;box-shadow:2px 3px 0 rgba(21,27,43,.16)!important}.neo-bottom-nav button.active{background:var(--neo-white)!important;border:1.5px solid var(--neo-line)!important}

    /* Floating chat redesigned */
    .aiads-chat-launcher{right:18px!important;bottom:calc(22px + env(safe-area-inset-bottom))!important;width:58px!important;height:58px!important;border:2px solid var(--neo-line)!important;border-radius:17px!important;background:var(--neo-lime)!important;color:var(--neo-ink)!important;box-shadow:4px 5px 0 rgba(21,27,43,.2)!important;font-size:24px!important}
    .aiads-chat-panel{background:var(--neo-paper)!important;color:var(--neo-ink)!important;border:2px solid var(--neo-line)!important;border-radius:20px!important;box-shadow:8px 10px 0 rgba(21,27,43,.20)!important}.aiads-chat-panel:not(.fullscreen){width:min(380px,calc(100vw - 28px))!important;height:min(560px,64vh)!important;right:14px!important;bottom:calc(92px + env(safe-area-inset-bottom))!important}
    .aiads-chat-header{min-height:56px!important;padding:9px 10px!important;gap:7px!important;background:var(--neo-lime)!important;border-bottom:2px solid var(--neo-line)!important;backdrop-filter:none!important;flex-wrap:nowrap!important}.aiads-chat-header strong{color:var(--neo-ink)!important;font-size:14px!important}.aiads-chat-header small{display:none!important}.aiads-chat-header>div:first-child{flex:0 0 auto;min-width:0}.aiads-chat-header-controls{display:flex;align-items:center;gap:5px;min-width:0;flex:1}.aiads-chat-header-controls select{min-width:0!important;width:88px!important;height:34px!important;padding:0 22px 0 7px!important;background:var(--neo-white)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important;border-radius:9px!important;font-size:10px!important}.aiads-chat-head-actions{margin-left:0!important;gap:4px!important}.aiads-chat-icon{height:34px!important;min-width:34px!important;padding:0 8px!important;background:var(--neo-white)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important;border-radius:9px!important;box-shadow:none!important;font-size:11px!important}.aiads-chat-controls{display:none!important}
    .aiads-chat-messages{padding:11px!important;gap:9px!important;background:var(--neo-paper)!important}.aiads-chat-empty{color:var(--neo-muted)!important}.aiads-chat-bubble{max-width:90%!important;padding:9px 11px!important;border:1.5px solid var(--neo-line)!important;border-radius:13px!important;background:var(--neo-white)!important;color:var(--neo-ink)!important;font-size:13px!important;box-shadow:2px 2px 0 rgba(21,27,43,.08)!important}.aiads-chat-bubble.user{background:var(--neo-yellow)!important;color:var(--neo-ink)!important}.aiads-chat-meta{display:none!important}.aiads-chat-media{background:#e7eaed!important;border:1.5px solid var(--neo-line)!important}.aiads-chat-media-actions a,.aiads-chat-media-actions button{background:var(--neo-lime)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important;box-shadow:none!important}
    .aiads-chat-attachments{background:var(--neo-paper)!important;padding:6px 9px 0!important}.aiads-chat-attachment{background:var(--neo-white)!important;border:1.5px solid var(--neo-line)!important}.aiads-chat-composer{padding:8px 9px calc(8px + env(safe-area-inset-bottom))!important;gap:6px!important;background:var(--neo-white)!important;border-top:2px solid var(--neo-line)!important}.aiads-chat-composer textarea{min-height:41px!important;max-height:110px!important;padding:9px 10px!important;background:var(--neo-paper)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important;border-radius:11px!important;font-size:13px!important}.aiads-chat-attach,.aiads-chat-send{height:41px!important;min-width:41px!important;border:1.5px solid var(--neo-line)!important;border-radius:11px!important;box-shadow:none!important;color:var(--neo-ink)!important}.aiads-chat-attach{background:var(--neo-blue)!important}.aiads-chat-send{background:var(--neo-lime)!important}.aiads-chat-error{background:var(--neo-pink)!important;color:#651824!important;border:1.5px solid var(--neo-line)!important}.aiads-chat-copy{background:var(--neo-lime)!important;color:var(--neo-ink)!important;border:1.5px solid var(--neo-line)!important}

    @media(max-width:1023px){
      .aiads-neo-theme .sidebar{width:min(86vw,320px)!important}.aiads-neo-theme .mobile-backdrop.open{background:rgba(21,27,43,.45)!important}
    }
    @media(max-width:767px){
      .aiads-neo-theme .topbar{height:60px!important;padding:0 10px!important}.aiads-neo-theme .page-content{width:calc(100% - 20px)!important;padding:18px 0 102px!important}.aiads-neo-theme .menu-button{display:grid!important}.aiads-neo-theme .topbar-actions .icon-button,.aiads-neo-theme .menu-button{width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important}
      .neo-bottom-nav{display:grid;grid-template-columns:1fr 1fr 58px 1fr 1fr}.aiads-neo-theme footer{padding-bottom:92px!important}
      .neo-profile-top{padding:11px}.neo-profile-avatar{width:42px;height:42px;flex-basis:42px}.neo-profile-chip{font-size:.62rem;padding:4px 7px}.neo-coach-card{grid-template-columns:58px 1fr auto;padding:10px}.neo-feature-card{min-height:150px;padding:12px}.neo-shortcut-shell,.neo-action-stack{padding:10px}.neo-shortcuts{grid-template-columns:repeat(3,1fr)}.neo-shortcut{min-height:72px}.neo-home-banner{padding:15px;align-items:flex-start;flex-direction:column}.neo-home-banner button{width:auto!important}
      .aiads-neo-theme .project-toolbar{padding:9px!important}.aiads-neo-theme .project-grid{grid-template-columns:1fr!important}.aiads-neo-theme .workspace-heading,.aiads-neo-theme .studio-heading,.aiads-neo-theme .factory-heading,.aiads-neo-theme .generator-heading,.aiads-neo-theme .provider-heading,.aiads-neo-theme .queue-heading,.aiads-neo-theme .integration-heading,.aiads-neo-theme .workflow-heading{margin-top:2px!important}.aiads-neo-theme .workspace-heading h1,.aiads-neo-theme .studio-heading h1,.aiads-neo-theme .factory-heading h1,.aiads-neo-theme .generator-heading h1,.aiads-neo-theme .provider-heading h1,.aiads-neo-theme .queue-heading h1,.aiads-neo-theme .integration-heading h1,.aiads-neo-theme .workflow-heading h1{font-size:2rem!important}
      .aiads-neo-theme .actions,.aiads-neo-theme #editor,.aiads-neo-theme #schedule-dashboard,.aiads-neo-theme .history-section,.aiads-neo-theme .trend-reference,.aiads-neo-theme .studio-card,.aiads-neo-theme .factory-panel,.aiads-neo-theme .workflow-builder,.aiads-neo-theme .workflow-summary,.aiads-neo-theme .workflow-history{padding:14px!important;border-radius:15px!important}.aiads-neo-theme .asset-toolbar{padding:8px!important}.aiads-neo-theme .asset-card{border-radius:11px!important}
      .aiads-chat-launcher{right:17px!important;bottom:calc(86px + env(safe-area-inset-bottom))!important;width:52px!important;height:52px!important;border-radius:15px!important}.aiads-chat-panel:not(.fullscreen){right:8px!important;bottom:calc(148px + env(safe-area-inset-bottom))!important;width:calc(100vw - 16px)!important;height:min(58vh,520px)!important}.aiads-chat-header-controls select{width:66px!important}.aiads-chat-icon{min-width:31px!important;height:31px!important;padding:0 6px!important}.aiads-chat-icon[data-chat-new]{font-size:0!important;width:31px!important}.aiads-chat-icon[data-chat-new]::after{content:'+';font-size:17px}.aiads-chat-panel.fullscreen{background:var(--neo-paper)!important}.aiads-chat-panel.fullscreen .aiads-chat-header-controls select{width:78px!important}
    }
    @media(max-width:390px){.neo-feature-grid{grid-template-columns:1fr 1fr}.neo-coach-copy small{display:none}.neo-arrow{min-width:54px!important}.neo-profile-stats span{font-size:.62rem}.neo-profile-stats b{font-size:.78rem}}
  `;
  document.head.appendChild(css);

  function go(selector){
    const link=document.querySelector(selector);
    if(link){link.click();window.scrollTo({top:0,behavior:'smooth'});}
  }

  function mountDashboard(){
    const workspace=document.querySelector('#project-workspace');
    if(!workspace||workspace.querySelector('.neo-home-dashboard'))return;
    const dashboard=document.createElement('section');
    dashboard.className='neo-home-dashboard';
    dashboard.innerHTML=`
      <div class="neo-profile-card">
        <div class="neo-profile-top"><div class="neo-profile-avatar">AI</div><div class="neo-profile-copy"><small>AI ADS LAB WORKSPACE</small><strong>Content Studio</strong></div><span class="neo-profile-chip">● READY</span></div>
        <div class="neo-profile-stats"><span><b>TikTok</b><small>Connected</small></span><span><b>VPS</b><small>Local storage</small></span><span><b>AI</b><small>Provider ready</small></span></div>
      </div>
      <div class="neo-coach-card" data-neo-target="text"><div class="neo-coach-art">✦</div><div class="neo-coach-copy"><b>Mulai dari Text Content</b><small>Buat carousel, preview, lalu kirim ke TikTok dalam satu alur.</small></div><button class="neo-arrow" type="button">Buka →</button></div>
      <div class="neo-feature-grid">
        <article class="neo-feature-card" data-icon="Aa" data-neo-target="text"><b>Text Content</b><small>Carousel, caption, background, dan TikTok draft.</small><span class="neo-card-button">Buka studio →</span></article>
        <article class="neo-feature-card" data-icon="✦" data-neo-target="studio"><b>Content Studio</b><small>Generate image/video dan kelola hasil produksi.</small><span class="neo-card-button">Mulai buat →</span></article>
      </div>
      <div class="neo-shortcut-shell"><div class="neo-section-label"><span>SERING DIPAKAI</span><small>6 pintasan</small></div><div class="neo-shortcuts">
        <div class="neo-shortcut" data-neo-target="assets"><i>▧</i><b>Assets</b></div><div class="neo-shortcut" data-neo-target="generator"><i>✦</i><b>Prompt</b></div><div class="neo-shortcut" data-neo-target="providers"><i>◉</i><b>Providers</b></div><div class="neo-shortcut" data-neo-target="templates"><i>▤</i><b>Templates</b></div><div class="neo-shortcut" data-neo-target="schedule"><i>◷</i><b>Jadwal</b></div><div class="neo-shortcut" data-neo-target="history"><i>↺</i><b>Riwayat</b></div>
      </div></div>
      <div class="neo-action-stack"><div class="neo-section-label"><span>TOOLS & WORKFLOW</span><small>Satu tempat produksi</small></div>
        <div class="neo-action-row" data-neo-target="factory"><div class="neo-action-icon">🏭</div><div class="neo-action-copy"><b>AI Content Factory</b><small>Produksi konten dari template dan pipeline.</small></div><span class="neo-action-go">→</span></div>
        <div class="neo-action-row" data-neo-target="workflow"><div class="neo-action-icon">⚡</div><div class="neo-action-copy"><b>Creative Workflow</b><small>Susun produksi end-to-end secara terarah.</small></div><span class="neo-action-go">→</span></div>
        <div class="neo-action-row" data-neo-target="assets"><div class="neo-action-icon">🖼</div><div class="neo-action-copy"><b>Asset Library</b><small>Gambar dan video lokal yang siap dipakai ulang.</small></div><span class="neo-action-go">→</span></div>
        <div class="neo-action-row" data-neo-target="providers"><div class="neo-action-icon">🤖</div><div class="neo-action-copy"><b>AI Providers</b><small>Atur model teks, gambar, dan video.</small></div><span class="neo-action-go">→</span></div>
      </div>
      <div class="neo-home-banner"><div><b>Semua alat produksi dalam satu workspace.</b><small>Mulai dari ide, buat visual, simpan sementara di VPS, lalu kirim ke TikTok.</small></div><button type="button" data-neo-target="studio">Mulai membuat →</button></div>
      <div class="neo-project-label">Projects & Workspace</div>`;
    workspace.prepend(dashboard);
    dashboard.addEventListener('click',event=>{const target=event.target.closest('[data-neo-target]');if(target)navigate(target.dataset.neoTarget)});
  }

  function mountBottomNav(){
    if(document.querySelector('.neo-bottom-nav'))return;
    const nav=document.createElement('nav');
    nav.className='neo-bottom-nav';nav.setAttribute('aria-label','Navigasi cepat');
    nav.innerHTML=`<button type="button" data-neo-target="home" class="active"><i>⌂</i><span>Beranda</span></button><button type="button" data-neo-target="text"><i>Aa</i><span>Text</span></button><button type="button" data-neo-target="studio" class="neo-main"><i>✦</i><span>Buat</span></button><button type="button" data-neo-target="assets"><i>▧</i><span>Assets</span></button><button type="button" data-neo-target="profile"><i>○</i><span>Akun</span></button>`;
    nav.addEventListener('click',event=>{const button=event.target.closest('[data-neo-target]');if(!button)return;nav.querySelectorAll('button').forEach(item=>item.classList.toggle('active',item===button&&!item.classList.contains('neo-main')));navigate(button.dataset.neoTarget)});
    document.body.appendChild(nav);
  }

  function navigate(target){
    const selectors={
      home:'[data-workspace-view="projects"]',text:'[data-workspace-view="legacy"][data-legacy-section="trend-reference"]',studio:'[data-workspace-view="studio"]',assets:'[data-workspace-view="assets"]',generator:'[data-workspace-view="generator"]',providers:'[data-workspace-view="providers"]',templates:'[data-workspace-view="templates"]',factory:'[data-workspace-view="factory"]',workflow:'[data-workspace-view="workflow"]',schedule:'[data-workspace-view="legacy"][data-legacy-section="schedule-dashboard"]',history:'[data-workspace-view="legacy"][data-legacy-section="history-section"]',profile:'[data-workspace-view="profile"]'};
    go(selectors[target]||selectors.home);
  }

  function applyChat(){
    const panel=document.querySelector('.aiads-chat-panel');
    if(!panel)return false;
    const header=panel.querySelector('.aiads-chat-header');
    const actions=panel.querySelector('.aiads-chat-head-actions');
    const provider=panel.querySelector('#aiads-chat-provider');
    const model=panel.querySelector('#aiads-chat-model');
    const input=panel.querySelector('#aiads-chat-input');
    if(header&&actions&&provider&&model&&!header.querySelector('.aiads-chat-header-controls')){
      const controls=document.createElement('div');controls.className='aiads-chat-header-controls';controls.append(provider,model);header.insertBefore(controls,actions);
    }
    if(input)input.placeholder='Tulis pesan…';
    return true;
  }

  function mount(){mountDashboard();mountBottomNav();applyChat();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  const observer=new MutationObserver(()=>{mountDashboard();applyChat()});observer.observe(document.documentElement,{childList:true,subtree:true});
})();