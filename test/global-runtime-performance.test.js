const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shell = fs.readFileSync(path.join(__dirname, '..', 'public', 'performance-shell.js'), 'utf8');
const worker = fs.readFileSync(path.join(__dirname, '..', 'public', 'service-worker.js'), 'utf8');

test('performance shell and service worker parse as JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(shell));
  assert.doesNotThrow(() => new vm.Script(worker));
});

test('Text schedule polling is gated to the visible legacy workspace', () => {
  assert.match(shell, /__AIADS_LOADING_GROUP__/);
  assert.match(shell, /loadingGroup === 'text'/);
  assert.match(shell, /Number\(delay\) === 30000/);
  assert.match(shell, /document\.visibilityState === 'visible'/);
  assert.match(shell, /!legacy\.classList\.contains\('hidden'\)/);
});

test('new media defaults are lightweight', () => {
  assert.match(shell, /media\.loading = 'lazy'/);
  assert.match(shell, /media\.decoding = 'async'/);
  assert.match(shell, /media\.preload = 'none'/);
});

test('static cache excludes APIs, generated content and HTML navigation', () => {
  assert.match(worker, /request\.method !== 'GET'/);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/auth\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/generated\/'\)/);
  assert.match(worker, /\.(?:js\|css\|png\|svg\|webp\|ico\|woff2\?)/);
  assert.doesNotMatch(worker, /request\.mode === 'navigate'.*cache\.put/s);
});

test('asset upload forwarding remains preserved', () => {
  assert.match(worker, /url\.pathname === '\/api\/assets\/upload'/);
  assert.match(worker, /\/api\/assets\/upload-file/);
  assert.match(worker, /application\/octet-stream/);
});
