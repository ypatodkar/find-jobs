// Local dev server: the API and the job data on :4173.
//
//   node scripts/dev-server.js
//
// `npm run dev --prefix web` serves the pages on :5173 and forwards api/* here. This
// server also serves the last build of the pages (web/dist), so :4173 alone shows the
// site as it will be deployed.
//
// It answers the same `api/*.json` URLs that build.js writes as real files, which is
// why the pages fetch one set of relative paths and work both here and on static
// hosting. The payload builders live in scraper/pipeline.js; this file is transport.

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { BOARDS } = require("../scraper/boards");
const { resultsPayload, allJobsPayload, splitJobsPayload, firmPayload } = require("../scraper/pipeline");
const { groupByShard, shardOf } = require("../shared/description");

const ROOT = path.join(__dirname, "..");

// The matching settings, read from .env when it exists. Only these: .env also carries
// a PORT for other tooling, and loading the whole file would move this server.
const MATCH_ENV = ["GOOGLE_CLIENT_ID", "TYPESAFE_API_KEY", "MATCH_HOURLY_BUDGET", "MATCH_DAILY_LIMIT", "MATCH_FEEDBACK_BONUS", "MATCH_FEEDBACK_UNLOCKS", "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSL"];
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && MATCH_ENV.includes(m[1]) && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
} catch { /* no .env: matching answers 503 and everything else works */ }

const PORT = process.env.PORT || 4173;
const RESULTS_FILE = path.join(ROOT, "data", "results.json");
const DESCRIPTIONS_FILE = path.join(ROOT, "data", "descriptions.json");
const SITE = path.join(ROOT, "web", "dist");

// Sharded once per change of descriptions.json rather than per request: grouping
// 12,000 entries on every click would be the slowest thing this server does.
let descCache = { mtime: 0, shards: {}, ids: new Set() };
async function loadDescriptions() {
  try {
    const { mtimeMs } = await fsp.stat(DESCRIPTIONS_FILE);
    if (mtimeMs !== descCache.mtime) {
      const all = JSON.parse(await fsp.readFile(DESCRIPTIONS_FILE, "utf8"));
      descCache = { mtime: mtimeMs, shards: groupByShard(all), ids: new Set(Object.keys(all)) };
    }
  } catch { /* no descriptions.json yet: nothing is described */ }
  return descCache;
}
async function readShard(k) {
  return (await loadDescriptions()).shards[k] || null;
}
const describedIds = async () => (await loadDescriptions()).ids;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

async function readResults() {
  try {
    return JSON.parse(await fsp.readFile(RESULTS_FILE, "utf8"));
  } catch {
    return { scrapedAt: null, firms: {} };
  }
}

function sendJson(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "content-type": MIME[".json"], "content-length": Buffer.byteLength(s) });
  res.end(s);
}

// Only files inside the page build (web/dist). The rest of the project holds .env,
// the data and the server code, none of which a browser should be able to fetch.
function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }
  const full = path.join(SITE, urlPath === "/" ? "index.html" : urlPath);
  if (!full.startsWith(SITE + path.sep)) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  fs.readFile(full, (err, buf) => {
    if (err) {
      const hint = fs.existsSync(SITE) ? "Not found" : "Not found. Build the pages first: npm run build --prefix web (or use npm run dev --prefix web).";
      res.writeHead(404, { "content-type": "text/plain" }).end(hint);
      return;
    }
    // No caching: this is a dev server, and a stale script silently hides new UI.
    res.writeHead(200, {
      "content-type": MIME[path.extname(full)] || "application/octet-stream",
      "cache-control": "no-store, must-revalidate",
    });
    res.end(buf);
  });
}

// `/api/all-jobs` and `/api/all-jobs.json` are the same route; the pages use the
// `.json` form because that is what exists on disk after a build.
const trimJson = (p) => p.replace(/\.json$/, "");

