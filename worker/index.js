// Click collector.
//   POST /click    record one click             (called by track.js via sendBeacon)
//   POST /filter   record a saved/applied view  (called by presets.js)
//   POST /like     one-way heart, per browser
//   GET  /stats    public totals for the header counter
//   POST /feedback record feedback from the widget, and email it on
//   GET  /counts   { job_id: clicks, ... }      (private — needs ADMIN_TOKEN)
//
// Threat model for /click: it's a public write endpoint on the open internet. Its URL
// is in the page source of a site you hand to friends, so assume it is known. There
// are no credentials and no personal data behind it; the realistic abuse is someone
// spamming writes to skew the numbers or to burn the D1 free-tier write quota, and
// the guards below are sized for that rather than for a determined attacker.

// Every id the scraper generates matches this (verified against a full 5,022-role
// scrape). Anything else is not a job id we ever issued.
// A user id is a UUID the browser minted for itself — there is no sign-in. Validated
// strictly so the column can never hold anything but a UUID, and never used for
// anything but grouping that browser's own events together.
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function userIdOf(body) {
  const v = String(body.user_id || "");
  return USER_ID_RE.test(v) ? v : null;
}

// Upsert on every event so `last_seen` stays current and a name typed later lands.
// A null name never overwrites a stored one — skipping now and naming later works,
// and naming now then skipping later does not wipe it.
function touchUser(env, userId, name, country, now) {
  return env.DB.prepare(
    `INSERT INTO users (user_id, name, first_seen, last_seen, country)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       last_seen = excluded.last_seen,
       name      = COALESCE(excluded.name, users.name),
       country   = COALESCE(excluded.country, users.country)`
  ).bind(userId, name, now, now, country);
}

const JOB_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}_(ashby|greenhouse|lever|vc)_[a-z0-9-]{1,64}$/;

const MAX_TEXT = 200;
const clip = (v) => (v == null ? null : String(v).slice(0, MAX_TEXT));

// Anything else submitted as a topic is filed as "other" rather than rejected — a
// changed dropdown on the site should never start dropping feedback on the floor.
const TOPICS = ["jobs", "filters", "design", "bug", "other"];
const TOPIC_LABELS = {
  jobs: "More jobs / companies",
  filters: "Filters & search",
  design: "Design & layout",
  bug: "Something is broken",
  other: "Something else",
};

const escapeHtml = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Email one feedback row. Returns true only if Resend accepted it.
 *
 * Never throws: every caller treats email as best-effort, because the row is already
 * safely in D1 by the time this runs. With no RESEND_API_KEY set the whole feature
 * still works, it just collects silently in the database.
 */
async function sendFeedbackEmail(env, f) {
  if (!env.RESEND_API_KEY || !env.FEEDBACK_TO) return false;

  const label = TOPIC_LABELS[f.topic] || f.topic;
  const who = f.name ? `${f.name}` : "someone";
  const rows = [
    ["Topic", label],
    ["From", f.name || "(no name given)"],
    ["Reply to", f.contact || "(not provided)"],
    ["Browser id", f.userId || "(none)"],
    ["Page", f.page || "(unknown)"],
    ["Country", f.country || "(unknown)"],
  ];

  const html =
    `<div style="font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#211b29">` +
    `<p style="margin:0 0 14px;font-size:13px;color:#6b6275">Feedback #${f.id ?? "?"} · Find Jobs</p>` +
    `<blockquote style="margin:0 0 18px;padding:12px 16px;background:#faf9fc;border-left:3px solid #6d28d9;` +
    `border-radius:0 6px 6px 0;white-space:pre-wrap">${escapeHtml(f.message)}</blockquote>` +
    `<table style="border-collapse:collapse;font-size:13px">` +
    rows.map(([k, v]) =>
      `<tr><td style="padding:3px 14px 3px 0;color:#6b6275">${escapeHtml(k)}</td>` +
      `<td style="padding:3px 0">${escapeHtml(v)}</td></tr>`).join("") +
    `</table></div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: env.FEEDBACK_FROM || "Find Jobs <onboarding@resend.dev>",
        to: [env.FEEDBACK_TO],
        subject: `[Find Jobs] ${label} — from ${who}`,
        html,
        text: `${label}\n\n${f.message}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
        // So hitting reply in the mail client goes to them, when they left an address.
        ...(f.contact && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.contact) ? { reply_to: f.contact } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false; // stored in D1 regardless; emailed_at stays NULL
  }
}

