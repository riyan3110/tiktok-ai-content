const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loader = fs.readFileSync(path.join(__dirname, '..', 'public', 'lazy-modules.js'), 'utf8');

test('heavy frontend modules are grouped for first-use loading', () => {
  for (const script of [
    '/assets.js', '/content-studio.js', '/workflow.js', '/content-factory.js',
    '/prompt-studio.js', '/consistency.js', '/prompt-generator.js', '/ai-providers.js',
    '/generation-queue.js', '/ai-integration.js', '/account-workspace.js', '/templates.js'
  ]) assert.match(loader, new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Text Content asset picker loads Assets before retrying click', () => {
  assert.match(loader, /#studio-select-assets/);
  assert.match(loader, /await load\('assets'\); assetPicker\.click\(\)/);
});

test('project prompt tab loads Prompt Studio before retrying click', () => {
  assert.match(loader, /\[data-project-tab="prompts"\]/);
  assert.match(loader, /await load\('prompt-studio'\); promptTab\.click\(\)/);
});

test('lazy navigation responds to links and direct hashes', () => {
  assert.match(loader, /\[data-workspace-view\]/);
  assert.match(loader, /hashchange/);
  assert.match(loader, /groupFromHash/);
});
