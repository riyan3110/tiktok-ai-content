const express = require('express');
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

  gateway.use(auth.requireAuth);
  gateway.use(innerApp);
  return gateway;
}

module.exports = { createSiteAuthGateway };
