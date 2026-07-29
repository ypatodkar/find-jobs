// Click collector.
//   POST /click   record one click        (called by track.js via sendBeacon)
//   GET  /counts  { job_id: clicks, ... } (private — needs ADMIN_TOKEN)
//
// Threat model: /click is a public write endpoint on the open internet. Its URL is
// in the page source of a site you hand to friends, so assume it is known. There are
// no credentials and no personal data behind it; the realistic abuse is someone
// spamming writes to skew the numbers or to burn the D1 free-tier write quota, and
// the guards below are sized for that rather than for a determined attacker.

// Every id the scraper generates matches this (verified against a full 5,022-role
// scrape). Anything else is not a job id we ever issued.
const JOB_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}_(ashby|greenhouse|lever|vc)_[a-z0-9-]{1,64}$/;

const MAX_TEXT = 200;
const clip = (v) => (v == null ? null : String(v).slice(0, MAX_TEXT));

function corsFor(req, env) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.get("origin");

  // No allowlist configured: stay permissive so a fresh deploy works, and rely on the
  // other guards. Set ALLOWED_ORIGINS once you know your site's URL.
  if (!allowed.length) return { "access-control-allow-origin": "*", vary: "Origin" };
  if (origin && allowed.includes(origin)) return { "access-control-allow-origin": origin, vary: "Origin" };
  return null; // caller rejects
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsFor(req, env);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: cors ? 204 : 403,
        headers: { ...(cors || {}), "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" },
      });
    }

    if (req.method === "POST" && url.pathname === "/click") {
      // An Origin outside the allowlist is refused. This stops other sites and casual
      // browser-driven abuse; it does not stop curl, which can forge the header.
      if (!cors) return new Response(null, { status: 403 });

      let body;
      try {
        body = JSON.parse(await req.text());
      } catch {
        return new Response(null, { status: 400, headers: cors });
      }

      const id = String(body.job_id || "");
      if (!JOB_ID_RE.test(id)) return new Response(null, { status: 400, headers: cors });

      const now = Date.now();
      const statements = [];

      // STRICT=1 counts clicks only for jobs a sync has already loaded, so no request
      // can create a row. Leave it off until your first sync, then turn it on — it is
      // the difference between "the jobs table is yours" and "anyone can add to it".
      if (env.STRICT !== "1") {
        statements.push(
          env.DB.prepare(
            `INSERT INTO jobs (job_id, company, title, city, source, first_seen, last_seen, active)
             VALUES (?, ?, ?, ?, 'click', ?, ?, 0)
             ON CONFLICT(job_id) DO NOTHING`
          ).bind(id, clip(body.company) || "unknown", clip(body.title) || "unknown", clip(body.city), now, now)
        );
      }

      statements.push(
        env.DB.prepare(`INSERT INTO clicks (job_id, ts, page, firm, country) VALUES (?, ?, ?, ?, ?)`)
          .bind(id, now, clip(body.page), clip(body.firm), req.cf?.country || null),
        env.DB.prepare(`UPDATE jobs SET clicks = clicks + 1 WHERE job_id = ?`).bind(id)
      );

      // Parameter binding throughout: no value from the request is ever concatenated
      // into SQL.
      await env.DB.batch(statements);
      return new Response(null, { status: 204, headers: cors });
    }

    if (req.method === "GET" && url.pathname === "/counts") {
      // Your numbers, not your visitors'. Without this the whole point of "store it,
      // don't show it" is undone by anyone who opens the endpoint in a browser.
      const auth = req.headers.get("authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("token");
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }

      const { results } = await env.DB.prepare(`SELECT job_id, clicks FROM jobs WHERE clicks > 0`).all();
      return new Response(JSON.stringify(Object.fromEntries(results.map((r) => [r.job_id, r.clicks]))), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
