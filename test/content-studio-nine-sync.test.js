const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const script = fs.readFileSync('public/content-studio.js', 'utf8');

test('Content Studio refreshes the shared 9Router catalog when opened', () => {
  assert.match(script, /loadProviders\(\).*loadNineModels\(true\)/s);
  assert.match(script, /\/api\/ai\/providers\/9router\/models\$\{refresh\?'\?refresh=true'/);
  assert.match(script, /hash==='#studio'\)loadProviders\(\)/);
  assert.match(script, /pageshow.*hash==='#studio'\)loadProviders\(\)/);
});

test('switching Image or Video refreshes the 9Router catalog', () => {
  assert.match(script, /\['image','video'\]\.includes\(b\.dataset\.studioType\).*loadNineModels\(true\)/);
});

test('selecting 9Router and retrying refresh the catalog', () => {
  assert.match(script, /chosen\?\.id==='9router'\)loadNineModels\(true\)/);
  assert.match(script, /studio-model-retry.*9router'\?loadNineModels\(true\)/);
});

test('configured image and video models fall back into DIRECT MODELS', () => {
  assert.match(script, /configured=selectedProvider\.models\?\.\[media\]/);
  assert.match(script, /configured&&!combos\.includes\(configured\)&&!directModels\.includes\(configured\)\)directModels\.unshift\(configured\)/);
  assert.match(script, /models\.includes\(configured\)\?configured:combos\[0\]\|\|directModels\[0\]/);
});

test('a configured 9Router fallback enables Generate and suppresses the empty warning', () => {
  assert.match(script, /return Boolean\(models\.length\)/);
  assert.match(script, /studio-generate'\)\.disabled=empty\|\|!modelsReady/);
  assert.match(script, /status\.textContent=models\.length\?'':/);
});

test('empty 9Router model groups do not render headings', () => {
  assert.match(script, /optionGroup=\(label,models\)=>models\.length\?/);
  assert.match(script, /optionGroup\('COMBOS',combos\)\+optionGroup\('DIRECT MODELS',directModels\)/);
});

test('configured 9Router model is not duplicated', () => {
  assert.match(script, /!combos\.includes\(configured\)&&!directModels\.includes\(configured\)/);
});

test('OrcaRouter keeps its existing endpoint, fallback, and selection flow', () => {
  assert.match(script, /\/api\/ai\/providers\/orcarouter\/models/);
  assert.match(script, /orcaModels\.fallback/);
  assert.match(script, /ORCA_MODEL_KEYS\[media\]/);
  assert.doesNotMatch(script, /orcarouter\/models\$\{refresh\?'\?refresh=true':''\}[^\n]*loadNineModels/);
});
