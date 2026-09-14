const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const loader = fs.readFileSync(path.join(__dirname, '..', 'public', 'lazy-modules.js'), 'utf8');

test('every heavy workspace bundle is grouped for first-use loading', () => {
  for (const script of [
    '/background-state.js', '/app.js', '/assets.js', '/legacy-carousel-addon.js', '/content-studio.js', '/workflow.js', '/content-factory.js',
    '/prompt-studio.js', '/consistency.js', '/notes.js', '/ai-providers-simple.js',
    '/generation-queue.js', '/ai-integration.js', '/account-workspace.js', '/templates.js'
  ]) assert.match(loader, new RegExp(script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Text Content loads its image picker dependencies while Schedule and History keep the smaller Text bundle', () => {
  assert.match(loader, /text:\s*\['\/background-state\.js', '\/app\.js'\]/);
  assert.match(loader, /'text-content':\s*\['\/background-state\.js', '\/app\.js', '\/assets\.js', '\/legacy-carousel-addon\.js'\]/);
  assert.match(loader, /data-workspace-view="legacy"\]\[data-legacy-section="trend-reference"\].*return 'text-content'/);
  assert.match(loader, /matches\('\[data-workspace-view="legacy"\]'\).*return 'text'/);
  assert.match(loader, /case '#trend-reference': return 'text-content'/);
  for (const hash of ['#schedule-dashboard', '#history-section']) assert.match(loader, new RegExp(hash.replace('#', '\\#')));
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

test('Jadwal home shortcut is repurposed as persistent Notes workspace', () => {
  assert.match(loader, /notes:\s*\['\/notes\.js'\]/);
  assert.match(loader, /case '#notes': return 'notes'/);
  assert.match(loader, /data-neo-target="schedule"/);
  assert.match(loader, /shortcut\.dataset\.neoTarget = 'notes'/);
  assert.match(loader, /label\.textContent = 'Notes'/);
  assert.match(loader, /neo-shortcut\[data-neo-target="notes"\]/);
  assert.match(loader, /location\.hash = '#notes'/);
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
