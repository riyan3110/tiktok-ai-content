const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/background-state.js'), 'utf8');

test('pending TikTok status polling resumes when a pending history item is shown after refresh', () => {
  assert.match(source, /PENDING_STATUSES\.has\(status\)[\s\S]*setPending\(item\.publish_id, status\);[\s\S]*void reliableTikTokPollDraft\(item\.publish_id\);/);
});

test('resumed TikTok polling checks status immediately instead of waiting for the first interval', () => {
  assert.match(source, /let firstCheck = true;/);
  assert.match(source, /if \(!firstCheck\)[\s\S]*await sleep\(/);
  assert.match(source, /firstCheck = false;[\s\S]*api\(`\/status\/\$\{encodeURIComponent\(id\)\}`\)/);
});

test('pending TikTok polling resumes when the browser becomes visible or focused again', () => {
  assert.match(source, /function resumeVisiblePending\(\)/);
  assert.match(source, /window\.addEventListener\('focus', resumeVisiblePending\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange', resumeVisiblePending\)/);
});

test('terminal history status clears a stale pending upload lock', () => {
  assert.match(source, /TERMINAL_STATUSES\.has\(status\)[\s\S]*clearPending\(item\.publish_id\)/);
});
