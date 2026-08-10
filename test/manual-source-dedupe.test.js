const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const {
  repairManualSourceDuplicates,
  manualCrossSlideDuplicateErrors
} = require('../src/services/manualSourceDedupe');

function claim(field, text, evidence, sourceId = 'source-1') {
  return { field, text, sourceId, evidence };
}

test('manual source menargetkan body slide lebih akhir saat canonical evidence sama', () => {
  const evidence = 'Anthropic menunda pengembangan Astra setelah agen menunjukkan perilaku yang sulit dikendalikan.';
  const content = {
    slides: [
      {
        section: 'ITEM 1', title: 'Astra Ditunda',
        body: 'Pengembangan Astra ditunda setelah agen sulit dikendalikan.', points: [],
        claims: [claim('slide:0:body', 'Pengembangan Astra ditunda setelah agen sulit dikendalikan.', evidence)]
      },
      {
        section: 'ITEM 2', title: 'Alasan Penundaan',
        body: 'Astra dihentikan sementara akibat perilaku agen yang sulit dikendalikan.', points: [],
        claims: [claim('slide:1:body', 'Astra dihentikan sementara akibat perilaku agen yang sulit dikendalikan.', evidence)]
      }
    ]
  };

  assert.deepEqual(manualCrossSlideDuplicateErrors(content), [
    'slide:1:body: pembahasan mengulang fakta slide sebelumnya.'
  ]);
});

test('manual source menargetkan point slide berikutnya saat canonical evidence sama', () => {
  const evidence = 'Astra diuji dalam eksperimen keamanan internal sebelum pengembangannya ditunda.';
  const content = {
    slides: [
      {
        section: 'ITEM 1', title: 'Eksperimen Internal', body: 'Astra diuji dalam eksperimen keamanan internal.', points: [],
        claims: [claim('slide:0:body', 'Astra diuji dalam eksperimen keamanan internal.', evidence)]
      },
      {
        section: 'ITEM 2', title: 'Detail Pengujian', body: 'Tim membahas konteks pengujiannya.',
        points: ['Eksperimen keamanan dilakukan internal'],
        claims: [claim('slide:1:point:0', 'Eksperimen keamanan dilakukan internal', evidence)]
      }
    ]
  };

  assert.deepEqual(manualCrossSlideDuplicateErrors(content), [
    'slide:1:point:0: pembahasan mengulang fakta slide sebelumnya.'
  ]);
});

test('entity sama dengan canonical evidence berbeda tidak dianggap duplicate', () => {
  const factA = 'Anthropic menunda pengembangan Astra setelah eksperimen keamanan internal.';
  const factB = 'Tim menambahkan evaluasi keamanan baru sebelum eksperimen Astra berikutnya.';
  const content = {
    slides: [
      {
        section: 'ITEM 1', title: 'Status Astra', body: 'Anthropic menunda pengembangan Astra.', points: [],
        claims: [claim('slide:0:body', 'Anthropic menunda pengembangan Astra.', factA)]
      },
      {
        section: 'ITEM 2', title: 'Evaluasi Berikutnya', body: 'Tim menambahkan evaluasi keamanan baru untuk Astra.', points: [],
        claims: [claim('slide:1:body', 'Tim menambahkan evaluasi keamanan baru untuk Astra.', factB)]
      }
    ]
  };

  assert.deepEqual(manualCrossSlideDuplicateErrors(content), []);
});

test('pembuka dan kesimpulan boleh merangkum fakta tanpa false positive', () => {
  const fact = 'Anthropic menunda pengembangan Astra setelah eksperimen keamanan internal.';
  const content = {
    slides: [
      {
        section: 'PEMBUKA', title: 'Apa yang Terjadi?', body: 'Pengembangan Astra sedang ditunda.', points: [],
        claims: [claim('slide:0:body', 'Pengembangan Astra sedang ditunda.', fact)]
      },
      {
        section: 'ITEM 1', title: 'Status Pengembangan', body: 'Anthropic menunda pengembangan Astra.', points: [],
        claims: [claim('slide:1:body', 'Anthropic menunda pengembangan Astra.', fact)]
      },
      {
        section: 'KESIMPULAN', title: 'Intinya', body: 'Astra masih dalam status penundaan.', points: [],
        claims: [claim('slide:2:body', 'Astra masih dalam status penundaan.', fact)]
      }
    ]
  };

  assert.deepEqual(manualCrossSlideDuplicateErrors(content), []);
});

