const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('AI Content Factory is additive, routed, and offers every requested template', () => {
  const html = read('public/index.html');
  const workspace = read('public/workspace.js');
  const factory = read('public/content-factory.js');
  assert.match(html, /data-workspace-view="factory"/);
  assert.match(workspace, /view !== 'factory'/);
  for (const name of ['Fakta Unik', 'Tutorial AI', 'Prompt AI', 'Edukasi', 'Tips Bisnis', 'Marketing', 'Crypto', 'Teknologi', 'Storytelling', 'Motivasi', 'Produk', 'Review Produk', 'UGC', 'Carousel TikTok', 'Thread X', 'Instagram Carousel', 'Facebook Post', 'YouTube Shorts Script', 'TikTok Script']) assert.match(factory, new RegExp(name));
});

test('factory supports structures, providers, asset reuse, workflow history, batch, previews, and exports', () => {
  const html = read('public/index.html');
  const factory = read('public/content-factory.js');
  for (const value of ['3 slide', '5 slide', '7 slide', '10 slide', '15 slide', '15 detik', '30 detik', '45 detik', '60 detik', 'Generate 5 konten', 'Generate 10 konten', 'Generate 20 konten']) assert.match(html, new RegExp(value));
  for (const provider of ['Google Flow', 'Google Veo', 'Google Imagen', 'Google Gemini', 'OpenAI Images', 'Omni', 'Vidu']) assert.match(html, new RegExp(provider));
  for (const tab of ['carousel', 'caption', 'prompt', 'script', 'thumbnail']) assert.match(html, new RegExp(`data-factory-tab="${tab}"`));
  for (const format of ['txt', 'md', 'json', 'copy']) assert.match(html, new RegExp(`data-factory-export="${format}"`));
  assert.match(factory, /fetch\('\/api\/assets'\)/);
  assert.match(factory, /ai-ads-lab-workflow-history-v1/);
  assert.match(factory, /ai-ads-lab-content-factory-history-v1/);
  assert.match(factory, /visualPrompt/);
  assert.match(factory, /voiceScript/);
});

test('factory mobile layout stays within the viewport', () => {
  const css = read('public/style.css');
  assert.match(css, /@media\(max-width:767px\).*\.content-factory\{width:100%;overflow:hidden\}/s);
  assert.match(css, /\.factory-template\{flex:0 0 240px/);
  assert.match(css, /\.factory-builder-grid\{display:block\}/);
});
