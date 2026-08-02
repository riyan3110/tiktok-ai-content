const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const studio = fs.readFileSync('public/content-studio.js', 'utf8');
const providerUi = fs.readFileSync('public/ai-providers.js', 'utf8');

test('Content Studio refreshes the shared 9Router catalog when opened or capability changes', () => {
  assert.match(studio, /loadProviders\(\).*loadNineModels\(true\)/s);
  assert.match(studio, /\/api\/ai\/providers\/9router\/models\$\{refresh\?'\?refresh=true'/);
  assert.match(studio, /\['image','video'\]\.includes\(b\.dataset\.studioType\).*loadNineModels\(true\)/);
  assert.match(studio, /chosen\?\.id==='9router'\)loadNineModels\(true\)/);
});

test('My2 is not injected into empty image or video catalogs', () => {
  assert.doesNotMatch(studio, /directModels\.unshift\(configured\)/);
  assert.doesNotMatch(studio, /unshift\(configured\)/);
  assert.doesNotMatch(studio, /My[123]/);
});

test('configured and saved media models are selected only when present in the exact catalog', () => {
  assert.match(studio, /models\.includes\(saved\)\?saved:models\.includes\(configured\)\?configured:combos\[0\]\|\|directModels\[0\]\|\|''/);
  assert.doesNotMatch(studio, /value="\$\{safe\(configured\)\}/);
});

test('an empty media catalog shows only Not selected, hides headings, and disables Generate', () => {
  assert.match(studio, /input\.innerHTML='<option value="">Not selected<\/option>'\+optionGroup\('COMBOS',combos\)\+optionGroup\('DIRECT MODELS',directModels\)/);
  assert.match(studio, /optionGroup=\(label,models\)=>models\.length\?/);
  assert.match(studio, /input\.disabled=!models\.length/);
  assert.match(studio, /studio-generate'\)\.disabled=empty\|\|!modelsReady/);
  assert.match(studio, /catalogError\?\.message\|\|'Tidak ada model 9Router/);
});

test('invalid 9Router model cannot submit or enable Generate', () => {
  assert.match(studio, /valid=\[\.\.\.\(catalog\?\.combos\|\|\[\]\),\.\.\.\(catalog\?\.directModels\|\|\[\]\)\]/);
  assert.match(studio, /if\(!model\|\|!valid\.includes\(model\)\).*return/s);
  assert.match(studio, /return Boolean\(models\.length\)/);
});

test('AI Providers omits both empty grouped headings', () => {
  assert.match(providerUi, /group=\(title,items=\[\]\)=>items\.length\?/);
  assert.match(providerUi, /group\('COMBOS',catalog\.combos\|\|\[\]\)/);
  assert.match(providerUi, /group\('DIRECT MODELS',catalog\.directModels\|\|\[\]\)/);
});

test('text, image, and video use their complete capability catalogs', () => {
  assert.match(providerUi, /nineModels\?\.text/);
  assert.match(providerUi, /nineModels\?\.image/);
  assert.match(providerUi, /nineModels\?\.video/);
  assert.match(studio, /group=nineModels\?\.\[media\]/);
  assert.doesNotMatch(providerUi, /My1.*My2.*My3/);
});

test('Refresh Models updates provider selectors, capability counts, and Content Studio', () => {
  assert.match(providerUi, /nineModels=await http\('\/api\/ai\/providers\/9router\/models\?refresh=true'\);render\(\)/);
  assert.match(providerUi, /dispatchEvent\(new CustomEvent\('9router-models-refreshed'/);
  assert.match(studio, /addEventListener\('9router-models-refreshed'.*nineModels=event\.detail.*renderProviders/s);
  assert.match(providerUi, /Detected capabilities/);
});

test('OrcaRouter keeps its existing endpoint, fallback, and selection flow', () => {
  assert.match(studio, /\/api\/ai\/providers\/orcarouter\/models/);
  assert.match(studio, /orcaModels\.fallback/);
  assert.match(studio, /ORCA_MODEL_KEYS\[media\]/);
  assert.doesNotMatch(studio, /orcarouter\/models\$\{refresh\?'\?refresh=true':''\}[^\n]*loadNineModels/);
});
