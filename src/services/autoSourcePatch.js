const generation = require('./generation');
const defaultContent = require('./content');
const defaultSourceFetcher = require('./sourceFetcher');
const autoSourceDiscovery = require('./autoSourceDiscovery');
const autoSourceComposer = require('./autoSourceComposer');

let installed = false;
let originalGenerateAndSave = null;

function autoSourceRequested(args = {}) {
  return args.mode === 'manual'
    && args.useSources !== true
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
    const wrappedContent = contentWrapper(args.content || defaultContent);
    const currentUrls = () => sources.map(source => source.finalUrl || source.url).filter(Boolean);
    const autoFetcher = {
      validateSourceUrls: () => currentUrls(),
      fetchSources: async () => sources,
      buildSourceContext: sourceFetcher.buildSourceContext || defaultSourceFetcher.buildSourceContext
    };
    const autoRoleGuard = {
      repairManualSourceRoles: async ({ options, sources: activeSources }) => {
        let lastError = null;
        for (let count = activeSources.length; count >= 1; count -= 1) {
          const workingSources = activeSources.slice(0, count);
          try {
            const result = await autoSourceComposer.compose({
              content: wrappedContent,
              previousTopics: (options?.recentContents || []).map(item => item?.topic).filter(Boolean),
              options,
              sources: workingSources,
              discovery: { ...discovery, sources: workingSources }
            });
            if (activeSources.length !== workingSources.length) activeSources.splice(0, activeSources.length, ...workingSources);
            return result;
          } catch (error) {
            lastError = error;
            if (count > 1) console.warn(`[AutoSource] compose ${count} sumber gagal; mencoba ${count - 1} sumber terkuat:`, error.message);
          }
        }
        throw lastError || Object.assign(new Error('Auto Source tidak dapat membentuk konten valid.'), { status: 422 });
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

module.exports = { install, resetForTests, autoSourceRequested, contentWrapper };