function corsFor(req, env) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.get("origin");

  // No allowlist configured: stay permissive so a fresh deploy works, and rely on the
  // other guards. Set ALLOWED_ORIGINS once you know your site's URL.
  if (!allowed.length) return { "access-control-allow-origin": "*", vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    return { "access-control-allow-origin": origin, vary: "Origin" };
  }
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
      const userId = userIdOf(body);
      const statements = [];
      if (userId) statements.push(touchUser(env, userId, clip(body.user_name), req.cf?.country || null, now));

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
        env.DB.prepare(`INSERT INTO clicks (job_id, user_id, ts, page, firm, country) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(id, userId, now, clip(body.page), clip(body.firm), req.cf?.country || null),
        env.DB.prepare(`UPDATE jobs SET clicks = clicks + 1 WHERE job_id = ?`).bind(id)
      );

      // Parameter binding throughout: no value from the request is ever concatenated
      // into SQL.
      await env.DB.batch(statements);
      return new Response(null, { status: 204, headers: cors });
    }

    // Filter activity. Same shape and same defences as /click: origin-checked, all
    // values bound, body size capped by `clip`. Deliberately stores no identifier —
    // which slices are popular is a product question, not a per-person one.
    if (req.method === "POST" && url.pathname === "/filter") {
      if (!cors) return new Response(null, { status: 403 });

      let body;
      try {
        body = JSON.parse(await req.text());
      } catch {
        return new Response(null, { status: 400, headers: cors });
      }

      const action = String(body.action || "");
      if (action !== "save" && action !== "apply") {
        return new Response(null, { status: 400, headers: cors });
      }

      // Cap the stored JSON so a crafted body can't be used to bloat the table.
      let filters = null;
      try {
        filters = JSON.stringify(body.filters || {}).slice(0, 2000);
      } catch {
        filters = null;
      }

      const fnow = Date.now();
      const fUserId = userIdOf(body);
      const stmts = [];
      if (fUserId) stmts.push(touchUser(env, fUserId, clip(body.user_name), req.cf?.country || null, fnow));
      stmts.push(
        env.DB.prepare(
          `INSERT INTO filter_events (user_id, ts, action, name, filters, page, firm, country)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(fUserId, fnow, action, clip(body.name), filters, clip(body.page), clip(body.firm), req.cf?.country || null)
      );
      await env.DB.batch(stmts);

      return new Response(null, { status: 204, headers: cors });
    }

    // One-way, one-per-browser. COALESCE keeps the first like's timestamp, so a
    // repeat tap is a no-op rather than a fresh row or a moved date — the heart is
    // "I liked this", not a counter to farm.
    if (req.method === "POST" && url.pathname === "/like") {
      if (!cors) return new Response(null, { status: 403 });

      let body;
      try {
        body = JSON.parse(await req.text());
      } catch {
        return new Response(null, { status: 400, headers: cors });
      }

      const userId = userIdOf(body);
      if (!userId) return new Response(null, { status: 400, headers: cors });

      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO users (user_id, name, first_seen, last_seen, country, liked_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           last_seen = excluded.last_seen,
           name      = COALESCE(excluded.name, users.name),
           country   = COALESCE(excluded.country, users.country),
           liked_at  = COALESCE(users.liked_at, excluded.liked_at)`
      )
        .bind(userId, clip(body.user_name), now, now, req.cf?.country || null, now)
        .run();

      return new Response(null, { status: 204, headers: cors });
    }

    // Feedback from the widget in the page corner.
    //
    // Stored first, emailed second, and the email is deliberately not allowed to fail
    // the request: a bad API key or a Resend outage should cost a notification, never
    // someone's typed-out complaint. `emailed_at` marks which rows actually went out,
    // so the ones that didn't can be found later with
    //   SELECT * FROM feedback WHERE emailed_at IS NULL
    if (req.method === "POST" && url.pathname === "/feedback") {
      if (!cors) return new Response(null, { status: 403 });

      let body;
      try {
        body = JSON.parse(await req.text());
      } catch {
        return new Response(null, { status: 400, headers: cors });
      }

      // The message is the whole point, so it gets a far larger cap than `clip`'s 200 —
      // but still a cap, because this is an unauthenticated write endpoint.
      const message = String(body.message || "").trim().slice(0, 4000);
      if (message.length < 2) return new Response(null, { status: 400, headers: cors });

      const topic = TOPICS.includes(body.topic) ? body.topic : "other";
      const now = Date.now();
      const userId = userIdOf(body);
      const name = clip(body.user_name);
      const contact = clip(body.contact);
      const country = req.cf?.country || null;
      const page = clip(body.page);

      const row = await env.DB.prepare(
        `INSERT INTO feedback (user_id, name, topic, message, contact, page, country, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
        .bind(userId, name, topic, message, contact, page, country, now)
        .first();

      const sent = await sendFeedbackEmail(env, {
        id: row?.id, topic, message, name, contact, userId, page, country,
      });
      if (sent && row?.id) {
        await env.DB.prepare(`UPDATE feedback SET emailed_at = ? WHERE id = ?`).bind(Date.now(), row.id).run();
      }

      // 204 either way. From the reader's side the feedback is safely recorded, which
      // is true; whether the email left is our problem, not theirs.
      return new Response(null, { status: 204, headers: cors });
    }

    // Public aggregate for the counter in the site header. Deliberately totals only —
    // the per-job breakdown stays behind /counts and ADMIN_TOKEN. Origin-checked like
    // the write routes, and edge-cached so a busy page never becomes D1 load.
    if (req.method === "GET" && url.pathname === "/stats") {
      if (!cors) return new Response(null, { status: 403 });
      const row = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM clicks) AS clicks,
                (SELECT COUNT(DISTINCT job_id) FROM clicks) AS jobs,
                (SELECT COUNT(*) FROM users) AS users,
                (SELECT COUNT(*) FROM users WHERE liked_at IS NOT NULL) AS likes`
      ).first();
      return new Response(JSON.stringify(row || { clicks: 0, jobs: 0, users: 0 }), {
        headers: { ...cors, "content-type": "application/json", "cache-control": "public, max-age=300" },
      });
    }

    if (req.method === "GET" && url.pathname === "/counts") {
      // Your numbers, not your users'. Without this the whole point of "store it,
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
