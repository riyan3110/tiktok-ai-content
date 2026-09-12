const { AsyncLocalStorage } = require('node:async_hooks');
const dynamicAi = require('./dynamicAiProviders');
const context = new AsyncLocalStorage();
let background;

function bind(db, transport) { background = { db, transport }; }
function client() {
  const binding = context.getStore() || background;
  if (!binding) throw Object.assign(new Error('Default Text AI belum tersedia.'), { status: 409 });
  const base = dynamicAi.createTextClient(binding.db, binding.transport);
  const create = base.chat.completions.create;
  base.chat.completions.create = async payload => {
    const result = await create(payload);
    binding.lastResult = { provider: result.provider, providerId: result.providerId, model: result.model, responseTime: result.responseTime };
    return result;
  };
  return base;
}
function middleware(db, transport) {
  return (req, res, next) => context.run({ db, transport }, () => {
    const json = res.json.bind(res);
    res.json = value => {
      const metadata = context.getStore()?.lastResult;
      return json(metadata && value && !Array.isArray(value) && typeof value === 'object' ? { ...value, aiMetadata: metadata } : value);
    };
    next();
  });
}
module.exports = { bind, client, middleware };
