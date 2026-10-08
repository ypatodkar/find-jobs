// Where match traces are kept.
//
// Two backings behind one interface, for the same reason the catalogue has two: the
// dashboard has to work on a laptop with no database, and in Lambda with no filesystem.
//
//   FileTraceStore      local development — newline-delimited JSON on disk
//   PostgresTraceStore  deployed — the match_trace table
//
// Both enforce retention on write rather than by a scheduled job. A sweep that only
// runs when something is written cannot be forgotten, cannot drift out of step with
// the thing it is pruning, and costs nothing on a quiet day.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_ROWS = 5000;

// What the dashboard list needs, pulled out so neither store has to parse a 14 KB
// document to render a row.
function summarise(run) {
  const steps = run.trace?.steps || [];
  const byName = name => steps.find(s => s.name === name);
  return {
    run_id: run.runId,
    at: run.at,
    resume_hash: run.resumeHash,
    window_days: run.windowDays ?? null,
    pooled: byName('title-relevance')?.detail?.jobsPooled ?? null,
    shortlisted: run.shortlisted ?? null,
    assessed: run.assessed ?? null,
    failed: run.failed ?? null,
    ms: run.ms ?? null,
    provider: byName('title-relevance')?.detail?.provider ?? null,
  };
}

class FileTraceStore {
  constructor(file, options = {}) {
    this.file = file;
    this.retentionMs = (options.retentionDays ?? DEFAULT_RETENTION_DAYS) * 86400000;
    this.maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  }

  async #readAll() {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      // One run per line, so a half-written final line from a killed process costs that
      // run and not the file.
      return raw.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  }

  async put(run) {
    const row = { ...summarise(run), trace: run.trace };
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.appendFile(this.file, JSON.stringify(row) + '\n');
    // Rewrite only when the file has actually outgrown its bounds; appending is the
    // common path and should stay a single syscall.
    const rows = await this.#readAll();
    const cutoff = Date.now() - this.retentionMs;
    const kept = rows.filter(r => r.at >= cutoff).slice(-this.maxRows);
    if (kept.length !== rows.length) {
      await fsp.writeFile(this.file, kept.map(r => JSON.stringify(r)).join('\n') + '\n');
    }
  }

  async list(limit = 50, before = null) {
    const rows = (await this.#readAll()).sort((a, b) => b.at - a.at);
    const page = (before ? rows.filter(r => r.at < before) : rows).slice(0, limit);
    return page.map(({ trace, ...summary }) => summary);
  }

  async get(runId) {
    return (await this.#readAll()).find(r => r.run_id === runId) || null;
  }

  async stats(sinceMs) {
    const rows = (await this.#readAll()).filter(r => r.at >= sinceMs);
    return aggregate(rows);
  }
}

class PostgresTraceStore {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.retentionMs = (options.retentionDays ?? DEFAULT_RETENTION_DAYS) * 86400000;
  }

  async put(run) {
    const s = summarise(run);
    await this.pool.query(
      `INSERT INTO match_trace (run_id, at, resume_hash, window_days, pooled, shortlisted, assessed, failed, ms, provider, trace)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (run_id) DO NOTHING`,
      [s.run_id, s.at, s.resume_hash, s.window_days, s.pooled, s.shortlisted, s.assessed, s.failed, s.ms, s.provider, run.trace]
    );
    // Swept here rather than on a timer: a deployment with no scheduler still prunes,
    // and the cost lands on the request that created the growth.
    await this.pool.query('DELETE FROM match_trace WHERE at < $1', [Date.now() - this.retentionMs]);
  }

  async list(limit = 50, before = null) {
    const { rows } = await this.pool.query(
      `SELECT run_id, at, resume_hash, window_days, pooled, shortlisted, assessed, failed, ms, provider
       FROM match_trace ${before ? 'WHERE at < $2' : ''} ORDER BY at DESC LIMIT $1`,
      before ? [limit, before] : [limit]
    );
    return rows;
  }

  async get(runId) {
    const { rows } = await this.pool.query('SELECT * FROM match_trace WHERE run_id = $1', [runId]);
    return rows[0] || null;
  }

  async stats(sinceMs) {
    const { rows } = await this.pool.query(
      `SELECT at, window_days, pooled, shortlisted, assessed, failed, ms, provider
       FROM match_trace WHERE at >= $1`, [sinceMs]);
    return aggregate(rows);
  }
}

// The questions worth asking across runs rather than within one: is the shortlist
// filling up, how often does the date window have to widen, is the provider healthy.
function aggregate(rows) {
  const n = rows.length;
  if (!n) return { runs: 0 };
  const num = key => rows.map(r => r[key]).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const median = arr => arr.length ? arr[Math.floor(arr.length / 2)] : null;
  const windows = {};
  for (const r of rows) windows[r.window_days] = (windows[r.window_days] || 0) + 1;
  const short = rows.filter(r => (r.shortlisted ?? 0) < 30).length;
  // "0 failed" contains the word "failed". Match the states that actually mean
  // degraded, not the substring — the first version counted every healthy run.
  const degraded = rows.filter(r => /unavailable|all \d+ batch|[1-9]\d* failed/.test(r.provider || '')).length;
  return {
    runs: n,
    medianShortlisted: median(num('shortlisted')),
    medianAssessed: median(num('assessed')),
    medianMs: median(num('ms')),
    p90Ms: num('ms')[Math.floor(num('ms').length * 0.9)] ?? null,
    shortOfTarget: short,
    shortOfTargetPct: Math.round((100 * short) / n),
    providerDegraded: degraded,
    anyFailedAssessments: rows.filter(r => (r.failed ?? 0) > 0).length,
    windows,
    distinctResumes: new Set(rows.map(r => r.resume_hash)).size,
  };
}

function storeFor(catalogue, options = {}) {
  if (catalogue && catalogue.pool) return new PostgresTraceStore(catalogue.pool, options);
  return new FileTraceStore(options.file || path.join(process.cwd(), '.traces', 'matches.jsonl'), options);
}

module.exports = { FileTraceStore, PostgresTraceStore, storeFor, summarise, aggregate };
