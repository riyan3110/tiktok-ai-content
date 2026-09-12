const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { retire, KEYS } = require('../src/services/legacyTextEnvironment');

test('retirement removes only old Text AI values from env and this app PM2 dumps', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiads-legacy-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pm2Home = path.join(root, 'pm2'); fs.mkdirSync(pm2Home);
  fs.writeFileSync(path.join(root, '.env'), '# retained\nSESSION_SECRET=keep-session\nAI_API_KEY="retired\nmultiline"\nAI_BASE_URL=https://old.invalid/v1\nexport AI_MODEL=old-model\nAI_PROVIDER=old-provider\nSTORAGE_KEY=keep-storage\nXKIRO_API_KEY=old-xkiro\n');
  const otherApp = { name: 'other-app', env: { AI_API_KEY: 'keep-other-app' } };
  for (const name of ['dump.pm2', 'dump.pm2.bak']) fs.writeFileSync(path.join(pm2Home, name), JSON.stringify([{ name: 'tiktok-ai-content', AI_API_KEY: 'retired', env: { AI_BASE_URL: 'old', SESSION_SECRET: 'keep-session' }, pm2_env: { AI_MODEL: 'old', env: { XKIRO_API_KEY: 'retired' } } }, otherApp]));
  assert.deepEqual(retire({ root, pm2Home }), { environmentFileChanged: true, pm2FilesChanged: 2 });
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.equal(env, '# retained\nSESSION_SECRET=keep-session\nSTORAGE_KEY=keep-storage\n');
  for (const name of ['dump.pm2', 'dump.pm2.bak']) {
    const entries = JSON.parse(fs.readFileSync(path.join(pm2Home, name), 'utf8'));
    assert.deepEqual(entries[1], otherApp);
    assert.equal(entries[0].env.SESSION_SECRET, 'keep-session');
    for (const object of [entries[0], entries[0].env, entries[0].pm2_env, entries[0].pm2_env.env]) {
      assert.ok(KEYS.every(key => !Object.hasOwn(object, key)));
    }
  }
  assert.deepEqual(retire({ root, pm2Home }), { environmentFileChanged: false, pm2FilesChanged: 0 });
});

test('retirement tolerates installations without env or PM2 files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aiads-legacy-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(retire({ root, pm2Home: path.join(root, 'missing') }), { environmentFileChanged: false, pm2FilesChanged: 0 });
});
