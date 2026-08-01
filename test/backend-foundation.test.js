const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const foundation = fs.readFileSync('public/backend-foundation.js', 'utf8');
const workspace = fs.readFileSync('public/workspace.js', 'utf8');

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
