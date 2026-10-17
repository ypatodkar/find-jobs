// Builds the deployable static site into dist/.
//
//   npm ci --prefix web && npm run build --prefix web   # the pages, into web/dist
//   node scripts/build.js
//
// The pages are the React build (web/dist, which also carries web/public: og.png,
// robots.txt, sitemap.xml, featured.json), copied in whole. Beside them, the three
// read endpoints dev-server.js answers dynamically become real files at the same
// relative paths, so the pages need no code change between local and hosted:
//
//   dist/api/results.json
//   dist/api/all-jobs.json
//   dist/api/firm/<id>.json      (one per firm, including the unscrapeable ones)
//   dist/api/desc/<shard>.json   (job descriptions, a few per file; see shared/description.js)
//
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { BOARDS } = require("../scraper/boards");
const { resultsPayload, allJobsPayload, firmPayload } = require("../scraper/pipeline");
const { groupByShard } = require("../shared/description");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const RESULTS_FILE = path.join(ROOT, "data", "results.json");
const DESCRIPTIONS_FILE = path.join(ROOT, "data", "descriptions.json");

const PAGES_DIR = path.join(ROOT, "web", "dist");
const PAGES = ["index.html", "firm.html", "firms.html", "about.html", "404.html"];

// Content-hashed by Vite, so a file under assets/ never changes under the same URL.
const HEADERS = "/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n";

async function writeJson(rel, body) {
  const full = path.join(DIST, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, JSON.stringify(body));
  return Buffer.byteLength(JSON.stringify(body));
}

async function main() {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.error("No data/results.json — run `node scraper/scrape.js` first.");
    process.exit(1);
  }
  const data = JSON.parse(await fsp.readFile(RESULTS_FILE, "utf8"));

  const missingPages = PAGES.filter((p) => !fs.existsSync(path.join(PAGES_DIR, p)));
  if (missingPages.length) {
    console.error(`web/dist is missing ${missingPages.join(", ")} — run \`npm ci --prefix web && npm run build --prefix web\` first.`);
    process.exit(1);
  }

  await fsp.rm(DIST, { recursive: true, force: true });
  await fsp.mkdir(DIST, { recursive: true });

  // --- the pages ---
  await fsp.cp(PAGES_DIR, DIST, { recursive: true });

  // Tells GitHub Pages not to run the output through Jekyll, which would drop any
  // file or directory beginning with an underscore.
  await fsp.writeFile(path.join(DIST, ".nojekyll"), "");
  // Cloudflare Pages' cache rules; S3 gets the same from the deploy workflow.
  await fsp.writeFile(path.join(DIST, "_headers"), HEADERS);

  // Same-origin dynamic account routes on the production Cloudflare Pages host.
  await fsp.copyFile(path.join(ROOT, 'deploy/pages-worker.mjs'), path.join(DIST, '_worker.js'));
  await writeJson('_routes.json', { version: 1, include: ['/api/auth/*', '/api/sync', '/api/sync/*', '/api/resumes', '/api/resumes/*', '/api/match', '/api/match/*'], exclude: [] });

  // --- data ---
  // Which jobs have a description, so the job lists can mark them (see pipeline.js).
  const described = fs.existsSync(DESCRIPTIONS_FILE)
    ? new Set(Object.keys(JSON.parse(await fsp.readFile(DESCRIPTIONS_FILE, "utf8"))))
    : null;
  let bytes = 0;
  bytes += await writeJson("api/results.json", resultsPayload(data));
  bytes += await writeJson("api/all-jobs.json", allJobsPayload(data, described));

  let firmCount = 0;
  for (const id of Object.keys(BOARDS)) {
    const payload = firmPayload(data, id, described);
    if (!payload) continue;
    bytes += await writeJson(`api/firm/${id}.json`, payload);
    firmCount++;
  }

  // Optional: a results.json from before descriptions were kept still builds, and the
  // pane says there is no description rather than the build failing.
  let shardCount = 0;
  let descBytes = 0;
  if (fs.existsSync(DESCRIPTIONS_FILE)) {
    const shards = groupByShard(JSON.parse(await fsp.readFile(DESCRIPTIONS_FILE, "utf8")));
    for (const [k, body] of Object.entries(shards)) {
      descBytes += await writeJson(`api/desc/${k}.json`, body);
      shardCount++;
    }
  } else {
    console.warn("No data/descriptions.json — the description pane will have no text. Run `node scraper/scrape.js`.");
  }
  console.log(`descriptions: ${shardCount} shard files, ${(descBytes / 1048576).toFixed(2)} MB uncompressed`);

  const jobs = allJobsPayload(data).jobs.length;
  console.log(`dist/ built — the pages, ${firmCount} firm files, ${jobs} roles`);
  console.log(`data: ${(bytes / 1048576).toFixed(2)} MB uncompressed (hosts serve it gzipped)`);
  console.log(`scrapedAt: ${data.scrapedAt}`);
}

main().catch((err) => {
  console.error("Build failed:", err.message);
  process.exit(1);
});
