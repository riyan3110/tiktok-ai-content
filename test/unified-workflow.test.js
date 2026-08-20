const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('unified workflow connects existing modules through internal events', () => {
  const workflow = read('public/workflow.js');
  const assets = read('public/assets.js');
  const generator = read('public/prompt-generator.js');
  const queue = read('public/generation-queue.js');
  assert.match(assets, /aiads:assets-selected/);
  assert.match(generator, /aiads:prompt-generated/);
  assert.match(queue, /aiads:queue-updated/);
  assert.match(workflow, /AIProviderConnector\.execute/);
  assert.match(workflow, /GenerationQueue\?\.enqueue/);
  assert.match(workflow, /Draft.*Ready|Ready/);
  assert.match(workflow, /Running/);
  assert.match(workflow, /Completed/);
  assert.match(workflow, /Failed/);
});

test('result viewer provides media preview and additive result actions', () => {
  const html = read('public/index.html');
  const workflow = read('public/workflow.js');
  assert.match(html, /id="workflow-result"/);
  for (const label of ['Download', 'Copy prompt', 'Copy URL']) assert.match(workflow, new RegExp(label));
  assert.match(workflow, /<video controls/);
  assert.match(workflow, /<img src/);
});
