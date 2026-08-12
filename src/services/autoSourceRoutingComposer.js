const identity = require('./autoSourceTopicIdentity');
const multi = require('./autoSourceMultiEntityTopic');
const versioned = require('./autoSourceTopicLockedComposer');
const multiEntity = require('./autoSourceMultiEntityComposer');
const research = require('./autoSourceResearchComposer');

// TANPA URL / AUTO SOURCE ONLY.
// Route narrow topic types to their dedicated guards while keeping generic
// topics on the normal research composer.
async function compose(args = {}) {
  const topic = String(args?.options?.requestedTopic || args?.discovery?.topic || '').trim();
  if (identity.hasSpecificIdentity(topic)) return versioned.compose(args);
  if (multi.hasMultiEntityTopic(topic)) return multiEntity.compose(args);
  return research.compose(args);
}

module.exports = { compose };
