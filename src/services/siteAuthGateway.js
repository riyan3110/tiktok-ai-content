const express = require('express');
const fs = require('node:fs/promises');
const { createSiteAuth } = require('./siteAuth');
const liveNews = require('./liveNews');

const CACHE_BUST_VERSION = 'cache-20260925-chat-two-buttons';

function stripLegacyProviderUi(html) {
  let output = String(html || '');
  output = output.replace(
    /<section id="ai-providers"[\s\S]*?(?=<section id="generation-queue")/,
    '<section id="ai-providers" class="page-view hidden"></section>\n'
  );
  output = output.replace(/\s*<script\s+src="\/ai-providers\.js(?:\?[^\"]*)?"\s*><\/script>/g, '');
  return output;
}

function createSiteAuthGateway(innerApp, config) {
  const gateway = express();
  gateway.set('trust proxy', 1);
  const auth = createSiteAuth({
    enabled: config.appAuthEnabled,
    username: config.appAuthUsername,
    password: config.appAuthPassword,
    secret: config.sessionSecret,
    days: config.appAuthDays
  });

  gateway.get('/login', (req, res) => {
    if (auth.enabled && auth.authenticated(req)) return res.redirect('/');
    res.set('Cache-Control', 'no-store');
    return res.sendFile(`${config.root}/public/login.html`);
  });

  gateway.post('/api/auth/login', express.json({ limit: '16kb' }), (req, res) => {
    if (!auth.enabled) return res.json({ authenticated: true, disabled: true });
    if (!auth.configured) return res.status(503).json({ error: 'Login AI Ads Lab belum dikonfigurasi di server.' });
    const username = String(req.body?.username || '');
    const password = String(req.body?.password || '');
    if (!auth.credentialsMatch(username, password)) return res.status(401).json({ error: 'Nama pengguna atau sandi salah.' });
    auth.issue(req, res);
    return res.json({ authenticated: true, expiresInDays: Math.round(auth.ttlMs / 86400000) });
  });

  gateway.post('/api/auth/logout', (req, res) => {
    auth.clear(req, res);
    res.json({ authenticated: false });
  });

  gateway.get('/api/auth/status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: auth.enabled, configured: auth.configured, authenticated: auth.authenticated(req) });
  });

  gateway.get('/api/auth/check', (req, res) => {
    if (auth.authenticated(req)) return res.sendStatus(204);
    return res.sendStatus(401);
  });

  // Public: live news is non-sensitive and must load before/without login so the
  // dashboard card is not stuck behind the auth wall.
  gateway.get('/api/live-news', async (req, res, next) => {
    try { res.json({ items: await liveNews.listLiveNews() }); } catch (e) { next(e); }
  });

  gateway.use(auth.requireAuth);

  gateway.use((req, res, next) => {
    if (req.method === 'GET' && /\.(?:html|js|css)$/.test(req.path)) {
      res.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
    next();
  });

  gateway.get('/automation/today', (req, res) => res.json([]));
  const rejectSuspendedAutomation = (req, res) => res.status(503).json({ error: 'Jadwal otomatis sementara dinonaktifkan.' });
  gateway.post('/automation/schedules', rejectSuspendedAutomation);
  gateway.post('/automation/schedules/:id/:action', rejectSuspendedAutomation);
  gateway.post('/automation/jobs/:id/:action', rejectSuspendedAutomation);

  const sendAppShell = async (req, res, next) => {
    try {
      const file = `${config.root}/public/index.html`;
      let html = stripLegacyProviderUi(await fs.readFile(file, 'utf8'));
      html = html.replace(/((?:src|href)=\")(\/[^\"]+\.(?:js|css))(?:\?[^\"]*)?(\")/g, `$1$2?v=${CACHE_BUST_VERSION}$3`);

      // Keep the new shell, but restore the user's saved light/dark choice before
      // deferred theme assets run so the old light shell cannot flash over it.
      html = html.replace('<html lang="id">', '<html lang="id" class="aiads-neo-theme">');
      const criticalThemeScript = '<script>(()=>{try{const t=localStorage.getItem("ai-ads-lab-theme");document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch{document.documentElement.dataset.theme="dark"}})()</script>';
      const criticalThemeStyles = '<style>html.aiads-neo-theme[data-theme="light"]{background:#f7f7f2}html.aiads-neo-theme[data-theme="light"] body{background:#f7f7f2;color:#151b2b}html.aiads-neo-theme[data-theme="dark"]{background:#0b0e14}html.aiads-neo-theme[data-theme="dark"] body{background:#0b0e14;color:#eef2f8}</style>';

      const eagerPaths = new Set([
        '/icons.js',
        '/backend-foundation.js',
        '/workspace.js'
      ]);
      const eagerScripts = new Map();
      const externalScriptPattern = /<script(?:\s+defer)?\s+src="([^"]+\.js(?:\?[^"]*)?)"\s*><\/script>/g;
      html = html.replace(externalScriptPattern, (tag, src) => {
        const pathname = src.split('?')[0];
        if (eagerPaths.has(pathname)) eagerScripts.set(pathname, `<script defer src="${src}"></script>`);
        return '';
      });

      const compactStyles = `<link rel="stylesheet" href="/asset-compact.css?v=${CACHE_BUST_VERSION}" data-asset-compact>`;
      const stabilityStyles = `<link rel="stylesheet" href="/ui-stability.css?v=${CACHE_BUST_VERSION}">`;
      const responsiveStyles = `<link rel="stylesheet" href="/responsive-professional.css?v=${CACHE_BUST_VERSION}">`;
      const preservedStyles = `<link rel="stylesheet" href="/google-studio-preserved.css?v=${CACHE_BUST_VERSION}">`;
      const performanceScript = `<script defer src="/performance-shell.js?v=${CACHE_BUST_VERSION}"></script>`;
      const lazyScript = `<script defer src="/lazy-modules.js?v=${CACHE_BUST_VERSION}"></script>`;
      const providerSimpleScript = `<script defer src="/ai-providers-simple.js?v=${CACHE_BUST_VERSION}"></script>`;
      const chatScript = `<script defer src="/floating-chat.js?v=${CACHE_BUST_VERSION}"></script>`;
      const themeScript = `<script defer src="/floating-chat-theme.js?v=${CACHE_BUST_VERSION}"></script>`;
      const liveNewsScript = `<script defer src="/live-news.js?v=${CACHE_BUST_VERSION}"></script>`;
      const pullRefreshScript = `<script defer src="/chat-copy-pull-refresh.js?v=${CACHE_BUST_VERSION}"></script>`;
      const polishScript = `<script defer src="/neo-home-polish.js?v=${CACHE_BUST_VERSION}"></script>`;
      const finalLayoutScript = `<script defer src="/neo-layout-final.js?v=${CACHE_BUST_VERSION}"></script>`;
      const providerMobileHostFixScript = `<script defer src="/provider-mobile-host-fix.js?v=${CACHE_BUST_VERSION}"></script>`;
      const providerLegalFixScript = `<script defer src="/provider-legal-fix.js?v=${CACHE_BUST_VERSION}"></script>`;
      const tiktokControlFixScript = `<script defer src="/tiktok-control-fix.js?v=${CACHE_BUST_VERSION}"></script>`;
      const preservedScript = `<script defer src="/google-studio-preserved.js?v=${CACHE_BUST_VERSION}"></script>`;
      const automationSuspendScript = `<script defer src="/automation-suspend.js?v=${CACHE_BUST_VERSION}"></script>`;
      const runtimeUiFixScript = `<script defer src="/runtime-ui-fixes.js?v=${CACHE_BUST_VERSION}"></script>`;
      const startupScripts = [
        criticalThemeScript,
        criticalThemeStyles,
        compactStyles,
        stabilityStyles,
        responsiveStyles,
        preservedStyles,
        eagerScripts.get('/icons.js'),
        eagerScripts.get('/backend-foundation.js'),
        performanceScript,
        lazyScript,
        eagerScripts.get('/workspace.js'),
        providerSimpleScript,
        chatScript,
        themeScript,
        liveNewsScript,
        pullRefreshScript,
        polishScript,
        finalLayoutScript,
        providerMobileHostFixScript,
        providerLegalFixScript,
        tiktokControlFixScript,
        preservedScript,
        automationSuspendScript,
        runtimeUiFixScript
      ].filter(Boolean).join('\n');
      html = html.replace('</head>', `${startupScripts}\n</head>`);

      res.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.type('html').send(html);
    } catch (error) { next(error); }
  };

  gateway.get('/', sendAppShell);
  gateway.get('/index.html', sendAppShell);
  gateway.use(innerApp);
  return gateway;
}

module.exports = { createSiteAuthGateway, stripLegacyProviderUi };
