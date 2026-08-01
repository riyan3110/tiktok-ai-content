const BaseProvider = require('./BaseProvider');
class ViduProvider extends BaseProvider { requestPath(input = {}) { return input.mediaType === 'image' ? '/ent/v2/reference2image' : '/ent/v2/img2video'; } }
module.exports = ViduProvider;
