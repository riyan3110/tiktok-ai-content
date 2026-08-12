const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');
const dynamicScope = require('./autoSourceDynamicScope');
const topicPlanner = require('./autoSourceDynamicTopicPlan');
const versioned = require('./autoSourceTopicLockedComposer');
const multiEntity = require('./autoSourceMultiEntityComposer');
const research = require('./autoSourceResearchComposer');

// TANPA URL / AUTO SOURCE ONLY.
// Every request is scoped from the fresh runtime topic plan produced during
// discovery. Specialized version/multi-entity composers are extra safeguards;
// they are not a catalog of supported topics.
async function compose(args = {}) {
  const topic = String(args?.options?.requestedTopic || args?.discovery?.topic || '').trim();
  const plan = args?.discovery?.topicPlan || topicPlanner.fallbackPlan(topic);
  const scopedSources = dynamicScope.scopeSources(topic, args.sources || [], plan);
  const usableSources = scopedSources.filter(source => String(source?.text || '').trim());
  if (!usableSources.length) {
    throw Object.assign(new Error('Auto Source menemukan artikel, tetapi tidak ada fakta yang tetap berada di konteks topik setelah dibaca.'), {
      status: 422,
      code: 'AUTO_SOURCE_DYNAMIC_FACT_SCOPE_EMPTY'
    });
  }
  const scopedArgs = {
    ...args,
    sources: usableSources,
    discovery: args.discovery ? { ...args.discovery, sources: usableSources, topicPlan: plan } : { topic, sources: usableSources, topicPlan: plan }
  };

  if (identity.hasSpecificIdentity(topic)) return versioned.compose(scopedArgs);
  if (multi.hasMultiEntityTopic(topic)) return multiEntity.compose(scopedArgs);
  return research.compose(scopedArgs);
}

module.exports = { compose };
