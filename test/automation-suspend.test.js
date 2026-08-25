const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('automatic Text Content worker is suspended without deleting schedule data', () => {
  const server = read('src/server.js');
  assert.match(server, /const AUTOMATION_SUSPENDED = true;/);
  assert.match(server, /if \(!AUTOMATION_SUSPENDED\) \{/);
  assert.match(server, /automation\.recoverInterruptedJobs\(db\);/);
  assert.match(server, /setInterval\(runAutomation, 30 \* 1000\)\.unref\(\);/);
  assert.match(server, /existing schedule data preserved/);
});

test('authenticated gateway blocks live automation operations while suspended', () => {
  const gateway = read('src/services/siteAuthGateway.js');
  assert.match(gateway, /gateway\.get\('\/automation\/today', \(req, res\) => res\.json\(\[\]\)\);/);
  assert.match(gateway, /gateway\.post\('\/automation\/schedules', rejectSuspendedAutomation\);/);
  assert.match(gateway, /gateway\.post\('\/automation\/schedules\/:id\/:action', rejectSuspendedAutomation\);/);
  assert.match(gateway, /gateway\.post\('\/automation\/jobs\/:id\/:action', rejectSuspendedAutomation\);/);
  assert.match(gateway, /automation-suspend\.js\?v=automation-suspend-20260826a/);
});

test('Text Content automatic schedule controls stay hidden and disabled', () => {
  const ui = read('public/automation-suspend.js');
  assert.match(ui, /document\.getElementById\('schedule-dashboard'\)/);
  assert.match(ui, /document\.getElementById\('automation-settings'\)/);
  assert.match(ui, /document\.getElementById\('automation-toggle'\)/);
  assert.match(ui, /toggle\.checked = false;/);
  assert.match(ui, /toggle\.disabled = true;/);
  assert.match(ui, /hideElement\(toggle\.closest\('label'\)\);/);
  assert.match(ui, /url\.pathname === '\/automation\/today'/);
});
