const test = require('node:test');
const assert = require('node:assert/strict');
const { createSiteAuth, signToken, verifyToken } = require('../src/services/siteAuth');

const config = { enabled: true, username: 'owner', password: 'strong-password', secret: 'session-secret', days: 180 };

test('signed login token survives server restarts without server-side session state', () => {
  const authA = createSiteAuth(config);
  const now = Date.now();
  const token = signToken({ u: 'owner', iat: now, exp: now + authA.ttlMs }, config.secret, config.password);
  const authB = createSiteAuth(config);
  assert.ok(verifyToken(token, { username: config.username, password: config.password, secret: config.secret }, now + 1000));
  assert.equal(authB.credentialsMatch('owner', 'strong-password'), true);
});

test('changing password invalidates old persistent login token', () => {
  const now = Date.now();
  const token = signToken({ u: 'owner', iat: now, exp: now + 86400000 }, config.secret, config.password);
  assert.equal(verifyToken(token, { username: 'owner', password: 'new-password', secret: config.secret }, now + 1000), null);
});

test('expired token is rejected', () => {
  const now = Date.now();
  const token = signToken({ u: 'owner', iat: now - 2000, exp: now - 1000 }, config.secret, config.password);
  assert.equal(verifyToken(token, { username: config.username, password: config.password, secret: config.secret }, now), null);
});

test('provider and API paths are protected while public callback and policy pages remain reachable', () => {
  const auth = createSiteAuth(config);
  assert.equal(auth.publicPath('/api/ai/providers'), false);
  assert.equal(auth.publicPath('/api/content-studio/providers'), false);
  assert.equal(auth.publicPath('/auth/tiktok/callback'), true);
  assert.equal(auth.publicPath('/privacy'), true);
  assert.equal(auth.publicPath('/terms'), true);
  assert.equal(auth.publicPath('/generated/123.jpg'), true);
});
