const TYPES = Object.freeze({
  authentication: 'Authentication Error', quota: 'Quota Exceeded', rate: 'Rate Limited',
  timeout: 'Timeout', network: 'Network Error', model: 'Model Not Found', unknown: 'Unknown Error'
});

function normalizeError(error) {
  if (Object.values(TYPES).includes(error?.type)) return error;
  if (error?.name === 'AbortError' || error?.code === 'ETIMEDOUT') return mapped(TYPES.timeout, error);
  const status = Number(error?.status || error?.response?.status || 0);
  const message = String(error?.message || 'Provider request failed');
  if (status === 401 || status === 403) return mapped(TYPES.authentication, error);
  if (status === 429) return mapped(/quota|credit|billing/i.test(message) ? TYPES.quota : TYPES.rate, error);
  if (status === 404 && /model/i.test(message)) return mapped(TYPES.model, error);
  if (error?.code && /ECONN|ENOTFOUND|EAI_AGAIN|UND_ERR/i.test(error.code)) return mapped(TYPES.network, error);
  return mapped(TYPES.unknown, error);
}
function mapped(type, error) { return Object.assign(new Error(error?.message || type), { type, status: error?.status || 502, cause: error }); }

module.exports = { TYPES, normalizeError };
