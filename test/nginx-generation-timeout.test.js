const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('nginx memberi waktu cukup untuk source-backed generation', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'nginx', 'tiktok-ai-content.conf'), 'utf8');
  assert.match(config, /proxy_connect_timeout\s+15s;/);
  assert.match(config, /proxy_send_timeout\s+180s;/);
  assert.match(config, /proxy_read_timeout\s+180s;/);
});
