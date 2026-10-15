// Accounts, sessions, and the data that follows an account between devices.
//
// Tables in aws/schema.sql. Shared by the dev server and, once deployed, the Lambda.
//
// Signing in does three things in one transaction: finds or creates the account for
// the Google identity, links the browser's visitor id to it (so the clicks, filter
// events, feedback and name recorded under that id belong to the account), and moves
// any résumés uploaded from that browser onto the account. Then it opens a session.

const crypto = require("crypto");

const VISITOR_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_ID_RE = /^[\w.:-]{1,300}$/;
const SESSION_DAYS = 30;
const MAX_SEEN_PER_REQUEST = 6000; // a browser keeps at most 5,000
const MAX_SEEN_PER_ACCOUNT = 20000;
const MAX_FILTERS = 50;
const MAX_FILTERS_BYTES = 100 * 1024;
const MAX_SAVED = 500;
const MAX_SAVED_BYTES = 400 * 1024;

const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = (token) => crypto.createHash("sha256").update(token).digest("hex");
const newId = (prefix) => prefix + crypto.randomBytes(12).toString("base64url");

function publicAccount(row) {
  return { id: row.id, email: row.email, name: row.name, picture: row.picture };
}

// { job_id: ts } from a request, keeping only well-formed entries.
function cleanSeen(map) {
  const out = [];
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [id, ts] of Object.entries(map)) {
    if (out.length >= MAX_SEEN_PER_REQUEST) break;
    const n = Number(ts);
    if (JOB_ID_RE.test(id) && Number.isFinite(n) && n > 0) out.push([id, Math.floor(n)]);
  }
  return out;
}

// A saved-filter list as presets.js keeps it: [{ id, name, filters, createdAt }].
function cleanFilters(items) {
  if (!Array.isArray(items)) throw fail(400, "Saved filters must be a list.");
  const list = items
    .filter((p) => p && typeof p === "object" && typeof p.id === "string" && p.id.length <= 64 && p.filters && typeof p.filters === "object")
    .slice(0, MAX_FILTERS)
    .map((p) => ({ id: p.id, name: String(p.name || "Saved filter").slice(0, 80), filters: p.filters, createdAt: Number(p.createdAt) || Date.now() }));
  if (Buffer.byteLength(JSON.stringify(list)) > MAX_FILTERS_BYTES) throw fail(413, "Too many saved filters to store.");
  return list;
}

// A saved-jobs list as saved.js keeps it: [{ id, at, job: { title, company, … } }].
function cleanSaved(items) {
  if (!Array.isArray(items)) throw fail(400, "Saved jobs must be a list.");
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);
  const seen = new Set();
  const list = [];
  for (const s of items) {
    if (!s || typeof s.id !== "string" || !JOB_ID_RE.test(s.id) || seen.has(s.id) || !s.job || typeof s.job.title !== "string") continue;
    seen.add(s.id);
    const url = str(s.job.url, 1000);
    list.push({
      id: s.id,
      at: Number(s.at) || Date.now(),
      job: { title: str(s.job.title, 300), company: str(s.job.company, 200) || "", city: str(s.job.city, 120), url: url && /^https?:\/\//.test(url) ? url : null, posted: str(s.job.posted, 40) },
    });
    if (list.length >= MAX_SAVED) break;
  }
  if (Buffer.byteLength(JSON.stringify(list)) > MAX_SAVED_BYTES) throw fail(413, "Too many saved jobs to store.");
  return list;
}

