const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'public', 'floating-chat-theme.js');
const source = fs.readFileSync(file, 'utf8');

test('neo UI theme script parses', () => {
  assert.doesNotThrow(() => new Function(source));
});

test('neo UI covers dashboard, mobile nav, pages, and floating chat', () => {
  for (const marker of [
    'neo-home-dashboard',
    'neo-bottom-nav',
    '.aiads-chat-launcher',
    '.aiads-chat-panel',
    '#legacy-studio',
    '.asset-card',
    '.factory-panel',
    '.generator-panel',
    '.provider-layout',
    '.workflow-builder'
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('redesign navigates through existing workspace links instead of duplicating backend flows', () => {
  assert.match(source, /data-workspace-view/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
});
