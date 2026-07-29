// Local dev server. The scrape itself and the read payloads live in `pipeline.js`,
// shared with the headless CI path, so this file is only transport.
//
// It answers the same `api/*.json` URLs that `build.js` writes as real files, which is
// why the pages can fetch one set of relative paths and work both here and on static
// hosting with no branching.

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { BOARDS } = require("./boards");
const { runScrape, resultsPayload, allJobsPayload, firmPayload } = require("./pipeline");

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

let refreshing = false;

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

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const full = path.join(ROOT, rel);

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

// Streams one SSE event per firm so the UI can show live progress.
async function handleRefresh(req, res) {
  if (refreshing) {
    sendJson(res, 409, { error: "A refresh is already running" });
    return;
  }
  refreshing = true;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });

  try {
    const results = await runScrape((event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });
    await fsp.writeFile(RESULTS_FILE, JSON.stringify(results, null, 2));
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ reason: err.message })}\n\n`);
  } finally {
    res.end();
    refreshing = false;
  }
}

// `/api/all-jobs` and `/api/all-jobs.json` are the same route; the pages use the
// `.json` form because that is what exists on disk after a build.
const trimJson = (p) => p.replace(/\.json$/, "");

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const route = trimJson(pathname);

  if (route === "/api/refresh") return handleRefresh(req, res);

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
});

server.listen(PORT, () => {
  console.log(`VC job directory running at http://localhost:${PORT}`);
  console.log(`Scrapeable boards: ${Object.values(BOARDS).filter((b) => b.platform).length}`);
});
