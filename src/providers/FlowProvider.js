const BaseProvider = require('./BaseProvider');
class FlowProvider extends BaseProvider { async execute() { throw Object.assign(new Error('Google Flow does not expose a supported public generation API. Configure an approved enterprise endpoint before use.'), { status: 501 }); } }
module.exports = FlowProvider;
