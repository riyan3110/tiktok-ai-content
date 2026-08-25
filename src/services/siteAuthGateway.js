const express = require('express');
const fs = require('node:fs/promises');
const { createSiteAuth } = require('./siteAuth');

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

  gateway.post('/api/ai/providers/nanobanana/callback', express.json({ limit: '1mb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.sendStatus(204);
  });

  gateway.use(auth.requireAuth);

  const sendAppShell = async (req, res, next) => {
    try {
      const file = `${config.root}/public/index.html`;
      let html = await fs.readFile(file, 'utf8');

      // Keep only the truly global shell eager. Feature/page bundles are loaded
      // by lazy-modules.js on first use, then remain cached for later navigation.
      const eagerPaths = new Set([
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

      // Stable UI layers are eager so refreshes and responsive breakpoints do not
      // depend on opening a lazy feature first.
      const compactStyles = '<link rel="stylesheet" href="/asset-compact.css?v=compact-20260825b" data-asset-compact>';
      const stabilityStyles = '<link rel="stylesheet" href="/ui-stability.css?v=ui-stability-20260825a">';
      const responsiveStyles = '<link rel="stylesheet" href="/responsive-professional.css?v=responsive-20260826c">';
      const performanceScript = '<script defer src="/performance-shell.js?v=global-perf-20260825b"></script>';
      const lazyScript = '<script defer src="/lazy-modules.js?v=global-perf-20260825b"></script>';
      const chatScript = '<script defer src="/floating-chat.js?v=floating-chat-20260825a"></script>';
      const themeScript = '<script defer src="/floating-chat-theme.js?v=neo-dashboard-20260825g"></script>';
      const polishScript = '<script defer src="/neo-home-polish.js?v=home-polish-20260826i"></script>';
      const finalLayoutScript = '<script defer src="/neo-layout-final.js?v=neo-layout-final-20260826a"></script>';
      const startupScripts = [
        compactStyles,
        stabilityStyles,
        responsiveStyles,
        eagerScripts.get('/backend-foundation.js'),
        performanceScript,
        lazyScript,
        eagerScripts.get('/workspace.js'),
        chatScript,
        themeScript,
        polishScript,
        finalLayoutScript
      ].filter(Boolean).join('\n');
      html = html.replace('</head>', `${startupScripts}\n</head>`);

      res.set('Cache-Control', 'no-cache, max-age=0, must-revalidate');
      res.type('html').send(html);
    } catch (error) { next(error); }
  };

  gateway.get('/', sendAppShell);
  gateway.get('/index.html', sendAppShell);
  gateway.use(innerApp);
  return gateway;
}

module.exports = { createSiteAuthGateway };
