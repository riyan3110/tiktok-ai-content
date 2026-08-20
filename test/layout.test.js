const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../public/style.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

test('responsive layout covers the required viewport classes', () => {
  // 360x800 uses the base/mobile rules, 768x1024 the tablet rules, and both
  // 1366x768 and 1920x1080 the desktop rules.
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /@media\(min-width:768px\)/);
  assert.match(css, /@media\(min-width:1024px\)/);
  assert.match(css, /1360px/);
  assert.match(css, /grid-template-areas:"actions editor" "schedule schedule" "history history"/);
  assert.match(css, /grid-template-columns:minmax\(380px,2fr\) minmax\(0,3fr\)/);
});

test('manual dan AI berbagi kontrol URL tanpa mengaktifkannya untuk trending', () => {
  assert.match(html, /name="source-mode" value="without" checked><span>Tanpa URL<\/span>/);
  assert.match(html, /name="source-mode" value="with"><span>Pakai URL<\/span>/);
  assert.match(app, /topicSource === 'manual' \|\| topicSource === 'ai'/);
  assert.match(app, /const requestedTopic = topicSource === 'manual' \? \$\('#manual-topic'\)\.value : ''/);
  assert.doesNotMatch(app, /if \(!manual\).*source-mode/);
});

test('wide-screen content remains bounded and slide previews are accessible', () => {
  assert.match(css, /overflow-x:hidden/);
  assert.match(css, /aspect-ratio:9\/16/);
  assert.match(css, /object-fit:contain/);
  assert.match(html, /<dialog id="slide-preview"/);
  assert.match(html, /<div id="history"><\/div>/);
  assert.match(html, /role="switch"/);
  assert.match(html, /Text Content/);
  assert.match(html, /Gunakan referensi tren hari ini/);
});
