const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Consistency Engine is a separate frontend workspace and keeps legacy studio', () => {
  const html = read('public/index.html');
  assert.match(html, /data-workspace-view="consistency"/);
  assert.match(html, /id="consistency-engine"/);
  assert.match(html, /id="legacy-studio"/);
  assert.match(html, /Characters[\s\S]*Products[\s\S]*Styles[\s\S]*Voice[\s\S]*Settings/);
});

test('Consistency libraries use the five canonical localStorage keys', () => {
  const script = read('public/consistency.js');
  for (const key of ['consistency.characters', 'consistency.products', 'consistency.styles', 'consistency.voice', 'consistency.settings']) assert.ok(script.includes(key), `missing ${key}`);
  assert.match(script, /Import JSON/);
  assert.match(script, /Export All/);
  assert.match(script, /version:\s*1/);
  assert.match(script, /history:\s*\[\]/);
});

test('Consistency Engine ships every requested built-in style and voice preset', () => {
  const script = read('public/consistency.js');
  for (const preset of ['UGC', 'Anime', 'Semi Realistic', 'Pixar', 'Hyper Realistic', 'Cinematic', 'Fashion', 'Beauty', 'Food Commercial', 'Luxury', 'Street', 'Minimalist', 'Male Indonesia', 'Female Indonesia', 'Male English', 'Female English', 'Narrator', 'Anime Voice']) assert.ok(script.includes(preset), `missing ${preset}`);
});
