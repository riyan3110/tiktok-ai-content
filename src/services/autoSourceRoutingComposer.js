const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');
const dynamicScope = require('./autoSourceDynamicScope');
const topicPlanner = require('./autoSourceDynamicTopicPlan');
const storyFocus = require('./autoSourceStoryFocus');
const versioned = require('./autoSourceTopicLockedComposer');
const multiEntity = require('./autoSourceMultiEntityComposer');
const research = require('./autoSourceResearchComposer');

// TANPA URL / AUTO SOURCE ONLY.
// Every request is scoped from the fresh runtime topic plan produced during
// discovery. Before writing, the scoped article text is reduced to atomic,
// substantive story facts so editorial side-notes cannot steal a slide.

function normalizeFactSections(result, format = '') {
  if (String(format || '').toLocaleLowerCase('id-ID') !== 'fakta singkat') return result;
  if (!Array.isArray(result?.slides) || !result.slides[3]) return result;
  if (String(result.slides[3].section || '').trim().toLocaleUpperCase('id-ID') !== 'KESIMPULAN') return result;
  return {
    ...result,
    slides: result.slides.map((slide, index) => index === 3 ? { ...slide, section: 'FAKTA LANJUTAN' } : slide)
  };
}

async function compose(args = {}) {
  const topic = String(args?.options?.requestedTopic || args?.discovery?.topic || '').trim();
  const plan = args?.discovery?.topicPlan || topicPlanner.fallbackPlan(topic);
  const scopedSources = dynamicScope.scopeSources(topic, args.sources || [], plan);
  const focusedSources = storyFocus.focusSources(topic, scopedSources, plan);
  const usableSources = focusedSources.filter(source => String(source?.text || '').trim());
  if (!usableSources.length) {
    throw Object.assign(new Error('Auto Source menemukan artikel, tetapi tidak ada fakta berita yang tetap berada di konteks topik setelah dibaca.'), {
      status: 422,
      code: 'AUTO_SOURCE_STORY_FACTS_EMPTY'
    });
  }
  const scopedArgs = {
    ...args,
    sources: usableSources,
    discovery: args.discovery ? { ...args.discovery, sources: usableSources, topicPlan: plan } : { topic, sources: usableSources, topicPlan: plan }
  };

  let result;
  if (identity.hasSpecificIdentity(topic)) result = await versioned.compose(scopedArgs);
  else if (multi.hasMultiEntityTopic(topic)) result = await multiEntity.compose(scopedArgs);
  else result = await research.compose(scopedArgs);

  return normalizeFactSections(result, args?.options?.contentFormat || 'Fakta singkat');
}

module.exports = { compose, normalizeFactSections };
