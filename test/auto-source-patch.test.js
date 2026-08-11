const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const { autoSourceRequested } = require('../src/services/autoSourcePatch');

test('manual Tanpa URL activates auto source even when legacy UI sends useSources=false', () => {
  assert.equal(autoSourceRequested({ mode: 'manual', useSources: false, sourceUrls: [] }), true);
});

test('manual Pakai URL stays on the existing URL path', () => {
  assert.equal(autoSourceRequested({ mode: 'manual', useSources: true, sourceUrls: ['https://example.test/article'] }), false);
});

test('manual Pakai URL with an empty field is still handled by the existing URL validation path', () => {
  assert.equal(autoSourceRequested({ mode: 'manual', useSources: true, sourceUrls: [] }), false);
});

test('automatic AI topic mode without URLs is not hijacked by manual auto source', () => {
  assert.equal(autoSourceRequested({ mode: 'ai', useSources: false, sourceUrls: [] }), false);
});
