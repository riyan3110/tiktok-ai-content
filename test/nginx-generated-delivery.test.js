const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function generatedBlock(text) {
  const match = String(text).match(/location\s+\^~\s+\/generated\/\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, 'Nginx config must contain a dedicated /generated/ location');
  return match[1];
}

test('production Nginx template serves generated JPEGs directly from disk', () => {
  const config = fs.readFileSync(path.join(root, 'nginx/tiktok-ai-content.conf'), 'utf8');
  const block = generatedBlock(config);

  assert.match(block, /root\s+\/var\/www\/tiktok-ai-content\/public;/);
  assert.match(block, /sendfile\s+on;/);
  assert.match(block, /Cache-Control\s+"public, max-age=300, no-transform"/);
  assert.match(block, /try_files\s+\$uri\s+=404;/);
  assert.doesNotMatch(block, /proxy_pass/);
});

test('reusable generated-image snippet stays safe for Certbot-managed HTTPS config', () => {
  const snippet = fs.readFileSync(path.join(root, 'nginx/generated-location.conf'), 'utf8');
  const block = generatedBlock(snippet);

  assert.match(snippet, /inside the HTTPS server block/i);
  assert.match(block, /open_file_cache/);
  assert.match(block, /X-Content-Type-Options\s+"nosniff"/);
  assert.doesNotMatch(block, /proxy_pass/);
});
