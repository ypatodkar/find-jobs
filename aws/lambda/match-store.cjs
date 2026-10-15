// Resumes and their match scores, in Postgres (tables in aws/schema.sql).
//
// Shared by the local dev server (server.js) and, once matching is deployed, the
// Lambda. It lives here so `pg` resolves from this directory's node_modules — the
// repo root stays dependency-free.
//
// Resumes belong to a signed-in account (account-store.cjs), and every read and write
// below is scoped by the account id the session resolved to: knowing a resume id is
// not enough to read, score or delete someone else's. visitor_id records which
// browser a resume was uploaded from.

const crypto = require("crypto");
const { Pool } = require("pg");

const VISITOR_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESUME_ID_RE = /^r_[A-Za-z0-9_-]{16}$/;
const MAX_RESUMES = 10;
const MAX_BODY = 60000;  // characters of extracted text; jev.js reads the first 16 KB
const MAX_LABEL = 80;

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function checkAccount(accountId) {
  if (typeof accountId !== "string" || !accountId) throw fail(401, "Sign in to use resume matching.");
  return accountId;
}
const visitorOrNull = (v) => (typeof v === "string" && VISITOR_RE.test(v) ? v.toLowerCase() : null);
function checkResumeId(id) {
  if (typeof id !== "string" || !RESUME_ID_RE.test(id)) throw fail(400, "That resume could not be found.");
  return id;
}

/** A pool from the standard PG* variables, defaulting to the local dev database. */
function poolFromEnv(env = process.env) {
  return new Pool({
    host: env.PGHOST || "localhost",
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER || undefined,
    password: env.PGPASSWORD || undefined,
    database: env.PGDATABASE || "findjobs_dev",
    ssl: env.PGSSL === "on" ? { rejectUnauthorized: false } : false,
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  });
}

