const { ContentStudioService } = require('./contentStudio');

const PATCHED = Symbol.for('aiads.vpsStorageUi');

function install() {
  const prototype = ContentStudioService.prototype;
  if (prototype[PATCHED]) return;
  const originalSerialize = prototype.serialize;
  const originalProgress = prototype.progress;

  prototype.serialize = function serializeVpsStorage(...args) {
    const item = originalSerialize.apply(this, args);
    if (item?.provider_stage === 'Uploading to COS') item.provider_stage = 'Saving to VPS';
    return item;
  };

  prototype.progress = function progressVpsStorage(status) {
    if (status === 'Uploading to COS' || status === 'Saving to VPS') return 90;
    return originalProgress.call(this, status);
  };

  Object.defineProperty(prototype, PATCHED, { value: true });
}

module.exports = { install };
