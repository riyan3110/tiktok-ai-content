const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Image Generator consumes exact Prompt Generator handoff and switches to manual prompt source', () => {
  const studio = read('public/content-studio.js');
  assert.match(studio, /const HANDOFF_KEY='aiads-image-generator-prompt'/);
  assert.match(studio, /sessionStorage\.getItem\(HANDOFF_KEY\)/);
  assert.match(studio, /sessionStorage\.removeItem\(HANDOFF_KEY\)/);
  assert.match(studio, /\[name="studio-prompt-source"\]\[value="manual"\]/);
  assert.match(studio, /aiads:image-prompt-handoff/);
  assert.match(studio, /#studio-prompt'\)\.value=prompt/);
});

test('Content Studio list excludes legacy text generations so instructions cannot render as blank images', () => {
  const service = read('src/services/contentStudio.js');
  assert.match(service, /WHERE media_type IN \('image','video'\)/);
  assert.match(service, /\['image','video'\]\.includes\(row\.media_type\)/);
});
