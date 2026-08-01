// Click collector, plus accounts.
//   POST /click                    record one click        (called by track.js via sendBeacon)
//   POST /filter                   record a saved/applied view (called by presets.js)
//   POST /like                     one-way heart, per browser
//   GET  /stats                    public totals for the header counter
//   GET  /counts                   { job_id: clicks, ... } (private — needs ADMIN_TOKEN)
//   GET  /auth/:provider/start     redirect to GitHub/Google's consent screen
//   GET  /auth/:provider/callback  exchange the code, open a session, redirect back to the site
//   GET  /auth/me                  { user: {...} | null } for the current session cookie
//   POST /auth/logout              end the session
//   GET  /auth/seen                the signed-in user's server-side "seen" map (see track.js)
//   POST /auth/seen                merge a browser's local "seen" map into the server's copy
//
// Threat model for /click: it's a public write endpoint on the open internet. Its URL
// is in the page source of a site you hand to friends, so assume it is known. There
// are no credentials and no personal data behind it; the realistic abuse is someone
// spamming writes to skew the numbers or to burn the D1 free-tier write quota, and
// the guards below are sized for that rather than for a determined attacker.
//
// Threat model for /auth/*: sessions are opaque random tokens checked against the
// `sessions` table on every request (not signed/decoded), so revoking one is just
// deleting the row. The OAuth `state` param round-trips through a short-lived cookie
// to stop CSRF on the callback. `return_to` only ever accepts a same-site path, never
// a full URL, so the callback can't be turned into an open redirect.

// Every id the scraper generates matches this (verified against a full 5,022-role
// scrape). Anything else is not a job id we ever issued.
// A visitor id is a UUID the browser minted for itself. Validated strictly so the
// column can never hold anything but a UUID, and never used for anything but grouping
// that browser's own events together.
const VISITOR_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function visitorOf(body) {
  const v = String(body.visitor_id || "");
  return VISITOR_RE.test(v) ? v : null;
}

// Upsert on every event so `last_seen` stays current and a name typed later lands.
// A null name never overwrites a stored one — skipping now and naming later works,
// and naming now then skipping later does not wipe it.
function touchVisitor(env, visitorId, name, country, now) {
  return env.DB.prepare(
    `INSERT INTO visitors (visitor_id, name, first_seen, last_seen, country)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(visitor_id) DO UPDATE SET
       last_seen = excluded.last_seen,
       name      = COALESCE(excluded.name, visitors.name),
       country   = COALESCE(excluded.country, visitors.country)`
  ).bind(visitorId, name, now, now, country);
}

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
  // Credentials (the session cookie) only ever ride on a request from a named origin —
  // "*" plus credentials is invalid CORS and browsers refuse it outright.
  if (origin && allowed.includes(origin)) {
    return { "access-control-allow-origin": origin, vary: "Origin", "access-control-allow-credentials": "true" };
  }
  return null; // caller rejects
}

// ---- accounts ---------------------------------------------------------------------

const PROVIDERS = {
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    clientIdKey: "GITHUB_CLIENT_ID",
    clientSecretKey: "GITHUB_CLIENT_SECRET",
    async fetchProfile(accessToken) {
      const res = await fetch("https://api.github.com/user", {
        headers: { authorization: `Bearer ${accessToken}`, "user-agent": "vcjobs-directory", accept: "application/json" },
      });
      const p = await res.json();
      return { providerUserId: String(p.id), name: p.name || p.login || null, email: p.email || null, avatarUrl: p.avatar_url || null };
    },
  },
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    extraAuthorizeParams: { response_type: "code" },
    clientIdKey: "GOOGLE_CLIENT_ID",
    clientSecretKey: "GOOGLE_CLIENT_SECRET",
    async fetchProfile(accessToken) {
      const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      const p = await res.json();
      return { providerUserId: String(p.sub), name: p.name || null, email: p.email || null, avatarUrl: p.picture || null };
    },
  },
};

