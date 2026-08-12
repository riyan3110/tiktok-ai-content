const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AI_PROVIDER ||= 'openai';
process.env.AI_API_KEY ||= 'test-key';
process.env.AI_BASE_URL ||= 'https://example.test/v1';
process.env.AI_MODEL ||= 'test-model';

const planner = require('../src/services/autoSourceDynamicTopicPlan');
const scope = require('../src/services/autoSourceDynamicScope');
const storyFocus = require('../src/services/autoSourceStoryFocus');
const expanded = require('../src/services/autoSourceExpandedDiscovery');
const scoped = require('../src/services/autoSourceScopedDiscovery');

function fakePlannerClient(payload) {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] })
      }
    }
  };
}

test('fallback plan derives action and distinguishing context from a free-form event topic', () => {
  const plan = planner.fallbackPlan('OpenAI sedang menguji fitur batasan penggunaan');
  assert.ok(plan.subjects.some(subject => /OpenAI/i.test(subject)));
  assert.ok(plan.actionTerms.some(term => /menguji/i.test(term)));
  assert.ok(plan.contextTerms.some(term => /batasan/i.test(term)));
  assert.equal(plan.relation, 'event');
});

test('same-subject news is rejected unless it matches both requested action and context', () => {
  const topic = 'OpenAI sedang menguji fitur batasan penggunaan';
  const plan = planner.fallbackPlan(topic);

  const wanted = {
    title: 'OpenAI menguji fitur baru untuk batasan penggunaan ChatGPT',
    text: 'OpenAI sedang menguji opsi baru saat pengguna mencapai batasan penggunaan. Pengguna dapat memperoleh akses tambahan tanpa menunggu kuota normal.',
    url: 'https://wanted.test/story'
  };
  const evmbench = {
    title: 'OpenAI luncurkan EVMbench untuk uji keamanan kontrak pintar',
    text: 'OpenAI menguji kemampuan AI menjaga keamanan kontrak pintar dan penggunaan agen coding.',
    url: 'https://evm.test/story'
  };
  const pentagon = {
    title: 'Kesepakatan OpenAI dengan Pentagon jelaskan batasan penggunaan AI',
    text: 'OpenAI menyatakan kesepakatan dengan Pentagon menetapkan batasan penggunaan AI.',
    url: 'https://pentagon.test/story'
  };
  const childSafety = {
    title: 'OpenAI fokus lindungi pengguna di bawah 18 tahun',
    text: 'OpenAI memperluas perlindungan untuk pengguna remaja di ChatGPT.',
    url: 'https://safety.test/story'
  };

  assert.equal(scope.sourceInScope(topic, wanted, plan), true);
  assert.equal(scope.sourceInScope(topic, evmbench, plan), false);
  assert.equal(scope.sourceInScope(topic, pentagon, plan), false);
  assert.equal(scope.sourceInScope(topic, childSafety, plan), false);
});

test('AI-planned language alternatives allow the same event in an English article', () => {
  const topic = 'OpenAI sedang menguji fitur batasan penggunaan';
  const plan = {
    rawTopic: topic,
    canonicalTopic: topic,
    subjects: ['OpenAI'],
    eventTerms: ['testing usage limits', 'pay to reset quota'],
    actionTerms: ['menguji', 'testing', 'exploring'],
    contextTerms: ['batasan penggunaan', 'usage limits', 'quota'],
    marketIntent: false,
    relation: 'event',
    planner: 'ai'
  };
  const source = {
    title: 'OpenAI is quietly testing a pay-to-reset quota feature',
    text: 'OpenAI is testing a new option for some users who hit their usage limits. The option can reset a depleted weekly quota.',
    url: 'https://english.test/story'
  };

  assert.equal(scope.sourceInScope(topic, source, plan), true);
  assert.equal(scope.eventAlignedSource(plan, source), true);
});

test('event scoping keeps the story neighborhood instead of every article about the same company', () => {
  const topic = 'OpenAI sedang menguji fitur batasan penggunaan';
  const plan = {
    rawTopic: topic,
    canonicalTopic: topic,
    subjects: ['OpenAI'],
    eventTerms: ['testing usage limits'],
    actionTerms: ['testing'],
    contextTerms: ['usage limits', 'quota'],
    marketIntent: false,
    relation: 'event',
    planner: 'ai'
  };
  const source = {
    title: 'OpenAI is testing a pay-to-reset quota feature',
    text: [
      'OpenAI is testing an option for users who hit usage limits.',
      'Some Plus users saw an option to pay for an immediate quota reset.',
      'The reset restores depleted weekly usage.',
      'Users can still wait for the normal quota reset instead.',
      'OpenAI separately announced protections for users under 18.',
      'OpenAI also discussed a Pentagon agreement in another policy update.'
    ].join(' '),
    url: 'https://event.test/story'
  };

  const narrowed = scope.scopeSource(topic, source, plan);
  assert.match(narrowed.text, /quota reset/i);
  assert.doesNotMatch(narrowed.text, /under 18|Pentagon/i);
});

