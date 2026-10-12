// Local dev server. Read payload builders live in `src/pipeline.js`, shared with the
// static CI build, so this file is only transport.
//
// It answers the same `api/*.json` URLs that `build.js` writes as real files, which is
// why the pages can fetch one set of relative paths and work both here and on static
// hosting with no branching.

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { BOARDS } = require("../src/boards");
const { resultsPayload, allJobsPayload, firmPayload } = require("../src/pipeline");

const PORT = process.env.PORT || 4173;
const REPO = path.join(__dirname, "..");
const RESULTS_FILE = path.join(REPO, "results.json");

// Static files are served from public/ and nowhere else, which is the same set
// build.js ships. Rooting the server at the repo instead — as it used to — meant a
// request for /.env or /src/scraper.js was answered, on a server bound to localhost
// but still a wider door than the deployed site has.
const PUBLIC = path.join(REPO, "public");

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
  res.writeHead(code, { "content-type": MIME[".json"], "content-length": Buffer.byteLength(s) });
  res.end(s);
}

/**
 * The decoded path of a request, or null if the request line is not something a URL
 * parser accepts. Both steps throw on input a client can send by hand: `GET //` parses
 * as a protocol-relative URL with no host, and `GET /%E0%A4` is an incomplete escape.
 * Unguarded, either one rejects inside the async handler and takes the whole server
 * down — a dev server that dies on a stray request looks like a bug in the page.
 */
function requestPath(raw) {
  try {
    return decodeURIComponent(new URL(raw, "http://localhost").pathname);
  } catch {
    return null;
  }
}

function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const full = path.join(PUBLIC, rel);

  // Keep traversal inside the published directory.
  if (!full.startsWith(PUBLIC + path.sep)) {
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

const server = http.createServer(async (req, res) => {
  const pathname = requestPath(req.url);
  if (pathname === null) {
    res.writeHead(400, { "content-type": "text/plain" }).end("Bad request");
    return;
  }
  const route = trimJson(pathname);

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

  return serveStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log(`VC job directory running at http://localhost:${PORT}`);
  console.log(`Scrapeable boards: ${Object.values(BOARDS).filter((b) => b.platform).length}`);
});
