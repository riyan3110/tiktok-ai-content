const generation = require('./generation');
const defaultContent = require('./content');
const defaultSourceFetcher = require('./sourceFetcher');
const autoSourceDiscovery = require('./autoSourceDiscovery');
const autoSourceComposer = require('./autoSourceComposer');

let installed = false;
let originalGenerateAndSave = null;

function autoSourceRequested(args = {}) {
  return args.mode === 'manual'
    && args.useSources === true
    && (!Array.isArray(args.sourceUrls) || args.sourceUrls.filter(value => String(value || '').trim()).length === 0);
}

function contentWrapper(content = defaultContent) {
  return { ...content };
}

function install() {
  if (installed) return generation.generateAndSave;
  originalGenerateAndSave = generation.generateAndSave;
  generation.generateAndSave = async function generateAndSaveWithAutoSource(args = {}) {
    if (!autoSourceRequested(args)) return originalGenerateAndSave(args);

    const topic = String(args.requestedTopic || '').trim().replace(/\s+/g, ' ');
    if (!topic) return originalGenerateAndSave(args);
    const sourceFetcher = args.sourceFetcher || defaultSourceFetcher;
    const discovery = await autoSourceDiscovery.discover({
      topic,
      category: args.category === 'Custom' ? args.customCategory : args.category,
      sourceFetcher
    });
    const sources = discovery.sources;
    const selectedUrls = sources.map(source => source.finalUrl || source.url).filter(Boolean);
    const wrappedContent = contentWrapper(args.content || defaultContent);
    const autoFetcher = {
      validateSourceUrls: () => selectedUrls,
      fetchSources: async () => sources,
      buildSourceContext: sourceFetcher.buildSourceContext || defaultSourceFetcher.buildSourceContext
    };
    const autoRoleGuard = {
      repairManualSourceRoles: async ({ options, sources: activeSources }) => autoSourceComposer.compose({
        content: wrappedContent,
        previousTopics: (options?.recentContents || []).map(item => item?.topic).filter(Boolean),
        options,
        sources: activeSources,
        discovery
      })
    };

    return originalGenerateAndSave({
      ...args,
      content: wrappedContent,
      sourceFetcher: autoFetcher,
      manualSourceRoleGuard: autoRoleGuard,
      useSources: true,
      sourceUrls: selectedUrls
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

module.exports = { install, resetForTests, autoSourceRequested, contentWrapper };
