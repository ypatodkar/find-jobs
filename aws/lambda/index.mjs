// Click collector, ported from the Cloudflare Worker to a Lambda Function URL.
//
//   POST /click    record one click             (track.js, via sendBeacon)
//   POST /filter   record a saved/applied view  (presets.js)
//   POST /like     one-way heart, per browser
//   POST /feedback record feedback, and email it on
//   GET  /stats    public totals for the header counter
//   GET  /counts   { job_id: clicks } (private — needs ADMIN_TOKEN)
//
// The routing, validation and threat model are unchanged from the Worker: this is a
// public write endpoint whose URL is in the page source, the guards are sized for
// someone skewing numbers rather than for a determined attacker, and every value from
// a request is bound as a parameter and never concatenated into SQL.
//
// Three things genuinely differ, all forced by the platform:
//
//   1. Geo. The Worker read req.cf.country, which Cloudflare fills in for free. Lambda
//      has no equivalent, so country comes from the CloudFront-Viewer-Country header —
//      which only arrives if the distribution is configured to forward it. Absent that
//      header the column is null rather than wrong, and setting it up is a deploy step,
//      not a code one.
//   2. Connections. A Worker is stateless per request; a Lambda container is reused, so
//      the pool is module-level and survives invocations. max is deliberately tiny:
//      concurrent Lambdas each hold their own pool, and Postgres runs out of connection
//      slots long before this workload runs out of traffic.
//   3. Batching. D1 has batch(); node-postgres does not, so the multi-statement paths
//      run inside an explicit transaction, which is what batch() was providing.

import pg from "pg";

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}_(ashby|greenhouse|lever|vc)_[a-z0-9-]{1,64}$/;
const MAX_TEXT = 200;
const TOPICS = ["jobs", "filters", "design", "bug", "other"];
const TOPIC_LABELS = {
  jobs: "More jobs / companies",
  filters: "Filters & search",
  design: "Design & layout",
  bug: "Something is broken",
  other: "Something else",
};