// ---- accounts, sync, resumes and matching ------------------------------------------
//   GET    /api/auth/config                     { clientId } — null when sign-in is off
//   GET    /api/auth/me                         { account } — null when signed out
//   POST   /api/auth/google { credential, visitor, seen, filters }
//   POST   /api/auth/logout
//   GET    /api/sync                            { seen, filters } for the account
//   POST   /api/sync/seen { seen: { job_id: ts } }
//   PUT    /api/sync/filters { items }
//   PUT    /api/sync/saved { items }
//   GET    /api/resumes                         the account's resumes (no text)
//   POST   /api/resumes { visitor, label, fileName, text, file }  file: the original, base64
//   DELETE /api/resumes/<resume id>
//   GET    /api/match?resume=&job=              the stored score, or { match: null }
//   POST   /api/match { resume_id, job_id, title, force }
//   POST   /api/match/feedback { resume_id, job_id, checked_at, rating }
//   GET    /api/match/usage                     today's résumé checks: used, limit, remaining
//   POST   /api/match/unlock { rating, message, job_id }   feedback that unlocks more today
//
// Everything after sign-in is scoped by the session cookie, never by an id the page
// sends. The cookie is HttpOnly (page scripts cannot read it) and SameSite=Lax (other
// sites cannot make the browser send it with a POST); state-changing requests must
// also be JSON, which a cross-site form cannot produce.
//
// Resumes and scores live in Postgres (aws/lambda/*.cjs; the local database is
// findjobs_dev unless PG* variables say otherwise). A stored score is returned as is;
// only a resume and job never scored, or "Check again" (force), call the model.
//
// The description is looked up here by job_id rather than taken from the request, so
// this endpoint only ever scores resumes against jobs on this site — it cannot be used
// as a free proxy to the paid model with arbitrary text.

// The job's stored description and a hash of it: a score is only current while the
// description it was made against is unchanged.
async function jobDescription(jobId) {
  const html = ((await readShard(shardOf(jobId))) || {})[jobId] || "";
  return { html, hash: html ? crypto.createHash("sha256").update(html).digest("hex").slice(0, 32) : null };
}

const { createAccountApi } = require('../aws/lambda/account-api.cjs');
const { handle: handleAccountApi } = createAccountApi({ getDescription: jobDescription });

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const route = trimJson(pathname);

  if (route === "/api/results") {
    return sendJson(res, 200, resultsPayload(await readResults()));
  }

  if (route === "/api/all-jobs") {
    return sendJson(res, 200, allJobsPayload(await readResults(), await describedIds()));
  }

  // The same list in two pieces, newest first, as build.js writes them.
  if (route === "/api/jobs-recent" || route === "/api/jobs-rest") {
    const data = await readResults();
    const { recent, rest } = splitJobsPayload(allJobsPayload(data, await describedIds()), { version: data.scrapedAt });
    return sendJson(res, 200, route === "/api/jobs-recent" ? recent : rest);
  }

  // /api/desc/<shard>.json — the same files build.js writes.
  const desc = /^\/api\/desc\/([0-9a-f]{3})$/.exec(route);
  if (desc) {
    const shard = await readShard(desc[1]);
    return shard ? sendJson(res, 200, shard) : sendJson(res, 404, { error: "No descriptions in that shard" });
  }

  if (/^\/api\/(auth|sync|resumes|match)(\/|$)/.test(route)) {
    try {
      const [status, body, headers] = await handleAccountApi(req, route, new URL(req.url, "http://localhost").searchParams);
      const s = JSON.stringify(body);
      res.writeHead(status, { "content-type": MIME[".json"], "content-length": Buffer.byteLength(s), "cache-control": "no-store", ...(headers || {}) });
      return res.end(s);
    } catch (err) {
      if (!err.status) console.error("api:", err);
      return sendJson(res, err.status || 500, { error: err.status ? err.message : "Something went wrong. Please try again.", ...(err.code ? { code: err.code } : {}), ...(err.usage ? { usage: err.usage } : {}) });
    }
  }

  // /api/firm/<id>.json, plus the older /api/firm?id=<id> form.
  if (route === "/api/firm" || route.startsWith("/api/firm/")) {
    const id = route.startsWith("/api/firm/")
      ? decodeURIComponent(route.slice("/api/firm/".length))
      : new URL(req.url, "http://localhost").searchParams.get("id");
    const payload = firmPayload(await readResults(), id, await describedIds());
    if (!payload) return sendJson(res, 404, { error: "No scraped data for that firm yet" });
    return sendJson(res, 200, payload);
  }

  return serveStatic(req, res);
});

// This machine only. Bound to every interface, anyone on the same network could use
// the paid matching endpoint and the database behind it. HOST=0.0.0.0 opts back in,
// e.g. to test from a phone on the same Wi-Fi.
const HOST = process.env.HOST || "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log(`Find Jobs API and data at http://localhost:${PORT}`);
  console.log(`Scrapeable boards: ${Object.values(BOARDS).filter((b) => b.platform).length}`);
});