function createAccountStore(pool) {
  async function q(client, sql, params) {
    try {
      return await (client || pool).query(sql, params);
    } catch (err) {
      if (err.status) throw err;
      throw fail(503, "Accounts are unavailable right now. Please try again shortly.");
    }
  }

  async function addSeen(client, accountId, entries) {
    if (!entries.length) return;
    await q(client,
      `INSERT INTO account_seen (account_id, job_id, ts)
         SELECT $1, j, t FROM unnest($2::text[], $3::bigint[]) AS u(j, t)
       ON CONFLICT (account_id, job_id) DO UPDATE SET ts = LEAST(account_seen.ts, EXCLUDED.ts)`,
      [accountId, entries.map((e) => e[0]), entries.map((e) => e[1])]);
    // Oldest first out, as the browser does, so the table cannot grow without bound.
    await q(client,
      `DELETE FROM account_seen WHERE account_id = $1 AND job_id IN (
         SELECT job_id FROM account_seen WHERE account_id = $1 ORDER BY ts DESC OFFSET $2)`,
      [accountId, MAX_SEEN_PER_ACCOUNT]);
  }

  async function getSync(client, accountId) {
    const seen = await q(client, "SELECT job_id, ts FROM account_seen WHERE account_id = $1", [accountId]);
    const filters = await q(client, "SELECT items FROM account_filters WHERE account_id = $1", [accountId]);
    const saved = await q(client, "SELECT items FROM account_saved WHERE account_id = $1", [accountId]);
    return {
      seen: Object.fromEntries(seen.rows.map((r) => [r.job_id, Number(r.ts)])),
      filters: filters.rows.length ? filters.rows[0].items : null,
      saved: saved.rows.length ? saved.rows[0].items : null,
    };
  }

  async function putFilters(client, accountId, list) {
    await q(client,
      `INSERT INTO account_filters (account_id, items, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET items = EXCLUDED.items, updated_at = EXCLUDED.updated_at`,
      [accountId, JSON.stringify(list), Date.now()]);
  }

  async function putSaved(client, accountId, list) {
    await q(client,
      `INSERT INTO account_saved (account_id, items, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO UPDATE SET items = EXCLUDED.items, updated_at = EXCLUDED.updated_at`,
      [accountId, JSON.stringify(list), Date.now()]);
  }

  return {
    /**
     * Sign in with verified Google claims from this browser. `local` is what the
     * browser held before signing in ({ seen, filters }); it is merged into the
     * account, never the other way round, so signing in can only add.
     */
    async signIn(claims, visitor, local = {}) {
      const client = await pool.connect().catch(() => { throw fail(503, "Accounts are unavailable right now. Please try again shortly."); });
      try {
        await q(client, "BEGIN");
        const now = Date.now();
        const found = await q(client, "SELECT * FROM accounts WHERE google_sub = $1 FOR UPDATE", [claims.sub]);
        let account;
        const firstSignIn = !found.rows.length;
        if (firstSignIn) {
          account = (await q(client,
            `INSERT INTO accounts (id, google_sub, email, name, picture, created_at, last_login_at)
             VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
            [newId("a_"), claims.sub, claims.email, claims.name, claims.picture, now])).rows[0];
        } else {
          account = (await q(client,
            "UPDATE accounts SET email = $2, name = $3, picture = $4, last_login_at = $5 WHERE id = $1 RETURNING *",
            [found.rows[0].id, claims.email, claims.name, claims.picture, now])).rows[0];
        }

        // Link this browser. A browser already linked to a different account (a
        // shared computer) stays with that account: its history is not reassigned.
        let linkedBrowser = false;
        let movedResumes = 0;
        if (typeof visitor === "string" && VISITOR_RE.test(visitor)) {
          const v = visitor.toLowerCase();
          const link = await q(client,
            "INSERT INTO account_visitors (visitor_id, account_id, linked_at) VALUES ($1, $2, $3) ON CONFLICT (visitor_id) DO NOTHING",
            [v, account.id, now]);
          linkedBrowser = link.rowCount === 1;
          const owner = await q(client, "SELECT account_id FROM account_visitors WHERE visitor_id = $1", [v]);
          if (owner.rows[0] && owner.rows[0].account_id === account.id) {
            movedResumes = (await q(client,
              "UPDATE resumes SET account_id = $1 WHERE visitor_id = $2 AND account_id IS NULL", [account.id, v])).rowCount;
          }
        }

        // Merge what this browser held: opened jobs are a union keeping the earliest
        // time; saved filters keep the account's copy of any id both have.
        await addSeen(client, account.id, cleanSeen(local.seen));
        if (Array.isArray(local.filters) && local.filters.length) {
          const stored = (await getSync(client, account.id)).filters || [];
          const ids = new Set(stored.map((p) => p.id));
          await putFilters(client, account.id, cleanFilters([...stored, ...local.filters.filter((p) => p && !ids.has(p.id))]));
        }
        // Saved jobs merge the same way: everything either side saved, the account's
        // copy winning for a job both have.
        if (Array.isArray(local.saved) && local.saved.length) {
          const stored = (await getSync(client, account.id)).saved || [];
          const ids = new Set(stored.map((s) => s.id));
          await putSaved(client, account.id, cleanSaved([...stored, ...local.saved.filter((s) => s && !ids.has(s.id))]));
        }

        const token = crypto.randomBytes(32).toString("base64url");
        await q(client,
          "INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES ($1, $2, $3, $4)",
          [hash(token), account.id, now, now + SESSION_DAYS * 86400000]);
        const sync = await getSync(client, account.id);
        await q(client, "COMMIT");
        return { account: publicAccount(account), token, firstSignIn, linkedBrowser, movedResumes, sync, maxAge: SESSION_DAYS * 86400 };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    /** The account behind a session token, or null when it is missing or expired. */
    async fromSession(token) {
      if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
      const { rows } = await q(null,
        `SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
          WHERE s.token_hash = $1 AND s.expires_at > $2`, [hash(token), Date.now()]);
      return rows.length ? publicAccount(rows[0]) : null;
    },

    async signOut(token) {
      if (typeof token === "string" && token) await q(null, "DELETE FROM sessions WHERE token_hash = $1", [hash(token)]);
    },

    getSync: (accountId) => getSync(null, accountId),
    addSeen: (accountId, map) => addSeen(null, accountId, cleanSeen(map)),
    putFilters: (accountId, items) => putFilters(null, accountId, cleanFilters(items)),
    putSaved: (accountId, items) => putSaved(null, accountId, cleanSaved(items)),
  };
}

module.exports = { createAccountStore };
