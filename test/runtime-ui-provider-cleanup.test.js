const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('runtime UI fix restores page scrolling outside an open drawer', () => {
  const source = read('public/runtime-ui-fixes.js');
  assert.match(source, /body:not\(\.drawer-open\)/);
  assert.match(source, /overflow-y:auto!important/);
  assert.match(source, /\.page-view:not\(\.hidden\)/);
  assert.match(source, /localStorage\.removeItem\(drawerStorageKey\)/);
});

test('runtime UI fix supports both saved light and dark themes', () => {
  const source = read('public/runtime-ui-fixes.js');
  assert.match(source, /ai-ads-lab-theme/);
  assert.match(source, /data-theme="light"/);
  assert.match(source, /data-theme="dark"/);
  assert.match(source, /color-scheme:dark!important/);
});

test('app shell loads global runtime fixes after legacy theme assets', () => {
  const source = read('src/services/siteAuthGateway.js');
  const theme = source.indexOf('floating-chat-theme.js');
  const runtime = source.lastIndexOf('runtime-ui-fixes.js');
  assert.ok(theme >= 0);
  assert.ok(runtime > theme);
  assert.match(source, /criticalThemeScript/);
});

test('presenter video runtime is no longer installed or shipped', () => {
  const server = read('src/server.js');
  assert.doesNotMatch(server, /presenterVideoPatch|installPresenterVideoPatch/);
  assert.equal(fs.existsSync(path.join(root, 'src/services/presenterVideoPatch.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'public/presenter-video-addon.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'public/presenter-video-addon.css')), false);
});
