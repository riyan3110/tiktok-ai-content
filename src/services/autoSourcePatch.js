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

function loadAutoSourceDependencies() {
  return {
    defaultContent: require('./content'),
    defaultSourceFetcher: require('./sourceFetcher'),
    autoSourceDiscovery: require('./autoSourceFastDiscovery'),
    autoSourceComposer: require('./autoSourceComposer'),
    autoSourceStrictFinalizer: require('./autoSourceStrictFinalizer')
  };
}

function contentWrapper(content) {
  const base = content || require('./content');
  return { ...base };
}

function install() {
  if (installed) return generation.generateAndSave;
  originalGenerateAndSave = generation.generateAndSave;
  generation.generateAndSave = async function generateAndSaveWithAutoSource(args = {}) {
    // HARD ISOLATION LOCK:
    // Pakai URL stays on the exact pre-Auto-Source generation path from PR #155.
    // Do not load Auto Source discovery/composer modules or rewrite any request args here.
    if (pakaiUrlRequested(args)) return originalGenerateAndSave(args);
    if (!autoSourceRequested(args)) return originalGenerateAndSave(args);

    const topic = String(args.requestedTopic || '').trim().replace(/\s+/g, ' ');
    if (!topic) return originalGenerateAndSave(args);

    const {
      defaultContent,
      defaultSourceFetcher,
      autoSourceDiscovery,
      autoSourceComposer,
      autoSourceStrictFinalizer
    } = loadAutoSourceDependencies();
    const sourceFetcher = args.sourceFetcher || defaultSourceFetcher;
    const discovery = await autoSourceDiscovery.discover({
      topic,
      category: args.category === 'Custom' ? args.customCategory : args.category,
      sourceFetcher
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
        // AUTO SOURCE ONLY: every source selected by discovery remains active.
        // Do not silently degrade multi-source synthesis to one source after a
        // validation failure; the strict finalizer must repair the same bundle.
        return autoSourceComposer.compose({
          content: wrappedContent,
          previousTopics: (options?.recentContents || []).map(item => item?.topic).filter(Boolean),
          options: { ...options, fastAutoSource: true },
          sources: activeSources,
          discovery: { ...discovery, sources: activeSources },
          finalizer: autoSourceStrictFinalizer
        });
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
  contentWrapper
};