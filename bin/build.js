// Builds the deployable static site into dist/.
//
//   node bin/build.js
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
const { BOARDS } = require("../src/boards");
const { resultsPayload, allJobsPayload, firmPayload } = require("../src/pipeline");

const REPO = path.join(__dirname, "..");
const DIST = path.join(REPO, "dist");
const RESULTS_FILE = path.join(REPO, "results.json");

// public/ is the site, copied wholesale and at the same relative paths the dev server
// answers. It used to be a hand-maintained list here, which existed to keep server-side
// files (pipeline, scraper, ats, …) off the public site — the directory now guarantees
// that by construction, so adding a page no longer means remembering to edit this file.
//
// This merge is the argument for it: the résumé-matching work added five browser files
// and a page, and had to edit the list to ship them. Under public/ it needs no edit.
const PUBLIC = path.join(REPO, "public");

// What the list did still earn: refusing to publish a site with a hole in it. A copy of
// a directory cannot notice a file someone deleted, so the pages and the stylesheet are
// named and checked. Anything else going missing degrades one feature; these four
// missing means there is no site.
const REQUIRED = ["index.html", "firms.html", "firm.html", "styles.css"];

async function writeJson(rel, body) {
  const full = path.join(DIST, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, JSON.stringify(body));
  return Buffer.byteLength(JSON.stringify(body));
}

async function main() {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error("No results.json — run `node bin/scrape.js` first.");
    process.exit(1);
  }
  const data = JSON.parse(await fsp.readFile(RESULTS_FILE, "utf8"));

  await fsp.rm(DIST, { recursive: true, force: true });
  await fsp.mkdir(DIST, { recursive: true });

  // --- static assets ---
  const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(PUBLIC, rel)));
  if (missing.length) {
    console.error(`Missing from public/, refusing to build a broken site: ${missing.join(", ")}`);
    process.exit(1);
  }
  await fsp.cp(PUBLIC, DIST, { recursive: true });
  const assetCount = (await fsp.readdir(PUBLIC, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile()).length;

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
  console.log(`dist/ built — ${assetCount} assets, ${firmCount} firm files, ${jobs} roles`);
  console.log(`data: ${(bytes / 1048576).toFixed(2)} MB uncompressed (hosts serve it gzipped)`);
  console.log(`scrapedAt: ${data.scrapedAt}`);
}

main().catch((err) => {
  console.error("Build failed:", err.message);
  process.exit(1);
});
