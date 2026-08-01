// Builds the deployable static site into dist/.
//
//   node build.js
//
// Turns the three read endpoints server.js answers dynamically into real files at the
// same relative paths, so the pages need no code change between local and hosted:
//
//   dist/api/results.json
//   dist/api/all-jobs.json
//   dist/api/firm/<id>.json      (one per firm, including the unscrapeable ones)
//
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { BOARDS } = require("./boards");
const { resultsPayload, allJobsPayload, firmPayload } = require("./pipeline");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");
const RESULTS_FILE = path.join(ROOT, "results.json");

// Everything the browser needs. Server-side files (pipeline, scraper, ats, …) are
// deliberately absent — shipping them would put the scrape internals on the public site.
const ASSETS = [
  "index.html", "firms.html", "firm.html",
  "styles.css", "og.png", "robots.txt", "sitemap.xml", "404.html",
  "fonts/geist-sans-400.woff2", "fonts/geist-sans-500.woff2",
  "fonts/geist-sans-600.woff2", "fonts/geist-sans-700.woff2",
  "data.js", "jobs-ui.js", "presets.js", "all.js", "app.js", "firm.js", "track.js", "visitor.js", "viewed.js", "counter.js", "auth.js",
];

async function writeJson(rel, body) {
  const full = path.join(DIST, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, JSON.stringify(body));
  return Buffer.byteLength(JSON.stringify(body));
}

async function main() {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error("No results.json — run `node scrape.js` first.");
    process.exit(1);
  }
  const data = JSON.parse(await fsp.readFile(RESULTS_FILE, "utf8"));

  await fsp.rm(DIST, { recursive: true, force: true });
  await fsp.mkdir(DIST, { recursive: true });

  // --- static assets ---
  const missing = [];
  for (const rel of ASSETS) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) {
      missing.push(rel);
      continue;
    }
    const destination = path.join(DIST, rel);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.copyFile(src, destination);
  }
  if (missing.length) {
    console.error(`Missing asset(s), refusing to build a broken site: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Tells GitHub Pages not to run the output through Jekyll, which would drop any
  // file or directory beginning with an underscore.
  await fsp.writeFile(path.join(DIST, ".nojekyll"), "");

  // --- data ---
  let bytes = 0;
  bytes += await writeJson("api/results.json", resultsPayload(data));
  bytes += await writeJson("api/all-jobs.json", allJobsPayload(data));

  let firmCount = 0;
  for (const id of Object.keys(BOARDS)) {
    const payload = firmPayload(data, id);
    if (!payload) continue;
    bytes += await writeJson(`api/firm/${id}.json`, payload);
    firmCount++;
  }

  const jobs = allJobsPayload(data).jobs.length;
  console.log(`dist/ built — ${ASSETS.length} assets, ${firmCount} firm files, ${jobs} roles`);
  console.log(`data: ${(bytes / 1048576).toFixed(2)} MB uncompressed (hosts serve it gzipped)`);
  console.log(`scrapedAt: ${data.scrapedAt}`);
}

main().catch((err) => {
  console.error("Build failed:", err.message);
  process.exit(1);
});
