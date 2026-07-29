const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/style.css'), 'utf8');

test('header dan metadata memakai satu file logo yang sudah tersedia', () => {
  assert.equal(fs.existsSync(path.join(root, 'public/assets/ai-ads-lab-logo.png')), true);
  assert.match(html, /<img src="\/assets\/ai-ads-lab-logo\.png" alt="Logo AI Ads Lab">/);
  assert.match(html, /<link rel="icon" type="image\/png" href="\/assets\/ai-ads-lab-logo\.png">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/assets\/ai-ads-lab-logo\.png">/);
  assert.match(css, /\.brand img\{[^}]*object-fit:contain/);
});

test('dashboard menyediakan default watermark aktif, kiri atas, dan sedang', () => {
  assert.match(html, /id="watermark-enabled"[^>]*checked/);
  assert.match(html, /id="watermark-position"[\s\S]*?<option value="top-left" selected>Kiri atas<\/option>[\s\S]*?<option value="top-center">Tengah atas<\/option>/);
  assert.match(html, /id="watermark-intensity"[\s\S]*?<option value="low">Rendah<\/option>[\s\S]*?<option value="medium" selected>Sedang<\/option>[\s\S]*?<option value="high">Tinggi<\/option>/);
});

test('perubahan tidak menambahkan file PNG atau ICO baru', () => {
  const added = execFileSync('git', ['diff', '--name-only', '--diff-filter=A', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  assert.deepEqual(added.filter((file) => /\.(?:png|ico)$/i.test(file)), []);
});
