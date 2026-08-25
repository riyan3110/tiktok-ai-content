const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loader = fs.readFileSync(path.join(__dirname, '..', 'public', 'lazy-modules.js'), 'utf8');

test('every heavy workspace bundle is grouped for first-use loading', () => {
  for (const script of [
    '/background-state.js', '/app.js', '/assets.js', '/content-studio.js', '/workflow.js', '/content-factory.js',
    '/prompt-studio.js', '/consistency.js', '/prompt-generator.js', '/ai-providers.js',
    '/generation-queue.js', '/ai-integration.js', '/account-workspace.js', '/templates.js'
  ]) assert.match(loader, new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('legacy Text, Schedule and History routes load the Text bundle only on first use', () => {
  assert.match(loader, /text:\s*\['\/background-state\.js', '\/app\.js'\]/);
  assert.match(loader, /matches\('\[data-workspace-view="legacy"\]'\).*return 'text'/);
  for (const hash of ['#trend-reference', '#schedule-dashboard', '#history-section']) assert.match(loader, new RegExp(hash.replace('#', '\\#')));
});

test('Assets and Storage share the Assets bundle', () => {
  assert.match(loader, /data-workspace-view="assets".*data-workspace-view="storage"/);
  assert.match(loader, /case '#assets':[\s\S]*case '#storage': return 'assets'/);
});

test('Text Content asset picker loads Assets before retrying click', () => {
  assert.match(loader, /#studio-select-assets/);
  assert.match(loader, /await load\('assets'\); assetPicker\.click\(\)/);
});

test('project prompt tab loads Prompt Studio before retrying click', () => {
  assert.match(loader, /\[data-project-tab="prompts"\]/);
  assert.match(loader, /await load\('prompt-studio'\); promptTab\.click\(\)/);
});

test('idle prefetch warms modules without executing them and respects data saver', () => {
  assert.match(loader, /link\.rel = 'prefetch'/);
  assert.match(loader, /requestIdleCallback/);
  assert.match(loader, /connection\?\.saveData/);
  assert.doesNotMatch(loader, /Promise\.all\(Object\.keys\(groups\).*load/);
});

test('lazy navigation responds to links and direct hashes', () => {
  assert.match(loader, /\[data-workspace-view\]/);
  assert.match(loader, /hashchange/);
  assert.match(loader, /groupFromHash/);
});
