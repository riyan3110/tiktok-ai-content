const test = require('node:test');
const assert = require('node:assert/strict');

const { manualCrossSlideDuplicateErrors } = require('../src/services/manualSourceDedupe');

function claim(field, text, evidence) {
  return { field, text, sourceId: 'source-1', evidence };
}

test('canonical evidence yang sama boleh mendukung dua fakta berbeda jika isi substantif berbeda', () => {
  const evidence = 'Astra diuji dalam eksperimen keamanan internal sebelum Anthropic memutuskan menunda pengembangannya.';
  const first = 'Astra diuji lewat eksperimen keamanan internal.';
  const second = 'Anthropic kemudian menunda pengembangan Astra.';
  const content = {
    slides: [
      {
        section: 'ITEM 1', title: 'Pengujian Internal', body: first, points: [],
        claims: [claim('slide:0:body', first, evidence)]
      },
      {
        section: 'ITEM 2', title: 'Status Pengembangan', body: second, points: [],
        claims: [claim('slide:1:body', second, evidence)]
      }
    ]
  };

  assert.deepEqual(manualCrossSlideDuplicateErrors(content), []);
});
