const test = require('node:test');
const assert = require('node:assert/strict');
const images = require('../src/services/images');

const slides = [
  { section: 'PEMBUKA', title: 'Robot Belajar Melipat Baju', body: 'Robot rumah tangga dilatih menangani pakaian.', points: [] },
  { section: 'FAKTA', title: 'Melipat Baju Jadi Latihan', body: 'Melipat baju jadi latihan.', points: ['Melipat baju jadi latihan'] },
  { section: 'PENJELASAN', title: 'Kain Sulit Ditangani Robot', body: 'Kain sulit ditangani robot.', points: ['Kain sulit ditangani robot'] },
  { section: 'PENUTUP', title: 'Tugas Sederhana, Tantangan Rumit', body: 'Kemampuan ini membantu menguji ketangkasan robot.', points: [] }
];

const base = {
  slides,
  contentCategory: 'Fakta unik',
  contentFormat: 'Fakta singkat'
};

test('renderer tidak mengulang duplicate-copy hard gate untuk konten source-verified', () => {
  const layouts = images.buildSlideLayouts({ ...base, verificationStatus: 'source_based' });
  assert.equal(layouts.length, 4);
});

test('renderer tetap menjaga duplicate-copy gate untuk konten biasa', () => {
  assert.throws(
    () => images.buildSlideLayouts(base),
    /Tahap layout:.*mengulang kalimat atau ide/i
  );
});
