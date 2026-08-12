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
  // Loaded only AFTER explicit Pakai URL has been excluded.
  // Production Auto Source intentionally does NOT install the old strict,
  // coherence, density, plan-first, or runtime-guard stack anymore.
  return {
    defaultContent: require('./content'),
    defaultSourceFetcher: require('./sourceFetcher'),
    autoSourceDiscovery: require('./autoSourceExpandedDiscovery'),
    autoSourceResearchComposer: require('./autoSourceResearchComposer'),
    autoSourceVisualFit: require('./autoSourceVisualFit')
  };
}

function contentWrapper(content) {
  const base = content || require('./content');
  // Keep Auto Source isolated from generation.js's explicit Pakai URL final gate.
  return { ...base };
}

function install() {
  if (installed) return generation.generateAndSave;
  originalGenerateAndSave = generation.generateAndSave;
  generation.generateAndSave = async function generateAndSaveWithAutoSource(args = {}) {
    // HARD ISOLATION LOCK:
    // Pakai URL is exact pass-through before any Auto Source dependency loads.
    if (pakaiUrlRequested(args)) return originalGenerateAndSave(args);
    if (!autoSourceRequested(args)) return originalGenerateAndSave(args);

    const topic = String(args.requestedTopic || '').trim().replace(/\s+/g, ' ');
    if (!topic) return originalGenerateAndSave(args);

    const {
      defaultContent,
      defaultSourceFetcher,
      autoSourceDiscovery,
      autoSourceResearchComposer,
      autoSourceVisualFit
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
        const generated = await autoSourceResearchComposer.compose({
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
  contentWrapper,
  loadAutoSourceDependencies
};
