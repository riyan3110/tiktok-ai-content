const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');

function createSiteAuthGateway(innerApp, config) {
  const gateway = express.Router();
  const publicDir = path.resolve(config.publicDir || path.join(process.cwd(), 'public'));

  async function loadAppHtml() {
    return fs.readFile(path.join(publicDir, 'index.html'), 'utf8');
  }

  function isAuthenticated(req) {
    return Boolean(req.session?.user || req.session?.authenticated || req.session?.account);
  }

  gateway.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/login.html' || req.path.startsWith('/auth/') || req.path.startsWith('/api/auth/')) return next();
    if (req.path.startsWith('/api/')) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (isAuthenticated(req)) return next();
    if (req.path.includes('.') && !req.path.endsWith('.html')) return next();
    const returnTo = req.originalUrl && req.originalUrl !== '/' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
    return res.redirect(`/login${returnTo}`);
  });

  const sendAppShell = async (req, res, next) => {
    try {
      if (!isAuthenticated(req)) {
        const returnTo = req.originalUrl && req.originalUrl !== '/' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
        return res.redirect(`/login${returnTo}`);
      }

      let html = await loadAppHtml();

      // Strip feature scripts from the base HTML. Heavy modules are reloaded
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
      const finalLayoutScript = '<script defer src="/neo-layout-final.js?v=neo-layout-final-20260826d"></script>';
      const providerMobileHostFixScript = '<script defer src="/provider-mobile-host-fix.js?v=provider-host-20260826c"></script>';
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
        finalLayoutScript,
        providerMobileHostFixScript
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
