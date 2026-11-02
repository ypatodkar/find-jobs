// Headless scrape, for CI and for populating a fresh clone.
//
//   node scraper/scrape.js
//
// Runs the shared pipeline and writes data/results.json as a one-shot process
// suitable for local use and scheduled automation.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { runScrape } = require("./pipeline");
const { BOARDS } = require("./boards");
const { STATE_FILE, loadState, atomicJson, withStateLock } = require("./registry");
const { labelJobs } = require("./classify");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const RESULTS_FILE = path.join(DATA, "results.json");
const DESCRIPTIONS_FILE = path.join(DATA, "descriptions.json");
// Jev's answers from earlier scrapes, keyed by a hash of each posting, so a posting
// is classified once rather than on every run. Not in git: CI carries it between runs
// with actions/cache, and losing it only means asking again (classify.js).
const LABELS_FILE = path.join(DATA, "job-labels.json");

// Reads TYPESAFE_API_KEY from .env for local runs; CI passes it as a secret.
function loadKey() {
  if (process.env.TYPESAFE_API_KEY) return;
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = /^\s*TYPESAFE_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
      if (m) process.env.TYPESAFE_API_KEY = m[1].replace(/^(["'])(.*)\1$/, "$2");
    }
  } catch { /* no .env */ }
}

async function classifyJobs(results) {
  loadKey();
  let cache = {};
  try {
    cache = JSON.parse(await fsp.readFile(LABELS_FILE, "utf8"));
  } catch { /* first run, or the CI cache was evicted: everything is asked */ }
  const s = await labelJobs(results, cache, {
    log: (m) => console.warn(m),
    onProgress: (done, total) => done % 1500 < 30 && console.log(`  classified ${done}/${total}…`),
  });
  await fsp.mkdir(DATA, { recursive: true });
  await fsp.writeFile(LABELS_FILE, JSON.stringify(cache));
  console.log(
    `Classified ${s.asked} new postings (${s.tokens.toLocaleString()} input tokens), ${s.cached} from cache; ` +
      `dropped ${s.dropped} that are not computing roles.`
  );
}

// Descriptions are most of the bytes a scrape collects and only the description pane
// reads them, one job at a time. Kept in results.json they would ride along into every
// payload built from it, so they are lifted out into their own file, keyed by job_id,
// which build.js shards for the page. A job listed under several firms is one entry.
function splitDescriptions(results) {
  const out = {};
  const source = {};
  for (const firm of [...Object.values(results.firms || {}), { jobs: results.directJobs || [] }]) {
    for (const j of firm.jobs || []) {
      const text = j.description;
      delete j.description;
      if (!text || !j.job_id) continue;
      // The employer's own posting beats the copy on a VC board.
      if (out[j.job_id] && !(source[j.job_id] !== "ats" && j.source === "ats")) continue;
      out[j.job_id] = text;
      source[j.job_id] = j.source;
    }
  }
  return out;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const known = ["--discover", "--discover-only", "--jobs-only", "--help"];
  if ([...args].some((a) => !known.includes(a))) throw new Error("Unknown argument; use --help");
  if (args.has("--help")) {
    console.log("node scraper/scrape.js [--discover | --discover-only | --jobs-only]\nDefault: discover when weekly refresh is due, then refresh saved company boards.\n--discover forces discovery; --discover-only runs due discovery without refreshing jobs.\n--jobs-only skips discovery. State is saved in data/scraper-state.json.");
    return;
  }
  if (args.has("--jobs-only") && (args.has("--discover") || args.has("--discover-only"))) throw new Error("Choose discovery or jobs-only, not both");
  return withStateLock(STATE_FILE, async () => {
    const state = await loadState(STATE_FILE, { resultsFile: RESULTS_FILE, descriptionsFile: DESCRIPTIONS_FILE, boards: BOARDS });
    return refresh(state, args);
  });
}

async function refresh(state, args) {
  const started = Date.now();

  const results = await runScrape((event, data) => {
    if (event === "phase" && data.phase === "ats") {
      console.log(`\nFetching ${data.companies} company job boards…`);
    } else if (event === "phase" && data.phase === "repair") {
      console.log(`Checking careers pages for ${data.companies} unresolved or repeatedly failing companies…`);
    } else if (event === "progress" && data.phase === "boards" && data.state !== "scraping") {
      const outcome = data.state === "ok" ? `${data.count} roles` : data.reason || data.state;
      console.log(`  [${data.done}/${data.total}] ${data.firmId}: ${outcome}`);
    } else if (event === "progress" && data.phase === "ats" && data.done % 50 === 0) {
      console.log(`  companies ${data.done}/${data.total}…`);
    } else if (event === "done") {
      const e = data.enrichment;
      console.log(
        `\nDone in ${Math.round((Date.now() - started) / 1000)}s — ` +
          `${e.reached}/${e.companies} company boards refreshed; ${e.fromAts} ATS roles, ${e.fromBoard} from VC snapshots, ${e.retained} retained after failures.`
      );
      if (e.failures.length) console.log(`${e.failures.length} company boards unreachable.`);
    }
  }, { state, forceDiscovery: args.has("--discover"), discoveryOnly: args.has("--discover-only"), jobsOnly: args.has("--jobs-only") });

  for (const { firmId, reason } of results.discovery.errors) console.warn(`Discovery ${firmId}: ${reason}; retaining previous observations`);
  if (args.has("--discover-only")) {
    await atomicJson(STATE_FILE, state);
    console.log(`Saved ${Object.keys(state.companies).length} companies; ${results.discovery.succeeded} discovery boards refreshed.`);
    return;
  }

  // Optional: a bug here must not cost the deploy, which is the job list itself.
  try {
    await classifyJobs(results);
  } catch (err) {
    console.warn(`Classification skipped: ${err.message}`);
  }

  const descriptions = splitDescriptions(results);
  await fsp.mkdir(DATA, { recursive: true });
  await atomicJson(DESCRIPTIONS_FILE, descriptions);
  await atomicJson(RESULTS_FILE, results);
  await atomicJson(STATE_FILE, state);
  console.log(`Wrote data/results.json and ${Object.keys(descriptions).length} descriptions`);
}

if (require.main === module) main().catch((err) => {
  console.error("Scrape failed:", err.message);
  process.exit(1);
});

module.exports = { main, splitDescriptions };
