const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildGenerationRequest } = require('../src/ai/requestBuilder');

test('requestBuilder passes user prompt verbatim without modification', () => {
  const prompts = [
    'Seekor kucing putih duduk di sofa merah',
    'Mobil hitam di jalan malam saat hujan',
    'Foto produk parfum di atas meja marmer putih, background gelap',
    'A cinematic wide shot of a woman walking through a neon-lit Tokyo alley at night',
    '## Scene\nYoung creator demonstrates a compact coffee grinder beside a sunny kitchen window.\n\n## Camera\nMedium close-up, shallow depth of field.',
  ];
  for (const prompt of prompts) {
    const request = buildGenerationRequest({ prompt, mediaType: 'image' });
    assert.equal(request.prompt, prompt, `Prompt must be preserved verbatim`);
    assert.equal(request.mediaType, 'image');
  }
});

test('requestBuilder preserves negative prompt and parameters', () => {
  const request = buildGenerationRequest({
    prompt: 'Kucing putih duduk di sofa merah',
    mediaType: 'image',
    negativePrompt: 'blurry, watermark, text',
    resolution: '1024x1024',
    style: 'photorealistic',
    seed: 42,
  });
  assert.equal(request.prompt, 'Kucing putih duduk di sofa merah');
  assert.equal(request.parameters.negativePrompt, 'blurry, watermark, text');
  assert.equal(request.parameters.resolution, '1024x1024');
  assert.equal(request.parameters.style, 'photorealistic');
  assert.equal(request.parameters.seed, 42);
});

test('requestBuilder rejects empty prompt', () => {
  assert.throws(() => buildGenerationRequest({ prompt: '', mediaType: 'image' }), /Prompt is required/);
  assert.throws(() => buildGenerationRequest({ prompt: '   ', mediaType: 'image' }), /Prompt is required/);
});

test('requestBuilder includes reference assets when provided', () => {
  const request = buildGenerationRequest({
    prompt: 'Portrait with this face reference',
    mediaType: 'image',
    assets: [{ id: 'ref-1', type: 'image', url: '/assets/ref-1/preview', mimeType: 'image/png' }],
  });
  assert.equal(request.assets.length, 1);
  assert.equal(request.assets[0].id, 'ref-1');
  assert.equal(request.assets[0].type, 'image');
});

test('vague prompt detector only matches truly vague Indonesian phrases, not real prompts', () => {
  const connectorSource = fs.readFileSync(path.join(__dirname, '../src/ai/connector.js'), 'utf8');

  const fnMatch = connectorSource.match(/function isVagueFloatingMediaPrompt[\s\S]*?^\}/m);
  assert.ok(fnMatch, 'isVagueFloatingMediaPrompt function must exist');

  const fn = new Function('body', `
    ${fnMatch[0].replace('function isVagueFloatingMediaPrompt', 'function check')}
    return check(body);
  `);

  const vagueInputs = [
    { prompt: 'buat gambar', mediaType: 'image' },
    { prompt: 'buatkan gambar', mediaType: 'image' },
    { prompt: 'generate image', mediaType: 'image' },
    { prompt: 'tolong buat gambar', mediaType: 'image' },
    { prompt: 'bikin foto', mediaType: 'image' },
  ];
  for (const body of vagueInputs) {
    assert.ok(fn(body), `Should be vague: "${body.prompt}"`);
  }

  const realPrompts = [
    { prompt: 'seekor kucing putih duduk di sofa merah', mediaType: 'image' },
    { prompt: 'mobil hitam di jalan malam saat hujan', mediaType: 'image' },
    { prompt: 'foto produk parfum di atas meja marmer putih', mediaType: 'image' },
    { prompt: 'buat foto kucing di taman', mediaType: 'image' },
    { prompt: 'buatkan gambar mobil sport merah di jalanan kota', mediaType: 'image' },
    { prompt: 'generate a portrait with bokeh background', mediaType: 'image' },
    { prompt: 'headshot profesional dengan latar belakang studio', mediaType: 'image' },
  ];
  for (const body of realPrompts) {
    assert.ok(!fn(body), `Should NOT be vague: "${body.prompt}"`);
  }
});

