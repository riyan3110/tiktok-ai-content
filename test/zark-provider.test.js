const test = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../src/db');
const connector = require('../src/ai/connector');
const { ProviderFactory } = require('../src/providers');
const { ContentStudioService } = require('../src/services/contentStudio');

const sseResponse = events => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
  status: 200,
  headers: { 'content-type': 'text/event-stream' }
});

test('Zark is registered for image and video with secure defaults', () => {
  assert.ok(ProviderFactory.names().includes('zark'));
  assert.deepEqual(ProviderFactory.defaults('zark'), { baseUrl: 'https://api.zarklab.ai', model: 'auto' });
  assert.deepEqual(connector.CAPABILITIES.zark, ['image', 'video']);
});

test('Zark API key is encrypted at rest and never returned to browser', () => {
  const db = createDatabase(':memory:');
  connector.seed(db);
  const publicSetting = connector.save(db, 'zark', { apiKey: 'zark-secret-key', enabled: true });
  const row = db.prepare('SELECT * FROM ai_provider_settings WHERE provider=?').get('zark');
  assert.equal(publicSetting.apiKey, '••••••••');
  assert.equal(publicSetting.hasApiKey, true);
  assert.notEqual(row.api_key_encrypted, 'zark-secret-key');
  assert.equal(connector.configured(row).api_key, 'zark-secret-key');
});

test('Zark discovers account model options from MCP tools/list', async () => {
  const transport = async (url, options = {}) => {
    if (url.endsWith('/v1/storage/files?limit=1')) {
      return new Response(JSON.stringify({ files: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/v1/mcp')) {
      assert.equal(options.headers['X-API-Key'], 'secret');
      const request = JSON.parse(options.body);
      assert.equal(request.method, 'tools/list');
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: [
            { name: 'image_gen', description: 'Generate image', inputSchema: { type: 'object', properties: { model: { type: 'string', enum: ['auto', 'gpt-image-2', 'seedream'] } } } },
            { name: 'video_gen', description: 'Generate video', inputSchema: { type: 'object', properties: { model: { type: 'string', enum: ['auto', 'seedance-2.5', 'kling-3'] } } } }
          ]
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const provider = ProviderFactory.create({ provider: 'zark', base_url: 'https://api.zarklab.ai', api_key: 'secret', default_model: 'auto' }, transport);
  const result = await provider.testConnection({});
  assert.equal(result.modelDiscovery, 'mcp');
  assert.deepEqual(result.models.image, ['auto', 'gpt-image-2', 'seedream']);
  assert.deepEqual(result.models.video, ['auto', 'seedance-2.5', 'kling-3']);
});

test('Content Studio exposes enabled Zark without adding a new page', () => {
  const db = createDatabase(':memory:');
  connector.seed(db);
  connector.save(db, 'zark', { apiKey: 'secret', enabled: true });
  const studio = new ContentStudioService({ db, storage: {} });
  const zark = studio.providers().find(provider => provider.id === 'zark');
  assert.equal(zark.name, 'Zark');
  assert.deepEqual(zark.types, ['image', 'video']);
  assert.equal(zark.models.video, 'auto');
});

test('Zark sends official complete payload and infers 30 second storyboard duration', async () => {
  const calls = [];
  const transport = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/v1/media/files/')) {
      return new Response(JSON.stringify({ download_url: 'https://cdn.example/final.mp4', mime_type: 'video/mp4' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return sseResponse([
      { type: 'creative_run_status', status: 'generating', run_id: 'run-1' },
      { type: 'generation_complete', media_type: 'video', file_id: 'file-video-1', filename: 'clip.mp4' },
      { type: 'usage', credits: 42 },
      { type: 'agent_run_complete', file_ids: ['file-video-1'] }
    ]);
  };
  const provider = ProviderFactory.create({ provider: 'zark', base_url: 'https://api.zarklab.ai', api_key: 'secret', default_model: 'auto' }, transport);
  const result = await provider.execute({
    mediaType: 'video',
    model: 'auto',
    prompt: '0-15 detik: pembuka. 15-30 detik: penutup.',
    parameters: { aspectRatio: '9:16' },
    assets: []
  });

  const submit = calls.find(call => call.url.endsWith('/v1/complete'));
  const body = JSON.parse(submit.options.body);
  assert.equal(submit.options.headers['X-API-Key'], 'secret');
  assert.equal(body.tool, 'video');
  assert.equal(body.mode, 'autonomous');
  assert.equal(body.tool_params.model, 'auto');
  assert.equal(body.tool_params.aspect_ratio, '9:16');
  assert.equal(body.tool_params.duration, 30);
  assert.equal(result.media[0].url, 'https://cdn.example/final.mp4');
  assert.equal(result.raw.credits, 42);
});