const clip = (v) => (v == null ? null : String(v).slice(0, MAX_TEXT));
const escapeHtml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// One pool per container, created lazily so a cold start that never touches the
// database never pays for a connection.
let pool;
function db() {
  if (!pool) {
    pool = new pg.Pool({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      // On by default, because the only deployment that matters is RDS and an
      // unencrypted connection there would be a quiet mistake rather than a loud one.
      // PGSSL=off exists so the same handler can be run against a local Postgres — a
      // test server has no TLS, and a handler that cannot be exercised outside AWS is
      // a handler that only gets tested in production.
      //
      // rejectUnauthorized is false because the RDS CA is not in Lambda's default
      // trust store; pinning it would mean shipping and rotating a bundle with the
      // function. This encrypts the connection without authenticating the server, and
      // the connection never leaves the VPC.
      ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

async function tx(fn) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Upsert on every event so last_seen stays current and a name typed later lands. A
// null name never overwrites a stored one — skipping now and naming later works, and
// naming now then skipping later does not wipe it.
function touchUser(client, userId, name, country, now) {
  return client.query(
    `INSERT INTO users (user_id, name, first_seen, last_seen, country)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       last_seen = EXCLUDED.last_seen,
       name      = COALESCE(EXCLUDED.name, users.name),
       country   = COALESCE(EXCLUDED.country, users.country)`,
    [userId, name, now, now, country]
  );
}

function corsFor(origin) {
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return { "access-control-allow-origin": "*", vary: "Origin" };
  if (origin && allowed.includes(origin)) return { "access-control-allow-origin": origin, vary: "Origin" };
  return null;
}

const reply = (status, headers = {}, body = null) => ({
  statusCode: status,
  headers,
  ...(body == null ? {} : { body }),
});

async function sendFeedbackEmail(payload) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.FEEDBACK_TO;
  const from = process.env.FEEDBACK_FROM;
  if (!key || !to || !from) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Find Jobs feedback: ${TOPIC_LABELS[payload.topic] || payload.topic}`,
        html:
          `<p><strong>${escapeHtml(TOPIC_LABELS[payload.topic] || payload.topic)}</strong></p>` +
          `<p style="white-space:pre-wrap">${escapeHtml(payload.message)}</p><hr>` +
          `<p style="font:13px system-ui;color:#666">` +
          `from: ${escapeHtml(payload.name || "anonymous")}` +
          (payload.contact ? ` &lt;${escapeHtml(payload.contact)}&gt;` : "") +
          `<br>page: ${escapeHtml(payload.page || "-")}` +
          `<br>country: ${escapeHtml(payload.country || "-")}` +
          `<br>user: ${escapeHtml(payload.userId || "-")}` +
          `<br>id: ${escapeHtml(String(payload.id ?? "-"))}</p>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || "GET";
  const path = event.rawPath || "/";
  const headers = event.headers || {};
  const origin = headers.origin || headers.Origin || null;
  const cors = corsFor(origin);
  // Only present when the CloudFront distribution forwards it; null, never guessed.
  const country = headers["cloudfront-viewer-country"] || null;

  const parse = () => {
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body;
      return JSON.parse(raw || "{}");
    } catch {
      return null;
    }
  };
  const userIdOf = (b) => (USER_ID_RE.test(String(b.user_id || "")) ? String(b.user_id) : null);

  if (method === "OPTIONS") {
    return reply(cors ? 204 : 403, {
      ...(cors || {}),
      "access-control-allow-methods": "GET, POST",
      "access-control-allow-headers": "content-type",
    });
  }

  if (method === "POST" && path === "/click") {
    if (!cors) return reply(403);
    const body = parse();
    if (!body) return reply(400, cors);
    const id = String(body.job_id || "");
    if (!JOB_ID_RE.test(id)) return reply(400, cors);

    const now = Date.now();
    const userId = userIdOf(body);
    await tx(async (c) => {
      if (userId) await touchUser(c, userId, clip(body.user_name), country, now);
      if (process.env.STRICT !== "1") {
        await c.query(
          `INSERT INTO jobs (job_id, company, title, city, source, first_seen, last_seen, active)
           VALUES ($1, $2, $3, $4, 'click', $5, $6, 0)
           ON CONFLICT (job_id) DO NOTHING`,
          [id, clip(body.company) || "unknown", clip(body.title) || "unknown", clip(body.city), now, now]
        );
      }
      await c.query(
        `INSERT INTO clicks (job_id, user_id, ts, page, firm, country) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, userId, now, clip(body.page), clip(body.firm), country]
      );
      await c.query(`UPDATE jobs SET clicks = clicks + 1 WHERE job_id = $1`, [id]);
    });
    return reply(204, cors);
  }

  if (method === "POST" && path === "/filter") {
    if (!cors) return reply(403);
    const body = parse();
    if (!body) return reply(400, cors);
    const action = String(body.action || "");
    if (action !== "save" && action !== "apply") return reply(400, cors);

    let filters = null;
    try { filters = JSON.stringify(body.filters || {}).slice(0, 2000); } catch { filters = null; }

    const now = Date.now();
    const userId = userIdOf(body);
    await tx(async (c) => {
      if (userId) await touchUser(c, userId, clip(body.user_name), country, now);
      await c.query(
        `INSERT INTO filter_events (user_id, ts, action, name, filters, page, firm, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, now, action, clip(body.name), filters, clip(body.page), clip(body.firm), country]
      );
    });
    return reply(204, cors);
  }

  if (method === "POST" && path === "/like") {
    if (!cors) return reply(403);
    const body = parse();
    if (!body) return reply(400, cors);
    const userId = userIdOf(body);
    if (!userId) return reply(400, cors);

    const now = Date.now();
    // COALESCE keeps the first like's timestamp, so a repeat tap is a no-op rather
    // than a moved date — the heart is "I liked this", not a counter to farm.
    await db().query(
      `INSERT INTO users (user_id, name, first_seen, last_seen, country, liked_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         last_seen = EXCLUDED.last_seen,
         name      = COALESCE(EXCLUDED.name, users.name),
         country   = COALESCE(EXCLUDED.country, users.country),
         liked_at  = COALESCE(users.liked_at, EXCLUDED.liked_at)`,
      [userId, clip(body.user_name), now, now, country, now]
    );
    return reply(204, cors);
  }

  if (method === "POST" && path === "/feedback") {
    if (!cors) return reply(403);
    const body = parse();
    if (!body) return reply(400, cors);

    const message = String(body.message || "").trim().slice(0, 4000);
    if (message.length < 2) return reply(400, cors);

    const topic = TOPICS.includes(body.topic) ? body.topic : "other";
    const now = Date.now();
    const userId = userIdOf(body);
    const name = clip(body.user_name);
    const contact = clip(body.contact);
    const page = clip(body.page);

    const { rows } = await db().query(
      `INSERT INTO feedback (user_id, name, topic, message, contact, page, country, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [userId, name, topic, message, contact, page, country, now]
    );
    const id = rows[0]?.id;

    // Stored first, emailed second, and the email is never allowed to fail the
    // request: a bad key or a Resend outage should cost a notification, never
    // someone's typed-out complaint.
    const sent = await sendFeedbackEmail({ id, topic, message, name, contact, userId, page, country });
    if (sent && id) {
      await db().query(`UPDATE feedback SET emailed_at = $1 WHERE id = $2`, [Date.now(), id]);
    }
    return reply(204, cors);
  }

  if (method === "GET" && path === "/stats") {
    if (!cors) return reply(403);
    const { rows } = await db().query(
      `SELECT (SELECT COUNT(*) FROM clicks)                        AS clicks,
              (SELECT COUNT(DISTINCT job_id) FROM clicks)          AS jobs,
              (SELECT COUNT(*) FROM users)                         AS users,
              (SELECT COUNT(*) FROM users WHERE liked_at IS NOT NULL) AS likes`
    );
    // Postgres returns COUNT() as a string (bigint); the browser counter expects
    // numbers, so they are coerced here rather than in five places on the page.
    const r = rows[0] || {};
    const out = { clicks: Number(r.clicks || 0), jobs: Number(r.jobs || 0), users: Number(r.users || 0), likes: Number(r.likes || 0) };
    return reply(200, { ...cors, "content-type": "application/json", "cache-control": "public, max-age=300" }, JSON.stringify(out));
  }

  if (method === "GET" && path === "/counts") {
    const auth = headers.authorization || headers.Authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : (event.queryStringParameters || {}).token;
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return reply(401, {}, "Unauthorized");
    }
    const { rows } = await db().query(`SELECT job_id, clicks FROM jobs WHERE clicks > 0`);
    return reply(200, { "content-type": "application/json", "cache-control": "no-store" },
      JSON.stringify(Object.fromEntries(rows.map((r) => [r.job_id, Number(r.clicks)]))));
  }

  return reply(404, {}, "Not found");
};