test('enrichFloatingMediaBody skips non-vague prompts (source code verification)', () => {
  const connectorSource = fs.readFileSync(path.join(__dirname, '../src/ai/connector.js'), 'utf8');
  assert.ok(
    connectorSource.includes('if (!isVagueFloatingMediaPrompt(body)) return body'),
    'enrichFloatingMediaBody must immediately return body unchanged for non-vague prompts'
  );
});

test('execute routes image requests to dynamicAi.executeImage', () => {
  const connectorSource = fs.readFileSync(path.join(__dirname, '../src/ai/connector.js'), 'utf8');
  assert.ok(connectorSource.includes('dynamicAi.executeImage(db, prompt'), 'Image generation must call executeImage');
  assert.ok(connectorSource.includes("validated.mediaType === 'text'"), 'Text vs image branching must exist');
  const imageCall = connectorSource.indexOf('dynamicAi.executeImage');
  const textCall = connectorSource.indexOf('dynamicAi.executeMessages');
  assert.ok(imageCall > 0 && textCall > 0, 'Both executeImage and executeMessages must be present');
});

test('executeImage receives prompt and assets from connector', () => {
  const connectorSource = fs.readFileSync(path.join(__dirname, '../src/ai/connector.js'), 'utf8');
  const callMatch = connectorSource.match(/dynamicAi\.executeImage\(db, prompt, \{[^}]*assets:[^}]*\}/);
  assert.ok(callMatch, 'executeImage call must include assets parameter');
  assert.ok(callMatch[0].includes('body.assets'), 'assets must come from body.assets');
});

test('provider validation rejects mismatched provider or model', () => {
  const connectorSource = fs.readFileSync(path.join(__dirname, '../src/ai/connector.js'), 'utf8');
  assert.ok(connectorSource.includes('body.provider !== row.id'), 'Must reject mismatched provider');
  assert.ok(connectorSource.includes('body.model && body.model !== model'), 'Must reject mismatched model');
});

test('Notes stores full note.content in sessionStorage for Generate handoff', () => {
  const notesJs = fs.readFileSync(path.join(__dirname, '../public/notes.js'), 'utf8');
  assert.ok(notesJs.includes("const HANDOFF_KEY = 'aiads-image-generator-prompt'"), 'Notes must define HANDOFF_KEY');
  assert.ok(notesJs.includes('sessionStorage.setItem(HANDOFF_KEY, prompt)'), 'Notes must store full prompt');
  assert.ok(notesJs.includes('note.content'), 'Notes must use note.content as the prompt source');
  assert.ok(!notesJs.match(/\.slice\s*\(\s*0\s*,\s*\d+\s*\)/), 'Notes must not truncate the prompt via .slice()');
  assert.ok(!notesJs.match(/\.substring\s*\(\s*0\s*,\s*\d+\s*\)/), 'Notes must not truncate the prompt via .substring()');
});

test('Content Studio reads handoff prompt and sets it unmodified', () => {
  const studioJs = fs.readFileSync(path.join(__dirname, '../public/content-studio.js'), 'utf8');
  assert.ok(studioJs.includes("HANDOFF_KEY='aiads-image-generator-prompt'"), 'Studio must define HANDOFF_KEY');
  assert.ok(studioJs.includes("sessionStorage.getItem(HANDOFF_KEY)"), 'Studio must read handoff key');
  assert.ok(studioJs.includes("$('#studio-prompt').value=prompt"), 'Studio must set full prompt to input');
});

test('Content Studio form submit sends prompt field value directly', () => {
  const studioJs = fs.readFileSync(path.join(__dirname, '../public/content-studio.js'), 'utf8');
  assert.ok(studioJs.includes("prompt:$('#studio-prompt').value.trim()"), 'Submit must use the raw prompt field value');
  assert.ok(!studioJs.match(/prompt.*enhance|prompt.*rewrite|prompt.*improve/i), 'Submit must not rewrite the prompt');
});
