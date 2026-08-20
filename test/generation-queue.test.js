const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Generation Queue stays implemented without a sidebar entry', () => {
  const html = read('public/index.html');
  assert.doesNotMatch(html, /href="#generation-queue"/);
  assert.match(html, /<section id="generation-queue"/);
  assert.match(html, /data-generator-action="generate"/);
  assert.match(html, /<script src="\/generation-queue\.js"><\/script>/);
  assert.ok(read('public/generation-queue.js').includes('window.GenerationQueue'));
});

test('mock worker uses required storage boundaries and never calls AI', () => {
  const worker = read('public/generation-queue.js');
  for (const key of ['queue.jobs', 'queue.history', 'queue.settings']) assert.ok(worker.includes(key));
  for (const progress of [0, 10, 25, 40, 60, 80, 100]) assert.ok(worker.includes(String(progress)));
  assert.doesNotMatch(worker, /fetch\s*\(/);
});

test('queue documentation covers integration plan', () => {
  const docs = read('GENERATION_QUEUE.md');
  for (const heading of ['Queue Architecture', 'Worker Lifecycle', 'Retry Strategy', 'Future Backend Queue', 'Scaling Plan']) assert.ok(docs.includes(heading));
});
