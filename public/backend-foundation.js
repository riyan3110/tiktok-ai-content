(() => {
  'use strict';

  const environment = Object.freeze({ name: 'mock', mock: true, apiVersion: 'v1', timeout: 4000, retries: 2 });
  const baseUrls = Object.freeze({ mock: 'mock://ai-ads-lab/v1', development: '/api/v1', production: '/api/v1' });
  const config = Object.freeze({ ...environment, baseUrl: baseUrls[environment.name] });
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  class ApiError extends Error {
    constructor(message, { status = 500, code = 'MOCK_ERROR', details = null } = {}) {
      super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.details = details;
    }
  }
  class RequestQueue {
    constructor() { this.tail = Promise.resolve(); this.pending = 0; }
    add(task) { this.pending += 1; const run = this.tail.then(task, task); this.tail = run.finally(() => { this.pending -= 1; }); return run; }
  }
  const requestQueue = new RequestQueue();
  const response = (data, status = 200, meta = {}) => ({ ok: status >= 200 && status < 300, status, data: clone(data), meta: { mock: true, timestamp: new Date().toISOString(), ...meta } });
  const mockState = {
    users: [{ id: 'usr_demo', name: 'AI Ads Lab Workspace', email: 'demo@aiadslab.local', password: 'demo123', role: 'Owner', subscription: 'Studio Pro' }],
    projects: [], history: []
  };
  const id = prefix => `${prefix}_${crypto.randomUUID?.() || Date.now()}`;
  const routes = [
    ['POST', /^\/auth\/login$/, ({ body }) => { const user = mockState.users.find(item => item.email === body.email && item.password === body.password); if (!user) throw new ApiError('Email atau kata sandi tidak valid.', { status: 401, code: 'INVALID_CREDENTIALS' }); return { user, accessToken: id('access'), refreshToken: id('refresh'), expiresIn: 3600 }; }],
    ['POST', /^\/auth\/register$/, ({ body }) => { if (!body.email || !body.password || !body.name) throw new ApiError('Nama, email, dan kata sandi wajib diisi.', { status: 422, code: 'VALIDATION_ERROR' }); if (mockState.users.some(item => item.email === body.email)) throw new ApiError('Email sudah terdaftar.', { status: 409, code: 'EMAIL_EXISTS' }); const user = { id: id('usr'), name: body.name, email: body.email, password: body.password, role: 'Owner', subscription: 'Free' }; mockState.users.push(user); return { user, accessToken: id('access'), refreshToken: id('refresh'), expiresIn: 3600 }; }],
    ['POST', /^\/auth\/forgot-password$/, () => ({ sent: true, message: 'Tautan reset mock telah dibuat.' })],
    ['POST', /^\/auth\/logout$/, () => ({ loggedOut: true })],
    ['POST', /^\/auth\/refresh$/, ({ body }) => { if (!body.refreshToken) throw new ApiError('Refresh token tidak tersedia.', { status: 401, code: 'TOKEN_REQUIRED' }); return { accessToken: id('access'), refreshToken: id('refresh'), expiresIn: 3600 }; }],
    ['GET', /^\/profile$/, ({ user }) => user || mockState.users[0]],
    ['GET', /^\/projects$/, () => mockState.projects],
    ['POST', /^\/projects$/, ({ body }) => { const item = { ...body, id: body.id || id('project') }; mockState.projects.unshift(item); return item; }],
    ['PUT', /^\/projects\/([^/]+)$/, ({ body, match }) => { const index = mockState.projects.findIndex(item => item.id === match[1]); if (index < 0) throw new ApiError('Project tidak ditemukan.', { status: 404, code: 'NOT_FOUND' }); return (mockState.projects[index] = { ...mockState.projects[index], ...body }); }],
    ['DELETE', /^\/projects\/([^/]+)$/, ({ match }) => { const before = mockState.projects.length; mockState.projects = mockState.projects.filter(item => item.id !== match[1]); return { deleted: before !== mockState.projects.length }; }],
    ['GET', /^\/history$/, () => mockState.history],
    ['POST', /^\/history$/, ({ body }) => { const item = { ...body, id: body.id || id('history') }; mockState.history.unshift(item); return item; }]
  ];
  async function mockTransport(request) {
    await wait(80); const route = routes.find(([method, pattern]) => method === request.method && pattern.test(request.path));
    if (!route) throw new ApiError(`Mock endpoint tidak ditemukan: ${request.method} ${request.path}`, { status: 404, code: 'ENDPOINT_NOT_FOUND' });
    const match = request.path.match(route[1]); return response(route[2]({ ...request, match, user: SessionManager.current()?.user }), request.method === 'POST' ? 201 : 200);
  }
  async function withTimeout(promise, timeout) {
    let timer; const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new ApiError('Request mock melewati batas waktu.', { status: 408, code: 'TIMEOUT' })), timeout); });
    return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
  }
  async function withRetry(task, retries = config.retries) {
    let error; for (let attempt = 0; attempt <= retries; attempt += 1) { try { return await task(attempt); } catch (caught) { error = caught; if (caught.status < 500 || attempt === retries) throw caught; await wait(100 * (attempt + 1)); } } throw error;
  }
  const ApiClient = { request(path, options = {}) { const request = { path, method: (options.method || 'GET').toUpperCase(), body: clone(options.body || {}), headers: { 'Content-Type': 'application/json', ...options.headers }, requestId: id('req') }; return requestQueue.add(() => withRetry(() => withTimeout(mockTransport(request), options.timeout || config.timeout), options.retries ?? config.retries)); }, get(path, options) { return this.request(path, options); }, post(path, body, options) { return this.request(path, { ...options, method: 'POST', body }); }, put(path, body, options) { return this.request(path, { ...options, method: 'PUT', body }); }, delete(path, options) { return this.request(path, { ...options, method: 'DELETE' }); } };

  class LocalStorageAdapter {
    get(key, fallback = null) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } }
    set(key, value) { localStorage.setItem(key, JSON.stringify(value)); return value; }
    remove(key) { localStorage.removeItem(key); }
    clear() { Object.keys(localStorage).filter(key => key.startsWith('ai-ads-lab')).forEach(key => localStorage.removeItem(key)); }
  }
  class RemoteStorageAdapter {
    constructor() { this.data = new Map(); }
    async get(key, fallback = null) { await wait(60); return clone(this.data.has(key) ? this.data.get(key) : fallback); }
    async set(key, value) { await wait(60); this.data.set(key, clone(value)); return value; }
    async remove(key) { await wait(40); this.data.delete(key); }
  }
  const storage = new LocalStorageAdapter(); const remoteStorage = new RemoteStorageAdapter();
  const TokenManager = { key: 'ai-ads-lab-auth-tokens', get() { return storage.get(this.key); }, save(tokens, remember = false) { const value = { ...tokens, remember, expiresAt: Date.now() + tokens.expiresIn * 1000 }; storage.set(this.key, value); return value; }, clear() { storage.remove(this.key); }, expired() { return !this.get() || this.get().expiresAt <= Date.now(); } };
  const SessionManager = { key: 'ai-ads-lab-session', current() { return storage.get(this.key); }, save(user, remember) { const session = { user: { ...user, password: undefined }, remember, restoredAt: new Date().toISOString() }; storage.set(this.key, session); return session; }, restore() { const session = this.current(); if (!session || (!session.remember && TokenManager.expired())) { this.clear(); return null; } return session; }, clear() { storage.remove(this.key); TokenManager.clear(); } };
  const Auth = { async login(credentials) { const result = await ApiClient.post('/auth/login', credentials); TokenManager.save(result.data, Boolean(credentials.remember)); return SessionManager.save(result.data.user, Boolean(credentials.remember)); }, async register(data) { const result = await ApiClient.post('/auth/register', data); TokenManager.save(result.data, Boolean(data.remember)); return SessionManager.save(result.data.user, Boolean(data.remember)); }, async forgotPassword(email) { return (await ApiClient.post('/auth/forgot-password', { email })).data; }, async logout() { await ApiClient.post('/auth/logout', {}); SessionManager.clear(); }, async refresh() { const tokens = TokenManager.get(); const result = await ApiClient.post('/auth/refresh', { refreshToken: tokens?.refreshToken }); TokenManager.save(result.data, tokens?.remember); return result.data; }, restore: () => SessionManager.restore() };

  const syncResources = ['projects', 'promptStudio', 'consistency', 'promptGenerator', 'aiProvider', 'queue', 'workflow', 'assets', 'history'];
  const SyncManager = { status: 'healthy', listeners: new Set(), onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }, emit(status, detail = '') { this.status = status; this.listeners.forEach(listener => listener({ status, detail })); }, async sync(resource = 'all') { const resources = resource === 'all' ? syncResources : [resource]; this.emit(navigator.onLine ? 'syncing' : 'offline', resources.join(', ')); if (!navigator.onLine) return { synced: false, resources }; await wait(450); for (const name of resources) await remoteStorage.set(`sync:${name}`, { syncedAt: new Date().toISOString() }); this.emit('healthy', `${resources.length} modul tersinkronisasi`); return { synced: true, resources }; } };
  window.addEventListener('online', () => SyncManager.emit('online', 'Koneksi dipulihkan')); window.addEventListener('offline', () => SyncManager.emit('offline', 'Perubahan tetap aman di perangkat'));
  window.BackendFoundation = { config, baseUrls, ApiError, ApiClient, RequestQueue, LocalStorageAdapter, RemoteStorageAdapter, storage, remoteStorage, TokenManager, SessionManager, Auth, SyncManager, syncResources };
})();
