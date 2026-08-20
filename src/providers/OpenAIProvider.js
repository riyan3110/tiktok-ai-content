const BaseProvider = require('./BaseProvider');
class OpenAIProvider extends BaseProvider { requestPath() { return '/v1/images/generations'; } buildRequest(input) { return { model: input.model || this.config.default_model, prompt: input.prompt, size: input.parameters?.resolution || '1024x1024', n: 1 }; } parse(data) { return { ...super.parse({ ...data, images: data.data }), status: 'completed' }; } }
module.exports = OpenAIProvider;
