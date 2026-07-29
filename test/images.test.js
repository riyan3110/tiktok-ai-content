const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const config = require('../src/config');
const images = require('../src/services/images');
const { createDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const request = require('supertest');

const content = { hook: 'Hook', body: '1. Langkah', topic: 'Topik', cta: 'Coba' };

test('slide dirender sebagai JPEG RGB/sRGB 1080 x 1920 dengan ekstensi jpg', async (t) => {
  const id = `test-${process.pid}-${Date.now()}`;
  const files = await images.createSlides(id, content);
  t.after(async () => Promise.all(files.map((file) => fs.rm(path.join(config.root, 'public', file), { force: true }))));

  assert.equal(files.length, 3);
  assert.ok(files.every((file) => file.endsWith('.jpg')));
  for (const file of files) {
    const metadata = await sharp(path.join(config.root, 'public', file)).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.width, 1080);
    assert.equal(metadata.height, 1920);
    assert.equal(metadata.space, 'srgb');
    assert.equal(metadata.channels, 3);
    assert.equal(metadata.hasAlpha, false);
  }
  await images.validateSlides(files);

  const db = createDatabase(':memory:');
  const app = createApp({ db });
  await request(app).get(files[0]).expect(200).expect('Content-Type', /^image\/jpeg/);
  db.close();
});

test('validasi menolak PNG lama dengan pesan bahasa Indonesia', async () => {
  await assert.rejects(images.validateSlides(['/generated/slide-lama.png']), /bukan file JPG yang valid/);
});
