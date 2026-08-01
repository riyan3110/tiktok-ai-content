const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public/workspace.js'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'PROJECT_WORKSPACE.md'), 'utf8');

test('workspace menyediakan navigasi dan struktur detail project Milestone 2', () => {
  for (const label of ['Projects', 'Templates', 'Prompt Library', 'Assets', 'Analytics', 'Settings']) assert.match(html, new RegExp(`>${label}<`));
  for (const moduleName of ['Storyboards', 'Prompt', 'Character', 'Product', 'Image', 'Video', 'Voice', 'Assets', 'Notes', 'Riwayat']) assert.match(script, new RegExp(`['\"]${moduleName}['\"]`));
});

test('create project memiliki field wajib dan memakai persistensi frontend terisolasi', () => {
  for (const field of ['project-name', 'project-brand', 'project-product', 'project-category', 'project-description']) assert.match(html, new RegExp(`id="${field}"`));
  assert.match(script, /ai-ads-lab-projects-v1/);
  assert.match(script, /localStorage\.setItem/);
  assert.match(script, /fetch\(url/);
  assert.match(script, /\/api\/projects/);
});

test('dashboard project menyediakan search, filter, empty state, dan dokumentasi', () => {
  assert.match(html, /id="project-search"/);
  for (const filter of ['status', 'category', 'brand', 'date']) assert.match(html, new RegExp(`id="filter-${filter}"`));
  assert.match(script, /Mulai workspace pertama Anda/);
  assert.match(docs, /## Struktur Workspace/);
  assert.match(docs, /## Alur Project/);
  assert.match(docs, /## Komponen yang Ditambahkan/);
  assert.match(docs, /## Persiapan Milestone Berikutnya/);
});
