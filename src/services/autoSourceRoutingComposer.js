const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');
const topicScope = require('./autoSourceTopicScope');
const versioned = require('./autoSourceTopicLockedComposer');
const multiEntity = require('./autoSourceMultiEntityComposer');
const research = require('./autoSourceResearchComposer');

// TANPA URL / AUTO SOURCE ONLY.
// Every topic type first receives source text narrowed to the requested scope.
// Specialized composers add stricter rules, but generic topics are no longer
// allowed to see unrelated side notes from otherwise relevant articles.
async function compose(args = {}) {
  const topic = String(args?.options?.requestedTopic || args?.discovery?.topic || '').trim();
  const scopedSources = topicScope.scopeSources(topic, args.sources || []);
  const scopedArgs = {
    ...args,
    sources: scopedSources,
    discovery: args.discovery ? { ...args.discovery, sources: scopedSources } : args.discovery
  };

  if (identity.hasSpecificIdentity(topic)) return versioned.compose(scopedArgs);
  if (multi.hasMultiEntityTopic(topic)) return multiEntity.compose(scopedArgs);
  return research.compose(scopedArgs);
}

module.exports = { compose };
