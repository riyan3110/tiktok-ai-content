const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// These variables belonged to the retired environment-based Text Content client.
// Never remove login/session/storage credentials or the manual provider database.
const KEYS = ['AI_PROVIDER', 'AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'XKIRO_API_KEY', 'XKIRO_BASE_URL', 'XKIRO_MODEL'];
function writePrivate(file, text) {
  const temporary = `${file}.provider-cleanup-${process.pid}`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
}
function removeFields(object) {
  if (!object || typeof object !== 'object') return false;
  let changed = false;
  for (const key of KEYS) {
    if (Object.hasOwn(object, key)) { delete object[key]; changed = true; }
  }
  return changed;
}
function retire({ root, pm2Home = process.env.PM2_HOME || path.join(os.homedir(), '.pm2') } = {}) {
  const result = { environmentFileChanged: false, pm2FilesChanged: 0 };
  const file = path.join(root, '.env');
  if (fs.existsSync(file)) {
    const original = fs.readFileSync(file, 'utf8');
    const pattern = new RegExp(`^[\\t ]*(?:export[\\t ]+)?(?:${KEYS.join('|')})[\\t ]*=[\\t ]*(?:"(?:[^"\\\\]|\\\\[\\s\\S])*"|'[^']*'|[^\\r\\n]*)(?:[^\\r\\n]*)\\r?\\n?`, 'gm');
    const cleaned = original.replace(pattern, '');
    if (cleaned !== original) { writePrivate(file, cleaned); result.environmentFileChanged = true; }
  }
  for (const name of ['dump.pm2', 'dump.pm2.bak']) {
    const dump = path.join(pm2Home, name);
    if (!fs.existsSync(dump)) continue;
    const entries = JSON.parse(fs.readFileSync(dump, 'utf8'));
    if (!Array.isArray(entries)) continue;
    let changed = false;
    for (const entry of entries) {
      if ((entry.name || entry.pm2_env?.name) !== 'tiktok-ai-content') continue;
      for (const object of [entry, entry.env, entry.pm2_env, entry.pm2_env?.env]) changed = removeFields(object) || changed;
    }
    if (changed) { writePrivate(dump, JSON.stringify(entries, null, 2)); result.pm2FilesChanged++; }
  }
  removeFields(process.env);
  return result;
}
module.exports = { retire, KEYS };
