const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const studio = require('../public/prompt-studio.js');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
const workspace = fs.readFileSync(path.join(__dirname, '../public/workspace.js'), 'utf8');

test('Prompt Studio menyediakan kategori, target AI, tab project, dan local persistence', () => {
  assert.deepEqual(studio.categories, ['Storyboard', 'Character', 'Product', 'Image', 'Video', 'Voice', 'Caption', 'Custom']);
  assert.deepEqual(studio.targets, ['Google Flow', 'Google Omni', 'Veo', 'Vidu', 'Kling', 'ChatGPT', 'Gemini', 'Claude', 'Custom']);
  assert.match(workspace, />Prompt Studio</);
  assert.match(html, /src="\/prompt-studio\.js"/);
  assert.equal(studio.STORAGE_KEY, 'ai-ads-lab-prompts-v1');
});

test('search dan filter mencakup judul, tag, kategori, target AI, dan favorite', () => {
  const prompts = [
    { title: 'Hero Sepatu', tags: ['cinematic'], category: 'Video', target: 'Veo', favorite: true },
    { title: 'Caption Launch', tags: ['promo'], category: 'Caption', target: 'ChatGPT', favorite: false }
  ];
  assert.equal(studio.filterPrompts(prompts, { query: 'cinematic' }).length, 1);
  assert.equal(studio.filterPrompts(prompts, { query: 'chatgpt' })[0].title, 'Caption Launch');
  assert.equal(studio.filterPrompts(prompts, { category: 'Video', target: 'Veo', favorite: true }).length, 1);
  assert.equal(studio.filterPrompts(prompts, { favorite: true }).length, 1);
});

test('versioning membuat snapshot immutable dan menormalkan tags', () => {
  const original = { title: 'Prompt', versions: [{ version: 1, content: 'awal', tags: [], createdAt: '2026-01-01' }] };
  const updated = studio.addVersion(original, 'baru', 'notes', 'ugc, cinematic, ugc', '2026-07-31T00:00:00.000Z');
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.tags, ['ugc', 'cinematic']);
  assert.equal(updated.versions[1].content, 'baru');
  assert.equal(original.versions.length, 1);
});

test('UI Prompt Studio responsif dan menyediakan seluruh toolbar editor', () => {
  for (const label of ['Copy Prompt', 'Duplicate', 'Rename', 'Delete', 'VERSION HISTORY']) assert.match(fs.readFileSync(path.join(__dirname, '../public/prompt-studio.js'), 'utf8'), new RegExp(label));
  assert.match(css, /@media\(max-width:1000px\)/);
  assert.match(css, /@media\(max-width:767px\)/);
});
