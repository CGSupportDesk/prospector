const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { getStorageMode } = require('./config');

const FILE_PATH = path.join(process.env.VERCEL ? os.tmpdir() : process.cwd(), '.data', 'prospector.json');
const KV_PREFIX = 'prospector';

function createStore() {
  const mode = getStorageMode();
  if (mode === 'kv') return new KvStore();
  if (mode === 'postgres') return new PostgresStore();
  return new FileStore();
}

class FileStore {
  constructor() {
    this.mode = 'file';
  }

  async init() {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    try {
      await fs.access(FILE_PATH);
    } catch {
      await this.write({ runs: {}, leads: [], urlHashes: {} });
    }
  }

  async read() {
    await this.init();
    return JSON.parse(await fs.readFile(FILE_PATH, 'utf8'));
  }

  async write(data) {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(data, null, 2));
  }

  async createRun(run) {
    const data = await this.read();
    data.runs[run.id] = run;
    await this.write(data);
  }

  async completeRun(runId, patch) {
    const data = await this.read();
    data.runs[runId] = { ...(data.runs[runId] || { id: runId }), ...patch };
    await this.write(data);
  }

  async saveLead(lead) {
    const data = await this.read();
    if (data.urlHashes[lead.url_hash]) {
      const existing = data.leads.find((item) => item.url_hash === lead.url_hash);
      if (existing) {
        existing.seen_count = Number(existing.seen_count || 1) + 1;
        existing.last_seen_at = lead.generated_at;
      }
      await this.write(data);
      return false;
    }
    data.urlHashes[lead.url_hash] = true;
    data.leads.unshift({ ...lead, seen_count: 1, last_seen_at: lead.generated_at });
    await this.write(data);
    return true;
  }

  async listLeads({ limit = 100, runId = '' } = {}) {
    const data = await this.read();
    return data.leads
      .filter((lead) => !runId || lead.run_id === runId)
      .slice(0, limit);
  }

  async countLeads() {
    const data = await this.read();
    return data.leads.length;
  }

  async exportRows(runId = '') {
    const data = await this.read();
    return data.leads
      .filter((lead) => !runId || lead.run_id === runId)
      .map((lead) => ({ ...lead, run: data.runs[lead.run_id] || {} }));
  }
}

class KvStore {
  constructor() {
    this.mode = 'kv';
    this.baseUrl = process.env.KV_REST_API_URL.replace(/\/$/, '');
    this.token = process.env.KV_REST_API_TOKEN;
  }

  async init() {}

  async command(args) {
    const response = await fetch(`${this.baseUrl}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([args])
    });
    const data = await response.json();
    if (!response.ok || data?.[0]?.error) {
      throw new Error(data?.[0]?.error || `KV command failed with HTTP ${response.status}`);
    }
    return data[0].result;
  }

  async createRun(run) {
    await this.command(['HSET', `${KV_PREFIX}:runs`, run.id, JSON.stringify(run)]);
  }

  async completeRun(runId, patch) {
    const currentRaw = await this.command(['HGET', `${KV_PREFIX}:runs`, runId]);
    const current = currentRaw ? JSON.parse(currentRaw) : { id: runId };
    await this.command(['HSET', `${KV_PREFIX}:runs`, runId, JSON.stringify({ ...current, ...patch })]);
  }

  async saveLead(lead) {
    const added = Number(await this.command(['SADD', `${KV_PREFIX}:url_hashes`, lead.url_hash]));
    if (!added) return false;
    await this.command(['LPUSH', `${KV_PREFIX}:leads`, JSON.stringify({ ...lead, seen_count: 1, last_seen_at: lead.generated_at })]);
    return true;
  }

  async listLeads({ limit = 100, runId = '' } = {}) {
    const items = await this.command(['LRANGE', `${KV_PREFIX}:leads`, '0', String(limit * 3)]);
    return items
      .map((item) => JSON.parse(item))
      .filter((lead) => !runId || lead.run_id === runId)
      .slice(0, limit);
  }

  async countLeads() {
    return Number(await this.command(['LLEN', `${KV_PREFIX}:leads`]));
  }

  async exportRows(runId = '') {
    const items = await this.command(['LRANGE', `${KV_PREFIX}:leads`, '0', '-1']);
    const rows = [];
    for (const item of items) {
      const lead = JSON.parse(item);
      if (runId && lead.run_id !== runId) continue;
      const runRaw = await this.command(['HGET', `${KV_PREFIX}:runs`, lead.run_id]);
      rows.push({ ...lead, run: runRaw ? JSON.parse(runRaw) : {} });
    }
    return rows;
  }
}

class PostgresStore {
  constructor() {
    this.mode = 'postgres';
    this.pool = new Pool({
      connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS lead_runs (
        id TEXT PRIMARY KEY,
        requested_count INTEGER NOT NULL DEFAULT 50,
        generated_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        categories JSONB,
        locations JSONB,
        angles JSONB,
        extra_keywords TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS leads (
        id BIGSERIAL PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES lead_runs(id) ON DELETE CASCADE,
        business_name TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'Website',
        url TEXT NOT NULL,
        url_hash TEXT NOT NULL UNIQUE,
        category TEXT,
        location TEXT,
        country TEXT,
        reason TEXT,
        source_hint TEXT,
        generated_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_leads_run_id ON leads(run_id);
      CREATE INDEX IF NOT EXISTS idx_leads_generated_at ON leads(generated_at);
      CREATE INDEX IF NOT EXISTS idx_leads_platform ON leads(platform);
    `);
  }

