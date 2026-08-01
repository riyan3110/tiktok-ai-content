const BaseProvider = require('./BaseProvider');
const FlowProvider = require('./FlowProvider'); const VeoProvider = require('./VeoProvider'); const ImagenProvider = require('./ImagenProvider'); const GeminiProvider = require('./GeminiProvider'); const OpenAIProvider = require('./OpenAIProvider'); const ViduProvider = require('./ViduProvider'); const OmniProvider = require('./OmniProvider');
const DEFINITIONS = Object.freeze({ 'google-flow': [FlowProvider, 'https://flow.googleapis.com', 'flow'], 'google-veo': [VeoProvider, 'https://generativelanguage.googleapis.com', 'veo-3.0-generate-preview'], 'google-imagen': [ImagenProvider, 'https://generativelanguage.googleapis.com', 'imagen-4.0-generate-001'], 'google-gemini': [GeminiProvider, 'https://generativelanguage.googleapis.com', 'gemini-2.5-flash-image'], 'openai-images': [OpenAIProvider, 'https://api.openai.com', 'gpt-image-1'], vidu: [ViduProvider, 'https://api.vidu.com', 'vidu2.0'], omni: [OmniProvider, 'https://api.example.com', 'omni'] });
class ProviderFactory {
  static names() { return Object.keys(DEFINITIONS); }
  static defaults(name) { const item = DEFINITIONS[name]; if (!item) throw new Error(`Unknown provider: ${name}`); return { baseUrl: item[1], model: item[2] }; }
  static create(config, transport) { const Adapter = DEFINITIONS[config.provider]?.[0]; if (!Adapter) throw Object.assign(new Error(`Provider ID tidak valid: ${config.provider}`), { status: 422 }); return new Adapter(config, transport); }
}
module.exports = { ProviderFactory, DEFINITIONS, BaseProvider };
