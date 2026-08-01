const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('node:fs');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');

const script = fs.readFileSync('public/workspace.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');
const css = fs.readFileSync('public/style.css', 'utf8');
function setup() { const db = createDatabase(':memory:'); return { db, app: createApp({ db }) }; }
const project = { id: 'project-1', name: 'Campaign Lama', brand: 'Brand A', product: 'Produk A', category: 'Beauty', description: 'Brief asli', status: 'Draft' };

test('menu kartu menyediakan edit/delete, click-outside, dan tidak membuka kartu', () => {
  assert.match(script, /data-edit-project>Edit project/); assert.match(script, /data-delete-project>Delete project/);
  assert.match(script, /document\.addEventListener\('click'.*closeMenus/); assert.match(script, /event\.stopPropagation\(\)/);
});
test('form edit mengisi seluruh data, menampilkan status, error backend, dan loading guard', () => {
  assert.match(script, /\['name', 'brand', 'product', 'category', 'description', 'status'\]/);
  assert.match(script, /Menyimpan…/); assert.match(script, /if \(submitting/); assert.match(script, /project-form-error.*error\.message/);
  assert.match(html, /id="project-status"/); assert.match(html, /id="project-form-error"/);
});
test('delete selalu meminta konfirmasi serta memiliki cancel dan loading', () => {
  assert.match(html, /Hapus project\?/); assert.match(html, /Tindakan ini tidak dapat dibatalkan/); assert.match(html, /id="cancel-delete-project"/);
  assert.match(script, /Menghapus…/); assert.match(script, /projects = projects\.filter/);
});
test('UI project mobile dibatasi viewport tanpa horizontal overflow', () => {
  assert.match(css, /project-card-menu\{position:fixed/); assert.match(css, /width:calc\(100vw - 24px\)/); assert.match(css, /100dvh/);
});

test('PATCH mengubah project yang sama tanpa membuat duplikat dan persisten', async () => {
  const { app, db } = setup(); await request(app).post('/api/projects').send(project).expect(201);
  const response = await request(app).patch('/api/projects/project-1').send({ ...project, name: 'Campaign Baru', status: 'Aktif' }).expect(200);
  assert.equal(response.body.name, 'Campaign Baru'); assert.equal(response.body.status, 'Aktif');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM projects').get().count, 1);
  assert.equal(db.prepare('SELECT name FROM projects WHERE id=?').get('project-1').name, 'Campaign Baru'); db.close();
});
test('PATCH memvalidasi nama dan mengembalikan pesan error sebenarnya', async () => {
  const { app, db } = setup(); await request(app).post('/api/projects').send(project);
  const response = await request(app).patch('/api/projects/project-1').send({ ...project, name: ' ' }).expect(422);
  assert.equal(response.body.error, 'Nama project wajib diisi'); assert.equal(db.prepare('SELECT name FROM projects').get().name, project.name); db.close();
});
test('DELETE membuang project dan relasi secara atomik tanpa menghapus asset bersama', async () => {
  const { app, db } = setup(); await request(app).post('/api/projects').send(project);
  db.prepare("INSERT INTO project_prompts(id,project_id) VALUES('prompt-1','project-1')").run();
  db.prepare("INSERT INTO project_storyboards(id,project_id) VALUES('board-1','project-1')").run();
  db.prepare("INSERT INTO project_workflow_records(id,project_id) VALUES('flow-1','project-1')").run();
  db.prepare("INSERT INTO project_settings(project_id) VALUES('project-1')").run();
  db.prepare("INSERT INTO assets(id,name,type,mime_type,storage_provider,storage_key,storage_url,size,checksum) VALUES('shared','Shared','image','image/png','tencent-cos','shared.png','https://cos/shared.png',1,'sum')").run();
  await request(app).delete('/api/projects/project-1').expect(200);
  for (const table of ['projects', 'project_prompts', 'project_storyboards', 'project_workflow_records', 'project_settings']) assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM assets').get().count, 1); db.close();
});
test('DELETE project yang sudah hilang tidak mengklaim sukses', async () => { const { app, db } = setup(); const response = await request(app).delete('/api/projects/missing').expect(404); assert.equal(response.body.error, 'Project tidak ditemukan'); db.close(); });
