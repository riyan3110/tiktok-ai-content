const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'asset-compact.css'), 'utf8');

test('legacy Text Content hides crossed controls without deleting functional inputs', () => {
  assert.match(css, /label:has\(#automation-toggle\)/);
  assert.match(css, /#mode-help/);
  assert.match(css, /#background-reset/);
  assert.match(css, /#background-remove/);
});

test('background controls are compact and keep functional change button', () => {
  assert.match(css, /#background-change/);
  assert.match(css, /grid-column:2/);
  assert.match(css, /#background-upload-actions\.hidden/);
  assert.match(css, /display:contents!important/);
});

test('requested compact labels are present', () => {
  assert.match(css, /content:"Watermark"/);
  assert.match(css, /content:"All Slide"/);
});

test('mobile source topic area follows compact background row', () => {
  assert.match(css, /#legacy-studio #manual-settings/);
  assert.match(css, /grid-row:4/);
  assert.match(css, /margin-top:1px/);
});
