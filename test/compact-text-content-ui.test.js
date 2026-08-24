const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'asset-compact.css'), 'utf8');
const assetsJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets.js'), 'utf8');

test('legacy Text Content hides crossed controls without deleting functional inputs', () => {
  assert.match(css, /label:has\(#automation-toggle\)/);
  assert.match(css, /#mode-help/);
  assert.match(css, /#background-reset/);
  assert.match(css, /#background-remove/);
});

test('background controls are compact and keep functional change button', () => {
  assert.match(css, /#background-change/);
  assert.match(css, /grid-column:3/);
  assert.match(css, /#background-upload-actions\.hidden/);
  assert.match(css, /display:contents!important/);
});

test('requested compact labels are present', () => {
  assert.match(css, /content:"Watermark"/);
  assert.match(css, /content:"All Slide"/);
});

test('cream, black and upload background choices use the same compact tile row', () => {
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.background-black-option/);
  assert.match(css, /aspect-ratio:1\.45\/1/);
  assert.match(assetsJs, /background-black-option/);
  assert.match(assetsJs, /value="#0B0B0D"/);
});

test('black background is a real radio option before app handlers bind', () => {
  assert.match(assetsJs, /name="carousel-background"/);
  assert.match(assetsJs, /uploadOption\.before\(blackOption\)/);
});

test('mobile source topic area follows compact background row', () => {
  assert.match(css, /#legacy-studio #manual-settings/);
  assert.match(css, /grid-row:4/);
  assert.match(css, /margin-top:1px/);
});
