const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.com/v1';
process.env.AI_MODEL ||= 'test-model';

const { auditClaimSemantics } = require('../src/services/sourceFilter');

const cases = [
  {
    name: 'entity type drift ditolak',
    evidence: 'Claude Code is a coding tool...',
    candidate: 'Claude Code adalah model bahasa Anthropic.',
    reason: 'Entity type berubah dari coding tool menjadi model.'
  },
  {
    name: 'package scope drift ditolak',
    evidence: 'Available for Max, Team, Enterprise, and API users.',
    candidate: 'Tersedia untuk Pro, Max, dan Team.',
    reason: 'Daftar paket berubah dan menghilangkan cakupan.'
  },
  {
    name: 'modalitas yang terlalu kuat ditolak',
    evidence: 'Auto mode can block risky actions.',
    candidate: 'Auto mode mencegah tindakan berbahaya.',
    reason: 'Can diubah menjadi klaim pencegahan tanpa modalitas.'
  },
  {
    name: 'explicit exclusion harus dipertahankan',
    evidence: 'Auto mode is not available on Pro.',
    candidate: 'Auto mode tersedia pada Pro.',
    reason: 'Negasi ketidaktersediaan dibalik.'
  },
  {
    name: 'tanggal dan preview harus dipertahankan',
    evidence: 'Introduced as a research preview in March 2026.',
    candidate: 'Uji coba dimulai pada April 2026.',
    reason: 'Bulan berubah dari Maret menjadi April.'
  },
  {
    name: 'paraphrase modal yang setia tetap lolos',
    evidence: 'Auto mode can block risky actions.',
    candidate: 'Auto mode dapat memblokir tindakan yang dinilai berisiko.',
    reason: null
  }
];

for (const scenario of cases) {
  test(scenario.name, async () => {
    let auditPrompt = '';
    const client = { chat: { completions: { async create({ messages }) {
      auditPrompt = messages[1].content;
      const unsupported = scenario.reason
        ? [{ field: 'slide:0:body', reason: scenario.reason }]
        : [];
      return { choices: [{ message: { content: JSON.stringify({ unsupported }) } }] };
    } } } };
    const content = { slides: [{
      section: 'FAKTA UTAMA',
      title: 'Fakta sumber',
      body: scenario.candidate,
      points: [],
      claims: [{ field: 'slide:0:body', text: scenario.candidate, sourceId: 'source-1', evidence: scenario.evidence }]
    }] };

    const errors = await auditClaimSemantics(client, content, 'Claude Code Auto Mode');

    assert.match(auditPrompt, /ENTITY TYPE berubah/);
    assert.match(auditPrompt, /NAMED LIST atau SCOPE berubah/);
    assert.match(auditPrompt, /MODALITY lebih kuat/);
    assert.match(auditPrompt, /NEGATION atau EXCLUSION/);
    assert.match(auditPrompt, /TEMPORAL FACT bergeser/);
    assert.match(auditPrompt, new RegExp(scenario.evidence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    if (scenario.reason) {
      assert.equal(errors.length, 1);
      assert.match(errors[0], /^SEMANTIC_SUPPORT: slide:0:body/);
    } else {
      assert.deepEqual(errors, []);
    }
  });
}
