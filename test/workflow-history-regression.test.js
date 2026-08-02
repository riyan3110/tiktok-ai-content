const test = require('node:test');
const assert = require('node:assert/strict');
const history = require('../public/workflow-history');

const workflow = { id: 'same', name: 'Launch', status: 'Draft', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z', currentStep: 2, data: { project: { name: 'Launch', product: 'Serum' }, generator: { prompt: 'Hero shot' }, provider: { name: 'OpenAI' } } };
const factory = { id: 'same', name: 'Factory result', status: 'Completed', source: 'AI Content Factory', createdAt: '2026-03-01T00:00:00Z', payload: { title: 'Factory result', template: 'UGC', brief: { topic: 'Shoes', style: 'Bold', output: 'video' }, videoScript: 'Scene one', assetIds: ['a1'] } };

test('native, Content Factory, and legacy records normalize compatibly', () => {
  assert.equal(history.normalizeHistoryItem(workflow).recordType, 'workflow');
  assert.equal(history.normalizeHistoryItem(factory).recordType, 'content-factory');
  assert.notEqual(history.formatHistoryDate({ payload: { createdAt: '2025-01-01' } }), 'Invalid Date');
  assert.equal(history.formatHistoryDate({ payload: {} }), 'Tanggal tidak tersedia');
  assert.equal(history.deduplicate([workflow, factory]).length, 2, 'same id across schemas is retained');
  assert.doesNotThrow(() => history.normalizeHistoryItem(null));
});

test('search, source/status filters, and newest ordering work', () => {
  const results = history.sortAndFilter([workflow, factory], { search: 'shoes', source: 'content-factory', status: 'Completed' });
  assert.deepEqual(results.map(x => x.name), ['Factory result']);
  assert.deepEqual(history.sortAndFilter([workflow, factory]).map(x => x.name), ['Factory result', 'Launch']);
});

test('Content Factory maps to a valid new workflow without leaking raw schema', () => {
  const mapped = history.mapContentFactoryToWorkflow(factory, () => 'new-workflow');
  assert.equal(mapped.id, 'new-workflow'); assert.equal(mapped.data.project.name, 'Factory result'); assert.equal(mapped.data.project.product, 'Shoes'); assert.equal(mapped.data.consistency.style, 'Bold'); assert.equal(mapped.data.studio.format, 'video'); assert.equal(mapped.data.generator.prompt, 'Scene one'); assert.deepEqual(mapped.data.generator.assetIds, ['a1']); assert.equal(mapped.payload, undefined);
});

test('upsert, delete semantics, and duplicate ids are safe', () => {
  const updated = history.upsert([workflow, factory], { ...workflow, status: 'Completed' }); assert.equal(updated.length, 2); assert.equal(updated[0].status, 'Completed');
  const deleted = updated.filter(x => !(x.id === 'same' && history.normalizeHistoryItem(x).recordType === 'workflow')); assert.equal(deleted.length, 1); assert.equal(history.normalizeHistoryItem(deleted[0]).recordType, 'content-factory');
  const copy = history.duplicate(workflow, () => 'copy'); assert.equal(copy.id, 'copy'); assert.notEqual(copy.id, workflow.id);
});

test('same id resolves the requested schema for view and duplicate actions', () => {
  assert.equal(history.findHistoryRecord([workflow, factory], 'same', 'workflow').recordType, 'workflow');
  assert.equal(history.findHistoryRecord([workflow, factory], 'same', 'content-factory').recordType, 'content-factory');
  assert.equal(history.duplicate(history.findHistoryRecord([workflow, factory], 'same', 'workflow'), () => 'workflow-copy').data.project.name, 'Launch');
  assert.equal(history.duplicate(history.findHistoryRecord([workflow, factory], 'same', 'content-factory'), () => 'factory-copy').payload.template, 'UGC');
});

test('workflow detail UI uses a modal and never assigns a history item directly to active state', () => {
  const fs=require('node:fs'), source=fs.readFileSync(require('node:path').join(__dirname,'../public/workflow.js'),'utf8');
  assert.match(source, /openHistoryDetail/); assert.match(source, /workflow-history-modal/); assert.doesNotMatch(source, /state\s*=\s*item/); assert.match(source, /confirm\('Hapus semua history\?'\).*confirm\('Konfirmasi kedua/s);
});

test('every action resolves by id and record type and same-id factory delete is not active', () => {
  const fs=require('node:fs'), source=fs.readFileSync(require('node:path').join(__dirname,'../public/workflow.js'),'utf8');
  for (const action of ['view','duplicate','delete','continue','use']) assert.match(source, new RegExp(`data-history-${action}[^>]+data-type=`));
  for (const action of ['View','Duplicate','Continue','Use']) assert.match(source, new RegExp(`findHistoryRecord\\(b\\.dataset\\.history${action},b\\.dataset\\.type\\)`));
  assert.match(source, /const isActiveWorkflow=state\.id===id&&type==='workflow'/);
});

test('Continue/Edit and Use as Workflow Baru save the previous active draft before replacement', () => {
  const fs=require('node:fs'), source=fs.readFileSync(require('node:path').join(__dirname,'../public/workflow.js'),'utf8');
  assert.match(source, /function loadWorkflow[\s\S]*?saveHistory\(\); persist\(true\); state =/);
  assert.match(source, /function useFactory[\s\S]*?saveHistory\(\); persist\(true\); state=mapped/);
});
