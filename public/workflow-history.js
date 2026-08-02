(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WorkflowHistory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const LIMIT = 200;
  const clone = value => JSON.parse(JSON.stringify(value));
  const validDate = value => value && !Number.isNaN(new Date(value).getTime());
  function normalizeHistoryItem(item) {
    const raw = item && typeof item === 'object' ? item : {};
    const recordType = raw.data && typeof raw.data === 'object' ? 'workflow' : raw.payload && typeof raw.payload === 'object' ? 'content-factory' : 'unknown';
    const payload = recordType === 'content-factory' ? raw.payload : {};
    const candidates = [raw.updatedAt, raw.createdAt, payload.createdAt];
    const date = candidates.find(validDate) || null;
    return { id: String(raw.id || ''), name: raw.name || payload.title || 'Record tanpa nama', status: raw.status || payload.workflow?.status || 'Unknown', source: raw.source || (recordType === 'content-factory' ? 'AI Content Factory' : 'Workflow'), recordType, createdAt: raw.createdAt || payload.createdAt || null, updatedAt: raw.updatedAt || null, date, data: raw.data || {}, payload, result: raw.result || null, raw };
  }
  const formatHistoryDate = item => { const normalized = item?.raw ? item : normalizeHistoryItem(item); return normalized.date ? new Date(normalized.date).toLocaleString('id-ID') : 'Tanggal tidak tersedia'; };
  function deduplicate(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).filter(item => { const normalized = normalizeHistoryItem(item); const key = normalized.id ? `${normalized.recordType}:${normalized.id}` : `corrupt:${JSON.stringify(item)}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, LIMIT);
  }
  function upsert(items, record) {
    const normalized = normalizeHistoryItem(record);
    return deduplicate([record, ...(Array.isArray(items) ? items : []).filter(item => { const current = normalizeHistoryItem(item); return !(current.id === normalized.id && current.recordType === normalized.recordType); })]);
  }
  function findHistoryRecord(items, id, recordType) { return deduplicate(items).map(normalizeHistoryItem).find(item => item.id === String(id) && item.recordType === recordType); }
  function sortAndFilter(items, { search = '', source = '', status = '' } = {}) {
    const query = search.toLocaleLowerCase('id');
    return deduplicate(items).map(normalizeHistoryItem).filter(item => {
      const content = item.recordType === 'workflow' ? `${item.name} ${item.data.project?.product || ''} ${item.data.generator?.prompt || ''}` : `${item.name} ${item.payload.brief?.topic || ''} ${item.payload.videoScript || ''} ${item.payload.providerPrompts?.map(x => x.prompt).join(' ') || ''}`;
      return (!query || content.toLocaleLowerCase('id').includes(query)) && (!source || item.recordType === source) && (!status || item.status === status);
    }).sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
  }
  function mapContentFactoryToWorkflow(item, makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`) {
    const normalized = normalizeHistoryItem(item), payload = normalized.payload;
    if (normalized.recordType !== 'content-factory') return null;
    const now = new Date().toISOString(), prompt = payload.videoScript || payload.providerPrompts?.[0]?.prompt || '';
    return { id: makeId(), currentStep: 0, status: 'Draft', createdAt: now, updatedAt: now, data: { project: { name: payload.title || '', product: payload.brief?.topic || '' }, consistency: { style: payload.brief?.style || '' }, studio: { format: payload.brief?.output || payload.template || '' }, generator: { prompt, assetIds: Array.isArray(payload.assetIds) ? [...payload.assetIds] : [] }, provider: {}, queue: {}, integration: {} } };
  }
  function duplicate(item, makeId) { const copy = clone(normalizeHistoryItem(item).raw); copy.id = makeId(); copy.name = `${copy.name || copy.payload?.title || 'Record'} (Salinan)`; copy.createdAt = copy.updatedAt = new Date().toISOString(); return copy; }
  return { LIMIT, normalizeHistoryItem, formatHistoryDate, deduplicate, upsert, findHistoryRecord, sortAndFilter, mapContentFactoryToWorkflow, duplicate };
});
