const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const foundation = fs.readFileSync('public/backend-foundation.js', 'utf8');
const workspace = fs.readFileSync('public/workspace.js', 'utf8');
const account = fs.readFileSync('public/account-workspace.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

test('backend foundation exposes the modular service contracts', () => {
  for (const contract of ['ApiClient', 'ApiError', 'RequestQueue', 'LocalStorageAdapter', 'RemoteStorageAdapter', 'TokenManager', 'SessionManager', 'Auth', 'SyncManager']) assert.match(foundation, new RegExp(contract));
});

test('all required endpoints and sync resources are registered', () => {
  for (const endpoint of ['/auth/login', '/auth/register', '/auth/logout', '/auth/refresh', '/profile', '/projects', '/history']) assert.ok(foundation.includes(endpoint));
  for (const resource of ['projects', 'promptStudio', 'consistency', 'promptGenerator', 'aiProvider', 'queue', 'workflow', 'assets', 'history']) assert.ok(foundation.includes(resource));
});

test('project workspace persists through the adapter', () => {
  assert.match(workspace, /BackendFoundation\.storage\.set/);
  assert.doesNotMatch(workspace, /^\s*localStorage\.(?:getItem|setItem)/m);
});


test('Settings route opens Workspace Profile instead of the legacy placeholder', () => {
  assert.match(html, /href="#settings" data-workspace-view="profile"/);
  assert.doesNotMatch(html, /data-placeholder-view="Settings"/);
  assert.match(workspace, /\['#profile', '#settings'\]\.includes\(location\.hash\)/);
});

test('account workspace exposes authentication and operational details', () => {
  for (const label of ['Workspace Profile', 'Account Settings', 'SESSION STATUS', 'BACKEND STATUS', 'STORAGE INFO', 'AUTH TOKEN', 'Login', 'Logout']) {
    assert.ok(html.includes(label) || account.includes(label), `${label} should be visible in account workspace`);
  }
});