function parseCookies(req) {
  const header = req.headers.get("cookie") || "";
  const out = {};
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

// Domain left unset works fine on a *.workers.dev deploy, but the session cookie is
// then third-party relative to your site and browsers increasingly block those. Put
// the Worker on a custom subdomain of your site (Cloudflare dashboard: Workers & Pages
// -> this worker -> Settings -> Domains & Routes) and set COOKIE_DOMAIN to match — see
// worker/wrangler.toml.
function setCookie(name, value, { maxAgeSeconds, env }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "Secure", "HttpOnly", "SameSite=Lax"];
  if (env.COOKIE_DOMAIN) parts.push(`Domain=${env.COOKIE_DOMAIN}`);
  parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join("; ");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Where the OAuth callback sends the browser back to. env.SITE_ORIGIN is the one
// source of truth for that (falls back to the first ALLOWED_ORIGINS entry so a fresh
// deploy still works); the caller-supplied `return_to` is trusted only as a *path*,
// never a full URL, so this can't be turned into an open redirect.
function siteOrigin(env) {
  return env.SITE_ORIGIN || (env.ALLOWED_ORIGINS || "").split(",")[0].trim() || "/";
}

function sanitizeReturnTo(raw) {
  if (!raw || typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/"; // "//host/x" is protocol-relative, i.e. off-site
  return raw.slice(0, 200);
}

async function currentUser(req, env) {
  const token = parseCookies(req).session;
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.name, u.avatar_url AS avatarUrl, u.provider FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).bind(token, Date.now()).first();
}

async function handleAuthStart(req, env, provider) {
  const cfg = PROVIDERS[provider];
  const clientId = cfg && env[cfg.clientIdKey];
  if (!clientId) return new Response("Provider not configured", { status: 501 });

  const url = new URL(req.url);
  const state = randomToken();
  const authorize = new URL(cfg.authorizeUrl);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", `${url.origin}/auth/${provider}/callback`);
  authorize.searchParams.set("scope", cfg.scope);
  authorize.searchParams.set("state", state);
  Object.entries(cfg.extraAuthorizeParams || {}).forEach(([k, v]) => authorize.searchParams.set(k, v));

  const headers = new Headers({ location: authorize.toString() });
  // state:return_to, both server-generated or already sanitized — safe to join on ":".
  headers.append(
    "set-cookie",
    setCookie("oauth_state", `${state}:${sanitizeReturnTo(url.searchParams.get("return_to"))}`, { maxAgeSeconds: 600, env })
  );
  return new Response(null, { status: 302, headers });
}

async function handleAuthCallback(req, env, provider) {
  const cfg = PROVIDERS[provider];
  const clientId = cfg && env[cfg.clientIdKey];
  const clientSecret = cfg && env[cfg.clientSecretKey];
  if (!clientId || !clientSecret) return new Response("Provider not configured", { status: 501 });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const saved = parseCookies(req).oauth_state || "";
  const sep = saved.indexOf(":");
  const savedState = sep === -1 ? saved : saved.slice(0, sep);
  const returnTo = sep === -1 ? "/" : saved.slice(sep + 1);

  const clearState = setCookie("oauth_state", "", { maxAgeSeconds: 0, env });
  if (!code || !state || !savedState || state !== savedState) {
    return new Response("Invalid or expired sign-in attempt — go back and try again.", {
      status: 400,
      headers: { "set-cookie": clearState },
    });
  }

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${url.origin}/auth/${provider}/callback`,
      grant_type: "authorization_code",
    }),
  });
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenBody.access_token) {
    return new Response("Sign-in failed while contacting " + provider + ".", { status: 502, headers: { "set-cookie": clearState } });
  }

  const profile = await cfg.fetchProfile(tokenBody.access_token);
  const now = Date.now();

  const existing = await env.DB.prepare(`SELECT id FROM users WHERE provider = ? AND provider_user_id = ?`)
    .bind(provider, profile.providerUserId)
    .first();

  const userId = existing ? existing.id : randomToken();
  if (existing) {
    await env.DB.prepare(`UPDATE users SET name = ?, email = ?, avatar_url = ? WHERE id = ?`)
      .bind(profile.name, profile.email, profile.avatarUrl, userId)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO users (id, provider, provider_user_id, email, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, provider, profile.providerUserId, profile.email, profile.name, profile.avatarUrl, now).run();
  }

  const sessionTtl = 60 * 60 * 24 * 90; // 90 days
  const sessionToken = randomToken();
  await env.DB.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(sessionToken, userId, now, now + sessionTtl * 1000)
    .run();

  const headers = new Headers({ location: new URL(returnTo, siteOrigin(env)).toString() });
  headers.append("set-cookie", clearState);
  headers.append("set-cookie", setCookie("session", sessionToken, { maxAgeSeconds: sessionTtl, env }));
  return new Response(null, { status: 302, headers });
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
      const visitor = visitorOf(body);
      const statements = [];
      if (visitor) statements.push(touchVisitor(env, visitor, clip(body.visitor_name), req.cf?.country || null, now));

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
        env.DB.prepare(`INSERT INTO clicks (job_id, visitor_id, ts, page, firm, country) VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(id, visitor, now, clip(body.page), clip(body.firm), req.cf?.country || null),
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
      const fvisitor = visitorOf(body);
      const stmts = [];
      if (fvisitor) stmts.push(touchVisitor(env, fvisitor, clip(body.visitor_name), req.cf?.country || null, fnow));
      stmts.push(
        env.DB.prepare(
          `INSERT INTO filter_events (visitor_id, ts, action, name, filters, page, firm, country)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(fvisitor, fnow, action, clip(body.name), filters, clip(body.page), clip(body.firm), req.cf?.country || null)
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

      const visitor = visitorOf(body);
      if (!visitor) return new Response(null, { status: 400, headers: cors });

      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO visitors (visitor_id, name, first_seen, last_seen, country, liked_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(visitor_id) DO UPDATE SET
           last_seen = excluded.last_seen,
           name      = COALESCE(excluded.name, visitors.name),
           country   = COALESCE(excluded.country, visitors.country),
           liked_at  = COALESCE(visitors.liked_at, excluded.liked_at)`
      )
        .bind(visitor, clip(body.visitor_name), now, now, req.cf?.country || null, now)
        .run();

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
                (SELECT COUNT(*) FROM visitors) AS visitors,
                (SELECT COUNT(*) FROM visitors WHERE liked_at IS NOT NULL) AS likes`
      ).first();
      return new Response(JSON.stringify(row || { clicks: 0, jobs: 0, visitors: 0 }), {
        headers: { ...cors, "content-type": "application/json", "cache-control": "public, max-age=300" },
      });
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

    // /auth/github/start, /auth/google/callback, etc.
    const authMatch = url.pathname.match(/^\/auth\/(github|google)\/(start|callback)$/);
    if (authMatch) {
      const [, provider, step] = authMatch;
      return step === "start" ? handleAuthStart(req, env, provider) : handleAuthCallback(req, env, provider);
    }

    if (req.method === "GET" && url.pathname === "/auth/me") {
      if (!cors) return new Response(null, { status: 403 });
      const user = await currentUser(req, env);
      return new Response(
        JSON.stringify({ user: user ? { id: user.id, name: user.name, avatarUrl: user.avatarUrl, provider: user.provider } : null }),
        { headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } }
      );
    }

    if (req.method === "POST" && url.pathname === "/auth/logout") {
      if (!cors) return new Response(null, { status: 403 });
      const token = parseCookies(req).session;
      if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
      const headers = new Headers(cors);
      headers.append("set-cookie", setCookie("session", "", { maxAgeSeconds: 0, env }));
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/auth/seen") {
      if (!cors) return new Response(null, { status: 403 });
      const user = await currentUser(req, env);
      if (!user) return new Response(null, { status: 401, headers: cors });

      if (req.method === "GET") {
        const { results } = await env.DB.prepare(`SELECT job_id, first_seen FROM seen_jobs WHERE user_id = ?`)
          .bind(user.id)
          .all();
        return new Response(JSON.stringify(Object.fromEntries(results.map((r) => [r.job_id, r.first_seen]))), {
          headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
        });
      }

      if (req.method === "POST") {
        let body;
        try {
          body = JSON.parse(await req.text());
        } catch {
          return new Response(null, { status: 400, headers: cors });
        }
        // Same MAX_ENTRIES ceiling as track.js's local store, so one sync can never
        // exceed what a single browser could have accumulated.
        const statements = Object.entries(body || {})
          .slice(0, 5000)
          .filter(([id, ts]) => typeof id === "string" && id.length <= 80 && Number.isFinite(Number(ts)))
          .map(([id, ts]) =>
            env.DB.prepare(
              `INSERT INTO seen_jobs (user_id, job_id, first_seen) VALUES (?, ?, ?)
               ON CONFLICT(user_id, job_id) DO UPDATE SET first_seen = MIN(first_seen, excluded.first_seen)`
            ).bind(user.id, id, Number(ts))
          );
        if (statements.length) await env.DB.batch(statements);
        return new Response(null, { status: 204, headers: cors });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};