  async createRun(run) {
    await this.pool.query(
      `INSERT INTO lead_runs (id, requested_count, categories, locations, angles, extra_keywords, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [run.id, run.requested_count, JSON.stringify(run.categories), JSON.stringify(run.locations), JSON.stringify(run.angles), run.extra_keywords, run.status, run.created_at]
    );
  }

  async completeRun(runId, patch) {
    await this.pool.query(
      `UPDATE lead_runs
       SET generated_count = $1, duplicate_count = $2, status = $3, completed_at = $4, notes = $5
       WHERE id = $6`,
      [patch.generated_count, patch.duplicate_count, patch.status, patch.completed_at, patch.notes || null, runId]
    );
  }

  async saveLead(lead) {
    const inserted = await this.pool.query(
      `INSERT INTO leads (run_id, business_name, platform, url, url_hash, category, location, country, reason, source_hint, generated_at, last_seen_at, seen_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, 1)
       ON CONFLICT (url_hash) DO NOTHING
       RETURNING id`,
      [
        lead.run_id,
        lead.business_name,
        lead.platform,
        lead.url,
        lead.url_hash,
        lead.category,
        lead.location,
        lead.country,
        lead.reason,
        lead.source_hint,
        lead.generated_at
      ]
    );
    if (inserted.rowCount > 0) return true;
    await this.pool.query(
      'UPDATE leads SET seen_count = seen_count + 1, last_seen_at = $1 WHERE url_hash = $2',
      [lead.generated_at, lead.url_hash]
    );
    return false;
  }

  async listLeads({ limit = 100, runId = '' } = {}) {
    if (runId) {
      const result = await this.pool.query(
        'SELECT business_name, platform, url, category, location, country, reason, source_hint, generated_at, run_id FROM leads WHERE run_id = $1 ORDER BY id DESC LIMIT $2',
        [runId, limit]
      );
      return result.rows;
    }
    const result = await this.pool.query(
      'SELECT business_name, platform, url, category, location, country, reason, source_hint, generated_at, run_id FROM leads ORDER BY id DESC LIMIT $1',
      [limit]
    );
    return result.rows;
  }

  async countLeads() {
    const result = await this.pool.query('SELECT COUNT(*)::int AS count FROM leads');
    return result.rows[0].count;
  }

  async exportRows(runId = '') {
    const values = [];
    const where = runId ? 'WHERE l.run_id = $1' : '';
    if (runId) values.push(runId);
    const result = await this.pool.query(
      `SELECT l.*, row_to_json(r.*) AS run
       FROM leads l
       LEFT JOIN lead_runs r ON r.id = l.run_id
       ${where}
       ORDER BY l.generated_at DESC, l.id DESC`,
      values
    );
    return result.rows;
  }
}

module.exports = {
  createStore
};
