// Local dev server. Read payload builders live in `pipeline.js`, shared with the
// static CI build, so this file is only transport.
//
// It answers the same `api/*.json` URLs that `build.js` writes as real files, which is
// why the pages can fetch one set of relative paths and work both here and on static
// hosting with no branching.

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { BOARDS } = require("./boards");
const { resultsPayload, allJobsPayload, firmPayload } = require("./pipeline");
const { MemoryCatalogue } = require("./aws/lambda/catalogue.cjs");
const { route: catalogueRoute, parseBody } = require("./aws/lambda/catalogue-api.cjs");
const { catalogueData } = require("./catalogue-export");

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const RESULTS_FILE = path.join(ROOT, "results.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
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
  res.writeHead(code, { "content-type": MIME[".json"], "content-length": Buffer.byteLength(s), "cache-control": "no-store" });
  res.end(s);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const full = path.join(ROOT, rel);

  // In particular, never serve .env, database exports, or the ingestion artifact.
  if (rel.split('/').some(part => part.startsWith('.')) || /^(aws|worker|backups|test|migrations)\//.test(rel) ||
      !/\.(html|css|js|svg|png|woff2|txt|xml|json)$/.test(rel) || (rel.endsWith('.json') && rel !== 'featured.json')) {
    res.writeHead(404).end('Not found'); return;
  }

  // Keep traversal inside the project directory.
  if (!full.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
      return;
    }
    // No caching: this is a dev server you edit live, and a stale app.js or
    // styles.css silently hides newly added UI.
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

let catalogue, catalogueMtime;
async function localCatalogue() {
  let mtime;
  try { mtime = (await fsp.stat(RESULTS_FILE)).mtimeMs; } catch { mtime = 0; }
  if (!catalogue || mtime !== catalogueMtime) {
    const t0 = Date.now();
    const { data, metadata } = catalogueData(await readResults());
    const next = new MemoryCatalogue(data, metadata);
    if (process.env.DEBUG_SERVER === '1') {
      console.log(`[catalogue] rebuilt from results.json in ${Date.now() - t0}ms (${next.jobs.length} jobs)`);
    }
    // Preserve matching limits and valid content-addressed cache entries on refresh.
    if (catalogue) { next.cache = catalogue.cache; next.quotas = catalogue.quotas; }
    catalogue = next; catalogueMtime = mtime;
  }
  return catalogue;
}
// Development logging. Off unless DEBUG_SERVER=1, because the normal case is a quiet
// static server and a line per asset would bury anything worth seeing.
//
// Two things are recorded rather than one. Request timing says how long a handler took;
// event-loop lag says whether it took that long *while blocking everything else*. A
// slow request that yields is fine. A slow request that pins the loop makes the whole
// site unreachable, and the two are indistinguishable from the outside.
const DEBUG = process.env.DEBUG_SERVER === '1';
let lagMax = 0;
if (DEBUG) {
  let last = Date.now();
  setInterval(() => {
    const drift = Date.now() - last - 250;
    if (drift > lagMax) lagMax = drift;
    // Report each stall as it happens, not just in the request summary. One 79s block
    // and three hundred 250ms stalls produce the same maximum and need opposite fixes.
    if (drift > 400) console.log(`[loop] stalled ${drift}ms at ${new Date().toISOString().slice(11, 23)}`);
    last = Date.now();
  }, 250).unref();
}
const logReq = (req, status, started, note) => {
  if (!DEBUG) return;
  const ms = Date.now() - started;
  const lag = lagMax; lagMax = 0;
  console.log(`[req] ${String(status).padEnd(3)} ${String(ms).padStart(6)}ms  loop-lag ${String(lag).padStart(5)}ms  ${req.method} ${req.url.slice(0, 48)}${note ? '  ' + note : ''}`);
};

function createServer(getCatalogue = localCatalogue) {
return http.createServer(async (req, res) => {
 const started = Date.now();
 res.on('finish', () => logReq(req, res.statusCode, started));
 try {
  const { pathname } = new URL(req.url, "http://localhost");
  const route = trimJson(pathname);

  if (pathname.startsWith('/api/jobs/') || pathname === '/api/matches' || pathname.startsWith('/api/traces')) {
    if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed.' });
    const origin = req.headers.origin;
    if (req.method === 'POST' && origin && new URL(origin).host !== req.headers.host) {
      return sendJson(res, 403, { error: 'Origin not allowed.' });
    }
    let bytes = 0; const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 1048576) return sendJson(res, 413, { error: 'Request is too large.' });
      chunks.push(chunk);
    }
    const body = parseBody(Buffer.concat(chunks).toString('utf8'));
    const url = new URL(req.url, 'http://localhost');
    const auth = req.headers.authorization || '';
    const result = await catalogueRoute(await getCatalogue(), req.method, pathname.slice(4), body, req.socket.remoteAddress,
      { token: auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token'),
        query: Object.fromEntries(url.searchParams) });
    return sendJson(res, 200, result);
  }

  if (route === "/api/results") {
    return sendJson(res, 200, resultsPayload(await readResults()));
  }

  if (route === "/api/all-jobs") {
    return sendJson(res, 200, allJobsPayload(await readResults()));
  }

  // /api/firm/<id>.json, plus the older /api/firm?id=<id> form.
  if (route === "/api/firm" || route.startsWith("/api/firm/")) {
    const id = route.startsWith("/api/firm/")
      ? decodeURIComponent(route.slice("/api/firm/".length))
      : new URL(req.url, "http://localhost").searchParams.get("id");
    const payload = firmPayload(await readResults(), id);
    if (!payload) return sendJson(res, 404, { error: "No scraped data for that firm yet" });
    return sendJson(res, 200, payload);
  }

  return serveStatic(req, res);
 } catch (error) {
   return sendJson(res, error.status || 500, { error: error.status ? error.message : 'The job service is temporarily unavailable.' });
 }
});
}

if (require.main === module) createServer().listen(PORT, () => {
  console.log(`VC job directory running at http://localhost:${PORT}`);
  console.log(`Scrapeable boards: ${Object.values(BOARDS).filter((b) => b.platform).length}`);
});
module.exports = { createServer };
