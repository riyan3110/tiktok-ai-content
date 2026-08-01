const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public/workflow.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'WORKFLOW_ORCHESTRATOR.md'), 'utf8');

test('Milestone 9 exposes the complete seven-step workflow UI', () => {
  for (const label of ['Project', 'Consistency', 'Prompt Studio', 'Prompt Generator', 'AI Provider', 'Generation Queue', 'AI Integration']) assert.match(script, new RegExp(`label: '${label}'`));
  for (const id of ['workflow-stepper', 'workflow-progress-bar', 'workflow-summary-content', 'workflow-generate', 'workflow-history-list', 'workflow-undo', 'workflow-redo']) assert.match(html, new RegExp(`id="${id}"`));
});

test('workflow remains local-only with autosave, recovery, history, and validation', () => {
  assert.match(script, /ai-ads-lab-workflow-v1/);
  assert.match(script, /localStorage\.setItem/);
  assert.match(script, /function validate/);
  assert.match(script, /function recover/);
  assert.doesNotMatch(script, /fetch\(|XMLHttpRequest|WebSocket/);
});

test('orchestrator is responsive and architecture is documented', () => {
  assert.match(css, /\.workflow-layout\{display:grid/);
  assert.match(css, /@media\(max-width:1000px\)/);
  assert.match(css, /@media\(max-width:767px\)/);
  for (const heading of ['## Arsitektur', '## Persistensi dan Draft', '## Validasi dan Navigasi', '## Undo / Redo dan Error Recovery']) assert.match(docs, new RegExp(heading.replace('/', '\\/')));
});
