'use strict';

const RETRYABLE_AUTH = new Set([401, 403]);
const RETRYABLE_PATH = new Set([404, 405]);

function toHeaders(input) {
  return input instanceof Headers ? new Headers(input) : new Headers(input || {});
}

function bearerToken(headers) {
  const value = toHeaders(headers).get('authorization') || '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function authHeaders(headers, mode, token) {
  const next = toHeaders(headers);
  next.delete('authorization');
  next.delete('x-api-key');
  next.delete('x-goog-api-key');
  if (mode === 'bearer') next.set('authorization', `Bearer ${token}`);
  if (mode === 'x-api-key') next.set('x-api-key', token);
  if (mode === 'x-goog-api-key') next.set('x-goog-api-key', token);
  return next;
}

function endpointVariants(input) {
  const original = new URL(String(input));
  const results = [original.toString()];
  const normalized = original.pathname.replace(/^\/+|\/+$/g, '');
  const endpoints = ['models', 'chat/completions', 'responses', 'images/generations', 'images/edits'];
  const endpoint = endpoints.find(value => normalized === value || normalized.endsWith(`/${value}`));
  if (!endpoint) return results;

  const prefix = original.pathname.replace(/\/+$/, '').slice(0, -endpoint.length).replace(/\/+$/, '');
  if (!/(?:^|\/)v1(?:\/|$)/.test(prefix)) {
    for (const versionPrefix of ['/v1', '/api/v1']) {
      const candidate = new URL(original.toString());
      candidate.pathname = `${prefix}${versionPrefix}/${endpoint}`.replace(/\/{2,}/g, '/');
      if (!results.includes(candidate.toString())) results.push(candidate.toString());
    }
  }
  return results;
}

async function safelyCancel(response) {
  try { await response?.body?.cancel(); } catch {}
}

function createProviderTransport(nativeFetch = fetch) {
  return async function providerTransport(input, init = {}) {
    const rawUrl = String(input);
    const originalHeaders = toHeaders(init.headers);
    const token = bearerToken(originalHeaders);
    let pathname = '';
    try { pathname = new URL(rawUrl).pathname; } catch {}

    const urls = endpointVariants(rawUrl);
    const authModes = token ? ['bearer', 'x-api-key', 'x-goog-api-key', 'query-key'] : ['none'];
    let lastResponse = null;
    let lastError = null;

    for (let urlIndex = 0; urlIndex < urls.length; urlIndex += 1) {
      const urlValue = urls[urlIndex];
      for (let authIndex = 0; authIndex < authModes.length; authIndex += 1) {
        const mode = authModes[authIndex];
        const target = new URL(urlValue);
        let headers = originalHeaders;
        if (token && mode !== 'query-key') headers = authHeaders(originalHeaders, mode, token);
        if (token && mode === 'query-key') {
          headers = authHeaders(originalHeaders, 'none', token);
          target.searchParams.set('key', token);
        }

        try {
          const response = await nativeFetch(target, { ...init, headers });
          const authRetry = RETRYABLE_AUTH.has(response.status) && authIndex < authModes.length - 1;
          const pathRetry = RETRYABLE_PATH.has(response.status) && urlIndex < urls.length - 1;
          if (!authRetry && !pathRetry) {
            if (lastResponse && lastResponse !== response) await safelyCancel(lastResponse);
            return response;
          }
          if (lastResponse) await safelyCancel(lastResponse);
          lastResponse = response;

          // A missing endpoint is unrelated to auth style; move directly to
          // the next common API prefix instead of firing needless auth probes.
          if (RETRYABLE_PATH.has(response.status)) break;
        } catch (error) {
          if (init.signal?.aborted || error.name === 'AbortError') throw error;
          throw error; // Never repeat a potentially accepted generation after a network error.
        }
      }
    }

    if (lastResponse) return lastResponse;
    throw lastError || new Error('Provider AI tidak dapat dihubungi.');
  };
}

const providerTransport = createProviderTransport();

module.exports = providerTransport;
module.exports.createProviderTransport = createProviderTransport;
module.exports.endpointVariants = endpointVariants;
