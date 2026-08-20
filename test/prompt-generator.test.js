const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Prompt Generator is a new workspace and preserves legacy studio', () => {
  const html = read('public/index.html');
  assert.match(html, /data-workspace-view="generator"/);
  assert.match(html, /id="prompt-generator"/);
  assert.match(html, /id="legacy-studio"/);
  assert.match(html, /Live Prompt Editor/);
  assert.match(html, /Live Preview/);
});

test('generator uses canonical local keys, targets, types, and assembly order', () => {
  const script = read('public/prompt-generator.js');
  for (const key of ['prompt.generator', 'prompt.presets', 'prompt.history']) assert.ok(script.includes(key));
  for (const target of ['Google Flow','Google Veo','Google Omni','Vidu','Kling','Hailuo','Runway','Pika','ChatGPT','Gemini','Claude','Custom']) assert.ok(script.includes(target));
  for (const type of ['Storyboard','Image Prompt','Video Prompt','UGC','Commercial','Product Photography','Anime','Review','Tutorial','TikTok Ads','YouTube Shorts','Instagram Reel']) assert.ok(script.includes(type));
  assert.match(script, /\['Project','Character','Product','Scene','Camera','Lighting','Voice','Style','Negative Prompt','Technical Notes'\]/);
});

test('generator provides quality checks and all export formats', () => {
  const script = read('public/prompt-generator.js');
  for (const check of ['Duplicate Warning','Missing Character','Missing Product','Missing Style','Missing Voice','Scene Count','Quality Score']) assert.ok(script.includes(check));
  assert.match(script, /download\('txt'/);
  assert.match(script, /download\('md'/);
  assert.match(script, /download\('json'/);
  assert.ok(read('PROMPT_GENERATOR.md').includes('Future AI Integration'));
});