function createStore(pool) {
  // A database that is down or unreachable is reported as such, not as a 500.
  async function q(sql, params) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      if (err.status) throw err;
      throw fail(503, "Resume storage is unavailable right now. Please try again shortly.");
    }
  }

  return {
    async list(accountId) {
      const { rows } = await q(
        "SELECT id, label, file_name, created_at FROM resumes WHERE account_id = $1 ORDER BY created_at DESC",
        [checkAccount(accountId)]
      );
      return rows.map((r) => ({ id: r.id, label: r.label, fileName: r.file_name, createdAt: Number(r.created_at) }));
    },

    async add(accountId, visitor, { label, fileName, body }) {
      const a = checkAccount(accountId);
      const text = typeof body === "string" ? body.trim().slice(0, MAX_BODY) : "";
      if (text.length < 100) throw fail(400, "Too little text could be read from that resume to compare. Try a text-based PDF or .docx.");
      const name = String(label || fileName || "Resume").trim().slice(0, MAX_LABEL) || "Resume";
      const { rows } = await q("SELECT count(*)::int AS n FROM resumes WHERE account_id = $1", [a]);
      if (rows[0].n >= MAX_RESUMES) throw fail(409, `You can keep up to ${MAX_RESUMES} resumes. Remove one to add another.`);
      const id = "r_" + crypto.randomBytes(12).toString("base64url");
      const createdAt = Date.now();
      await q(
        "INSERT INTO resumes (id, account_id, visitor_id, label, file_name, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [id, a, visitorOrNull(visitor) || "", name, fileName ? String(fileName).slice(0, 200) : null, text, createdAt]
      );
      return { id, label: name, fileName: fileName || null, createdAt };
    },

    async remove(accountId, id) {
      const { rowCount } = await q("DELETE FROM resumes WHERE id = $1 AND account_id = $2", [checkResumeId(id), checkAccount(accountId)]);
      if (!rowCount) throw fail(404, "That resume could not be found.");
    },

    async body(accountId, id) {
      const { rows } = await q("SELECT body FROM resumes WHERE id = $1 AND account_id = $2", [checkResumeId(id), checkAccount(accountId)]);
      if (!rows.length) throw fail(404, "That resume could not be found. It may have been removed.");
      return rows[0].body;
    },

    /**
     * The stored assessment for this resume and job, or null. With `current` ({ rubric,
     * descHash }), one made under another rubric or against another version of the
     * description comes back as { stale: true } instead: shown as current, it would
     * describe a posting or a scoring that no longer exists.
     */
    async getMatch(accountId, resumeId, jobId, current) {
      const { rows } = await q(
        `SELECT m.result, m.checked_at, m.rubric, m.desc_hash, f.rating, f.updated_at AS reviewed_at
           FROM resume_matches m
           JOIN resumes r ON r.id = m.resume_id
           LEFT JOIN resume_match_feedback f ON f.resume_id = m.resume_id AND f.job_id = m.job_id
             AND f.account_id = r.account_id AND f.analysis_checked_at = m.checked_at
          WHERE m.resume_id = $1 AND r.account_id = $2 AND m.job_id = $3`,
        [checkResumeId(resumeId), checkAccount(accountId), String(jobId)]
      );
      if (!rows.length) return null;
      const r = rows[0];
      if (current && (r.rubric !== current.rubric || (current.descHash && r.desc_hash !== current.descHash))) {
        return { stale: true, reason: r.rubric !== current.rubric ? "rubric" : "description", checkedAt: Number(r.checked_at) };
      }
      return { ...r.result, checkedAt: Number(r.checked_at), feedback: r.rating ? { rating: r.rating, reviewedAt: Number(r.reviewed_at) } : null };
    },

    /** Record only a result that still exists and belongs to the session account.
     * The snapshot is copied by Postgres, never trusted from the browser. Upserting
     * the same version lets users change their mind without creating duplicate votes.
     */
    async reviewMatch(accountId, payload) {
      const { resume_id, job_id, checked_at, rating } = payload || {};
      const account = checkAccount(accountId);
      const resume = checkResumeId(resume_id);
      if (typeof job_id !== "string" || !/^[\w.:-]{1,300}$/.test(job_id)) throw fail(400, "A valid job is required.");
      if (!Number.isSafeInteger(checked_at) || checked_at <= 0) throw fail(400, "A valid analysis version is required.");
      if (rating !== "up" && rating !== "down") throw fail(400, "Choose thumbs up or thumbs down.");
      const { rows } = await q(
        `INSERT INTO resume_match_feedback
           (account_id, resume_id, job_id, analysis_checked_at, rating, result, score, model, rubric, desc_hash, created_at, updated_at)
         SELECT $2, m.resume_id, m.job_id, m.checked_at, $5, m.result, m.score, m.model, m.rubric, m.desc_hash, $6, $6
           FROM resume_matches m JOIN resumes r ON r.id = m.resume_id
          WHERE m.resume_id = $1 AND r.account_id = $2 AND m.job_id = $3 AND m.checked_at = $4
         ON CONFLICT (account_id, resume_id, job_id, analysis_checked_at) DO UPDATE
           SET rating = EXCLUDED.rating, updated_at = EXCLUDED.updated_at
         RETURNING rating, updated_at`,
        [resume, account, job_id, checked_at, rating, Date.now()]
      );
      if (!rows.length) throw fail(409, "This analysis has changed or is no longer available. Reopen the job before reviewing it.");
      return { rating: rows[0].rating, reviewedAt: Number(rows[0].updated_at) };
    },

    /** Store (or replace) an assessment. The caller has already checked ownership. */
    async saveMatch(resumeId, jobId, result, descHash) {
      const checkedAt = Date.now();
      await q(
        `INSERT INTO resume_matches (resume_id, job_id, score, model, rubric, result, checked_at, desc_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (resume_id, job_id) DO UPDATE
           SET score = EXCLUDED.score, model = EXCLUDED.model, rubric = EXCLUDED.rubric,
               result = EXCLUDED.result, checked_at = EXCLUDED.checked_at, desc_hash = EXCLUDED.desc_hash`,
        [checkResumeId(resumeId), String(jobId), result.score, result.model, result.rubricVersion, JSON.stringify(result), checkedAt, descHash || null]
      );
      return { ...result, checkedAt, feedback: null };
    },
  };
}

module.exports = { createStore, poolFromEnv, MAX_RESUMES };
