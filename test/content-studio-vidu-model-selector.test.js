const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const script = fs.readFileSync('public/content-studio.js', 'utf8');

test('Vidu model selector defines capability-specific, non-empty option lists', () => {
  assert.match(script, /VIDU_MODELS=\{image:\['viduq2','viduq1'\],video:\['viduq3-turbo','viduq3-pro','viduq2','viduq1'\]\}/);
  assert.match(script, /input\.innerHTML=models\.map\(model=>`<option value=/);
  assert.match(script, /choice=models\.includes\(saved\)\?saved:models\.includes\(configured\)\?configured:models\[0\]\|\|''/);
  assert.match(script, /return Boolean\(choice&&models\.includes\(choice\)\)/);
});

test('Vidu remembers image and video selections independently', () => {
  assert.match(script, /contentStudio\.vidu\.imageModel/);
  assert.match(script, /contentStudio\.vidu\.videoModel/);
  assert.match(script, /localStorage\.setItem\(VIDU_MODEL_KEYS\[media\],input\.value\)/);
  assert.match(script, /configureMode\(b\.dataset\.studioType\)/);
  assert.match(script, /renderProviders\(media\)/);
});

test('Vidu rejects an empty or capability-invalid model before generation', () => {
  assert.match(script, /provider==='vidu'&&!VIDU_MODELS\[media\]\?\.includes\(model\)/);
  assert.match(script, /Pilih model Vidu yang tersedia untuk capability ini\./);
  assert.match(script, /studio-generate'\)\.disabled=empty\|\|!modelsReady/);
});

test('OrcaRouter and 9Router retain their dedicated model selector paths', () => {
  assert.match(script, /if\(isNine\)\{/);
  assert.match(script, /if\(!isOrca\)/);
  assert.match(script, /ORCA_MODEL_KEYS\[media\]/);
  assert.match(script, /NINE_MODEL_KEYS\[media\]/);
});
