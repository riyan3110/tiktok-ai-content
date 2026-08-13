const generation = require('./generation');

let installed = false;
let originalGenerateAndSave = null;

function suppliedSourceUrls(args = {}) {
  return Array.isArray(args.sourceUrls)
    ? args.sourceUrls.map(value => String(value || '').trim()).filter(Boolean)
    : [];
}

function pakaiUrlRequested(args = {}) {
  return args.useSources === true || suppliedSourceUrls(args).length > 0;
}

function autoSourceRequested(args = {}) {
  return args.mode === 'manual'
    && !pakaiUrlRequested(args);
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return clean(value).toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniq(values = [], limit = 10) {
  const out = [];
  const seen = new Set();
  for (const raw of values) {
    const value = clean(raw);
    const key = normalized(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

function recoverableDiscoveryError(error) {
  if (!error) return false;
  return Number(error.status) === 422 || /^AUTO_SOURCE_/i.test(String(error.code || ''));
}

function makeCurrentTopicRecoveryPlan(topic = '', plan = {}, planner = null) {
  const rawTopic = clean(topic);
  const canonicalTopic = clean(plan.canonicalTopic || rawTopic);
  const subjects = uniq(plan.subjects || [], 4);
  const actions = new Set((plan.actionTerms || []).map(normalized).filter(Boolean));
  const contexts = uniq(plan.contextTerms || [], 8);
  const eventDetails = uniq((plan.eventTerms || []).filter(term => {
    const key = normalized(term);
    if (!key || actions.has(key)) return false;
    const words = key.split(' ').filter(Boolean);
    return words.length > 1 || !(planner?.verbLike?.(term));
  }), 8);

  // Generic recovery for runtime topics: if current reporting describes the
  // same subject/object with a different verb, do not reject that current article
  // only because the event verb is phrased differently. Concrete context remains.
  const distinguishing = contexts.length ? contexts : eventDetails;
  const recoveryEvents = distinguishing.length ? distinguishing : uniq(plan.eventTerms || [], 8);
  const subjectText = subjects.join(' ');
  const detailText = distinguishing.slice(0, 3).join(' ');
  const searchQueries = uniq([
    ...(plan.searchQueries || []),
    canonicalTopic,
    `${canonicalTopic} latest news`,
    `${canonicalTopic} terbaru`,
    subjectText && detailText ? `${subjectText} ${detailText} latest news` : '',
    subjectText && detailText ? `${subjectText} ${detailText} terbaru` : '',
    subjectText ? `${subjectText} latest update` : '',
    rawTopic
  ], 10);

  return {
    ...plan,
    rawTopic,
    canonicalTopic,
    subjects,
    actionTerms: [],
    contextTerms: distinguishing,
    eventTerms: recoveryEvents,
    searchQueries,
    relation: ['multi', 'comparison'].includes(plan.relation) ? plan.relation : 'single',
    planner: 'ai'
  };
}

function makeFactExpansionPlan(topic = '', plan = {}, planner = null) {
  const base = makeCurrentTopicRecoveryPlan(topic, plan, planner);
  const subjectText = (base.subjects || []).join(' ');
  const detailText = (base.contextTerms || []).slice(0, 3).join(' ');
  return {
    ...base,
    searchQueries: uniq([
      ...(base.searchQueries || []),
      `${base.canonicalTopic} details`,
      `${base.canonicalTopic} key facts`,
      `${base.canonicalTopic} official announcement`,
      `${base.canonicalTopic} how it works`,
      subjectText && detailText ? `${subjectText} ${detailText} details` : '',
      subjectText && detailText ? `${subjectText} ${detailText} official` : ''
    ], 16),
    evidenceIntent: 'distinct-facts'
  };
}

function sourceKey(source = {}) {
  return clean(source.finalUrl || source.url).replace(/#.*$/, '').replace(/\/$/, '').toLocaleLowerCase('en-US');
}

function mergeSources(...groups) {
  const out = [];
  const seen = new Set();
  for (const source of groups.flat().filter(Boolean)) {
    const key = sourceKey(source);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function loadAutoSourceDependencies() {
  // Loaded only AFTER explicit Pakai URL has been excluded.
  return {
    defaultContent: require('./content'),
    defaultSourceFetcher: require('./sourceFetcher'),
    autoSourceDiscovery: require('./autoSourceScopedDiscovery'),
    expandedDiscovery: require('./autoSourceExpandedDiscovery'),
    topicPlanner: require('./autoSourceDynamicTopicPlan'),
    autoSourceComposer: require('./autoSourceRoutingComposer'),
    autoSourceVisualFit: require('./autoSourceVisualFit')
  };
}

async function discoverCurrentSources({
  topic,
  category = '',
  sourceFetcher,
  autoSourceDiscovery,
  expandedDiscovery,
  topicPlanner,
  topicPlannerClient
} = {}) {
  let primaryError;
  try {
    return await autoSourceDiscovery.discover({
      topic,
      category,
      sourceFetcher,
      interpretTopic: true,
      topicPlannerClient
    });
  } catch (error) {
    if (!recoverableDiscoveryError(error)) throw error;
    primaryError = error;
  }

  const interpreted = await topicPlanner.createPlan(topic, { client: topicPlannerClient });
  const recoveryPlan = makeCurrentTopicRecoveryPlan(topic, interpreted, topicPlanner);

  try {
    const recovered = await expandedDiscovery.discover({
      topic,
      category,
      sourceFetcher,
      topicPlan: recoveryPlan
    });
    if (Array.isArray(recovered?.sources) && recovered.sources.length) {
      return {
        ...recovered,
        topic,
        topicPlan: recoveryPlan,
        scopeMode: 'current-topic-recovery',
        recoveryFrom: primaryError?.code || 'AUTO_SOURCE_PRIMARY_DISCOVERY'
      };
    }
  } catch (error) {
    if (!recoverableDiscoveryError(error)) throw error;
  }

  throw primaryError;
}

async function ensureDistinctEvidence({
  topic,
  category = '',
  discovery,
  sourceFetcher,
  expandedDiscovery,
  topicPlanner,
  topicPlannerClient,
  autoSourceComposer
} = {}) {
  const initialSources = Array.isArray(discovery?.sources) ? discovery.sources : [];
  let interpreted = discovery?.topicPlan;
  if (!interpreted) interpreted = await topicPlanner.createPlan(topic, { client: topicPlannerClient });

  const initialPrepared = autoSourceComposer.prepareSources(topic, initialSources, interpreted);
  const initialCount = autoSourceComposer.distinctFactCount(topic, initialPrepared);
  if (initialCount >= autoSourceComposer.REQUIRED_DISTINCT_FACTS) return discovery;

  // Do not manufacture slide 4 by repeating slide 1/2. Search for additional
  // current evidence before the writer starts, then combine only discovery-approved
  // sources and let the routing composer prefer full articles over snippets.
  const expansionPlan = makeFactExpansionPlan(topic, interpreted, topicPlanner);
  let expanded;
  try {
    expanded = await expandedDiscovery.discover({
      topic,
      category,
      sourceFetcher,
      topicPlan: expansionPlan
    });
  } catch (error) {
    if (!recoverableDiscoveryError(error)) throw error;
    return discovery;
  }

  const combinedSources = mergeSources(initialSources, expanded?.sources || []);
  const combinedDiscovery = {
    ...discovery,
    ...expanded,
    topic,
    sources: combinedSources,
    topicPlan: expansionPlan,
    scopeMode: 'distinct-fact-recovery',
    recoveryFrom: discovery?.scopeMode || 'AUTO_SOURCE_DISTINCT_FACTS'
  };
  return combinedDiscovery;
}

function contentWrapper(content) {
  const base = content || require('./content');
  return { ...base };
}

function install() {
  if (installed) return generation.generateAndSave;
  originalGenerateAndSave = generation.generateAndSave;
  generation.generateAndSave = async function generateAndSaveWithAutoSource(args = {}) {
    // HARD ISOLATION LOCK: Pakai URL stays exact pass-through before Auto Source loads.
    if (pakaiUrlRequested(args)) return originalGenerateAndSave(args);
    if (!autoSourceRequested(args)) return originalGenerateAndSave(args);

    const topic = String(args.requestedTopic || '').trim().replace(/\s+/g, ' ');
    if (!topic) return originalGenerateAndSave(args);

    const {
      defaultContent,
      defaultSourceFetcher,
      autoSourceDiscovery,
      expandedDiscovery,
      topicPlanner,
      autoSourceComposer,
      autoSourceVisualFit
    } = loadAutoSourceDependencies();

    const sourceFetcher = args.sourceFetcher || defaultSourceFetcher;
    const category = args.category === 'Custom' ? args.customCategory : args.category;
    let discovery = await discoverCurrentSources({
      topic,
      category,
      sourceFetcher,
      autoSourceDiscovery,
      expandedDiscovery,
      topicPlanner,
      topicPlannerClient: args.topicPlannerClient
    });

    discovery = await ensureDistinctEvidence({
      topic,
      category,
      discovery,
      sourceFetcher,
      expandedDiscovery,
      topicPlanner,
      topicPlannerClient: args.topicPlannerClient,
      autoSourceComposer
    });

    const sources = discovery.sources;
    const wrappedContent = contentWrapper(args.content || defaultContent);
    const currentUrls = () => sources.map(source => source.finalUrl || source.url).filter(Boolean);
    const autoFetcher = {
      validateSourceUrls: () => currentUrls(),
      fetchSources: async () => sources,
      buildSourceContext: sourceFetcher.buildSourceContext || defaultSourceFetcher.buildSourceContext
    };

    const autoRoleGuard = {
      repairManualSourceRoles: async ({ options, sources: activeSources }) => {
        const generated = await autoSourceComposer.compose({
          options,
          sources: activeSources,
          discovery: { ...discovery, sources: activeSources }
        });
        return autoSourceVisualFit.fitAutoSourceContent(generated);
      }
    };

    return originalGenerateAndSave({
      ...args,
      content: wrappedContent,
      sourceFetcher: autoFetcher,
      manualSourceRoleGuard: autoRoleGuard,
      useSources: true,
      sourceUrls: currentUrls()
    });
  };
  installed = true;
  return generation.generateAndSave;
}

function resetForTests() {
  if (installed && originalGenerateAndSave) generation.generateAndSave = originalGenerateAndSave;
  originalGenerateAndSave = null;
  installed = false;
}

module.exports = {
  install,
  resetForTests,
  suppliedSourceUrls,
  pakaiUrlRequested,
  autoSourceRequested,
  clean,
  normalized,
  uniq,
  recoverableDiscoveryError,
  makeCurrentTopicRecoveryPlan,
  makeFactExpansionPlan,
  sourceKey,
  mergeSources,
  discoverCurrentSources,
  ensureDistinctEvidence,
  contentWrapper,
  loadAutoSourceDependencies
};