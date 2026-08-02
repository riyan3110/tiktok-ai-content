const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const workspace = fs.readFileSync('public/workspace.js', 'utf8');
const providers = fs.readFileSync('public/ai-providers.js', 'utf8');

const navigation = [
  ['projects', 'Projects'], ['workflow', 'Workflow'], ['templates', 'Templates'],
  ['prompt-library', 'Prompt Library'], ['consistency', 'Consistency'],
  ['prompt-generator', 'Prompt Generator'], ['ai-providers', 'AI Providers'],
  ['assets', 'Assets'],
  ['analytics', 'Analytics'], ['settings', 'Settings'],
  ['storage', 'Storage'], ['studio', 'Content Studio'],
  ['trend-reference', 'Referensi Tren'], ['schedule-dashboard', 'Jadwal'],
  ['history-section', 'Riwayat']
];

test('sidebar preserves every established and AI Provider navigation entry', () => {
  for (const [hash, label] of navigation) {
    assert.match(html, new RegExp(`href="#${hash}"[^>]*>[^<]*<span[^>]*>[^<]*</span><span>${label}</span>`));
  }
});

test('AI Integration remains implemented but hidden from sidebar navigation', () => {
  assert.doesNotMatch(html, /href="#ai-integration"/);
  assert.match(html, /<section id="ai-integration"/);
  assert.match(html, /<script src="\/ai-integration\.js"><\/script>/);
  assert.match(workspace, /location\.hash === '#ai-integration' \? 'integration'/);
});

test('Generation Queue remains implemented but hidden from sidebar navigation', () => {
  assert.doesNotMatch(html, /href="#generation-queue"/);
  assert.match(html, /<section id="generation-queue"/);
  assert.match(html, /<script src="\/generation-queue\.js"><\/script>/);
  assert.match(workspace, /location\.hash === '#generation-queue' \? 'queue'/);
});

test('legacy content routes reveal their existing implementation instead of Content Studio', () => {
  for (const id of ['trend-reference', 'schedule-dashboard', 'history-section']) {
    assert.match(html, new RegExp(`data-workspace-view="legacy" data-legacy-section="${id}"`));
    assert.match(workspace, new RegExp(`['"]${id}['"]`));
  }
  assert.match(workspace, /studio\.classList\.toggle\('hidden', view !== 'legacy'\)/);
  assert.match(workspace, /contentStudio\.classList\.toggle\('hidden', view !== 'studio'\)/);
});

test('AI Provider default action remains wired after its production extension', () => {
  assert.match(providers, /\$\('\[data-action="default"\]'\)\.onclick=\(\)=>action\('default'\)/);
});
