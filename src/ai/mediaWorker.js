const crypto = require('node:crypto');
const connector = require('./connector');

const TERMINAL = new Set(['Completed', 'Failed', 'Cancelled']);
class MediaGenerationWorker {
  constructor({ db, transport, concurrency = 2, onCompleted } = {}) { this.db = db; this.transport = transport; this.concurrency = concurrency; this.onCompleted = onCompleted; this.pending = []; this.running = new Set(); this.listeners = new Map(); }
  subscribe(id, listener) { const set = this.listeners.get(id) || new Set(); set.add(listener); this.listeners.set(id, set); return () => set.delete(listener); }
  emit(id, status, extra = {}) { for (const listener of this.listeners.get(id) || []) listener({ id, status, ...extra }); }
  enqueue(body) { const id = body.id || crypto.randomUUID(); this.pending.push({ ...body, id }); queueMicrotask(() => this.drain()); return id; }
  enqueueMany(items) { return items.map(item => this.enqueue(item)); }
  async drain() { while (this.running.size < this.concurrency && this.pending.length) { const job = this.pending.shift(); this.running.add(job.id); this.run(job).finally(() => { this.running.delete(job.id); this.drain(); }); } }
  async run(job) { try { const result = await connector.execute(this.db, job, this.transport, (status, id) => this.emit(id, status), job.id); if (result.status === 'Completed') await this.onCompleted?.(job.id); } catch (error) { this.db.prepare("UPDATE ai_generations SET status='Failed',error_type=COALESCE(error_type,?),error_message=COALESCE(error_message,?),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'Cancelled'").run(error.type || error.name || 'Worker Error', error.message || 'Generation gagal', job.id); this.emit(job.id, 'Failed', { message: error.message }); } }
  cancel(id) { const index = this.pending.findIndex(job => job.id === id); if (index >= 0) { this.pending.splice(index, 1); connector.markCancelled(this.db, id); this.emit(id, 'Cancelled'); return true; } return connector.cancel(id); }
  continue(id) { const row = connector.generation(this.db, id); if (!row || TERMINAL.has(row.status)) return false; this.enqueue({ id, provider: row.provider, model: row.model, prompt: row.prompt, mediaType: row.media_type, resume: true }); return true; }
}

module.exports = { MediaGenerationWorker, TERMINAL };
