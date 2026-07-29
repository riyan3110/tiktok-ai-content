const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER = 'gemini';
process.env.AI_API_KEY = 'test-key';
process.env.AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
process.env.AI_MODEL = 'gemini-2.5-flash-lite';

const config = require('../src/config');
const { generateContent } = require('../src/services/content');

test('validasi konfigurasi AI memberi pesan untuk variable yang belum diisi', () => {
  assert.throws(
    () => config.validateAiConfigValues({ aiProvider: 'gemini' }),
    /AI_API_KEY, AI_BASE_URL, AI_MODEL/
  );
});

test('validasi konfigurasi AI menolak provider yang tidak didukung', () => {
  assert.throws(
    () => config.validateAiConfigValues({ aiProvider: 'unknown', aiApiKey: 'key', aiBaseUrl: 'https://example.com/v1', aiModel: 'model' }),
    /Gunakan salah satu: gemini, groq, openai/
  );
});

test('generate memakai Chat Completions dan mempertahankan struktur JSON', async () => {
  let request;
  const expected = { topic: 'Topik', hook: 'Hook', body: '1. Langkah', caption: 'Caption', hashtags: ['#AI'], cta: 'Coba' };
  const client = { chat: { completions: { create: async (value) => {
    request = value;
    return { choices: [{ message: { content: JSON.stringify(expected) } }] };
  } } } };

  const result = await generateContent([], client);

  assert.deepEqual(result, expected);
  assert.equal(request.model, 'gemini-2.5-flash-lite');
  assert.equal(request.response_format.type, 'json_object');
  assert.match(request.messages[1].content, /"required":\["topic","hook","body","caption","hashtags","cta"\]/);
});

test('generate memberi pesan jelas ketika provider mengembalikan JSON invalid', async () => {
  const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: 'bukan JSON' } }] }) } } };
  await assert.rejects(() => generateContent([], client), /mengembalikan JSON yang tidak valid/);
});
test('prompt mengikuti kategori, format, dan menjaga inti topik manual', async () => {
  let request;
  const result = { topic: 'Blockchain untuk pemula', hook: 'Hook', body: 'Masalah: rumit\nSolusi: analogi', caption: 'Caption', hashtags: ['#Teknologi'], cta: 'Simpan' };
  const client = { chat: { completions: { create: async (value) => { request = value; return { choices: [{ message: { content: JSON.stringify(result) } }] }; } } } };
  await generateContent([], { topicSource: 'manual', requestedTopic: 'Blockchain untuk pemula', contentCategory: 'Edukasi teknologi', contentFormat: 'Masalah dan solusi' }, client);
  const prompt = request.messages[1].content;
  assert.match(prompt, /jangan mengubah inti topiknya/i);
  assert.match(prompt, /bahasa sederhana/);
  assert.match(prompt, /Masalah, Penyebab, lalu Solusi/);
  assert.match(prompt, /Jangan memaksakan isi menjadi video iklan/);
});