test('publisher legal disclaimer is never promoted into a news slide unless explicitly requested', () => {
  const plan = {
    rawTopic: 'OpenAI sedang menguji fitur batasan penggunaan',
    canonicalTopic: 'OpenAI sedang menguji fitur batasan penggunaan',
    marketIntent: false
  };
  assert.equal(
    storyFocus.editorialNoise('KOMPAS.com tidak bertanggung jawab atas kerugian langsung atau tidak langsung dari penggunaan fitur.', plan),
    true
  );
});

test('event lock is generic and works for a never-before-seen subject', () => {
  const topic = 'NovaForge sedang menguji batasan energi FluxCore';
  const plan = planner.fallbackPlan(topic);
  const wanted = {
    title: 'NovaForge menguji batasan energi FluxCore',
    text: 'NovaForge menguji batasan energi FluxCore dalam uji coba baru.',
    url: 'https://nova.test/wanted'
  };
  const unrelated = {
    title: 'NovaForge memperluas kantor riset FluxCore',
    text: 'NovaForge memperluas tim yang mengembangkan FluxCore untuk pelanggan baru.',
    url: 'https://nova.test/unrelated'
  };
  assert.equal(scope.sourceInScope(topic, wanted, plan), true);
  assert.equal(scope.sourceInScope(topic, unrelated, plan), false);
});

test('scoped discovery reinterprets fetched results then keeps only the requested event', async () => {
  const original = expanded.discover;
  let searchCalls = 0;
  expanded.discover = async ({ topic }) => {
    searchCalls += 1;
    return {
      topic,
      queries: [topic],
      providers: ['test'],
      publishers: ['english.test', 'evm.test', 'pentagon.test', 'safety.test'],
      sources: [
        {
          title: 'OpenAI is quietly testing a pay-to-reset quota feature',
          text: 'OpenAI is testing a new option for users who hit usage limits. The option can reset a weekly quota.',
          url: 'https://english.test/story',
          finalUrl: 'https://english.test/story',
          discovery: { publisher: 'english.test' }
        },
        {
          title: 'OpenAI launches EVMbench for smart-contract security',
          text: 'OpenAI is testing AI agents on smart-contract security tasks.',
          url: 'https://evm.test/story',
          finalUrl: 'https://evm.test/story',
          discovery: { publisher: 'evm.test' }
        },
        {
          title: 'OpenAI Pentagon agreement sets boundaries on AI use',
          text: 'OpenAI says its Pentagon agreement contains limits on AI use.',
          url: 'https://pentagon.test/story',
          finalUrl: 'https://pentagon.test/story',
          discovery: { publisher: 'pentagon.test' }
        },
        {
          title: 'OpenAI expands protections for users under 18',
          text: 'OpenAI introduced additional safeguards for younger ChatGPT users.',
          url: 'https://safety.test/story',
          finalUrl: 'https://safety.test/story',
          discovery: { publisher: 'safety.test' }
        }
      ]
    };
  };

  try {
    const topic = 'OpenAI sedang menguji fitur batasan penggunaan';
    const result = await scoped.discover({
      topic,
      topicPlannerClient: fakePlannerClient({
        canonicalTopic: topic,
        subjects: ['OpenAI'],
        eventTerms: ['testing usage limits', 'pay-to-reset quota'],
        actionTerms: ['testing', 'exploring'],
        contextTerms: ['usage limits', 'quota'],
        searchQueries: [topic, 'OpenAI testing usage limits quota'],
        marketIntent: false,
        relation: 'event'
      })
    });

    assert.equal(searchCalls, 1, 'the already fetched result set should be reused after dynamic reinterpretation');
    assert.equal(result.sources.length, 1);
    assert.match(result.sources[0].url, /english\.test/);
    assert.equal(result.topicPlan.planner, 'ai');
  } finally {
    expanded.discover = original;
  }
});