test('manual duplicate menjalani targeted recovery memakai fakta lain dan semantic audit', async () => {
  const factA = 'Anthropic menunda pengembangan Astra setelah agen menunjukkan perilaku yang sulit dikendalikan.';
  const factB = 'Tim menambahkan evaluasi keamanan baru sebelum eksperimen Astra berikutnya dilanjutkan.';
  const firstBody = 'Pengembangan Astra ditunda setelah agen sulit dikendalikan.';
  const duplicateBody = 'Astra dihentikan sementara akibat perilaku agen yang sulit dikendalikan.';
  const replacementBody = 'Tim menambahkan evaluasi keamanan baru sebelum eksperimen Astra berikutnya dilanjutkan.';
  const generated = {
    focus: { masalah: 'Status Astra', penyebab: 'Eksperimen internal', solusi: 'Evaluasi sumber', hasil: 'Konteks lebih jelas' },
    topic: 'Astra', hook: 'Astra Ditunda', body: firstBody, caption: firstBody, hashtags: [], cta: 'Ringkasan Astra',
    trendKeywordsUsed: [], content_angle: 'status Astra', primary_tool: 'Astra', hook_pattern: 'langsung',
    slides: [
      {
        section: 'ITEM 1', title: 'Astra Ditunda', body: firstBody, points: [],
        claims: [claim('slide:0:body', firstBody, factA)]
      },
      {
        section: 'ITEM 2', title: 'Alasan Penundaan', body: duplicateBody, points: [],
        claims: [claim('slide:1:body', duplicateBody, factA)]
      }
    ]
  };

  let recoveryCalls = 0;
  let auditCalls = 0;
  const client = { chat: { completions: { async create({ messages }) {
    const prompt = messages[1].content;
    if (/auditor entailment fakta bilingual/i.test(prompt)) {
      auditCalls += 1;
      return { choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }] };
    }
    recoveryCalls += 1;
    assert.match(prompt, /sourceId \+ evidence canonical/);
    assert.match(prompt, /belum dipakai/);
    return { choices: [{ message: { content: JSON.stringify({ slides: [
      {
        section: 'ITEM 1', title: 'JANGAN UBAH', body: 'JANGAN UBAH', points: [], claims: []
      },
      {
        section: 'ITEM 2', title: 'JANGAN UBAH', body: replacementBody, points: [],
        claims: [claim('slide:1:body', replacementBody, factB)]
      }
    ] }) } }] };
  } } } };

  const result = await repairManualSourceDuplicates({
    contentService: { validateContent() { return []; } },
    generated,
    options: { topicSource: 'manual', useSources: true, requestedTopic: 'Astra', contentFormat: 'Listicle' },
    sources: [{ url: 'https://example.test/astra', text: `${factA} ${factB}` }],
    client
  });

  assert.equal(recoveryCalls, 1);
  assert.equal(auditCalls, 1);
  assert.equal(result.slides[0].title, generated.slides[0].title, 'field non-target tetap terkunci');
  assert.equal(result.slides[0].body, firstBody, 'body slide sebelumnya tidak berubah');
  assert.equal(result.slides[1].title, generated.slides[1].title, 'title target slide tetap terkunci');
  assert.equal(result.slides[1].body, replacementBody);
  assert.equal(result.slides[1].claims.find(item => item.field === 'slide:1:body').evidence, factB);
  assert.deepEqual(manualCrossSlideDuplicateErrors(result), []);
});
