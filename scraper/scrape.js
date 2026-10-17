// Headless scrape, for CI and for populating a fresh clone.
//
//   node scraper/scrape.js
//
// Runs the shared pipeline and writes data/results.json as a one-shot process
// suitable for local use and scheduled automation.

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { runScrape, failedPlatforms, failedBoards } = require("./pipeline");
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
  for (const firm of Object.values(results.firms || {})) {
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
  const started = Date.now();

  const results = await runScrape((event, data) => {
    if (event === "phase" && data.phase === "ats") {
      console.log(`\nBoards done. Fetching ${data.companies} company job boards…`);
    } else if (event === "progress" && data.phase === "boards" && data.state !== "scraping") {
      const outcome = data.state === "ok" ? `${data.count} roles` : data.reason || data.state;
      console.log(`  [${data.done}/${data.total}] ${data.firmId}: ${outcome}`);
    } else if (event === "progress" && data.phase === "ats" && data.done % 50 === 0) {
      console.log(`  companies ${data.done}/${data.total}…`);
    } else if (event === "done") {
      const e = data.enrichment;
      console.log(
        `\nDone in ${Math.round((Date.now() - started) / 1000)}s — ` +
          `${e.fromAts} roles live from ${e.reached}/${e.companies} company boards, ${e.fromBoard} from VC boards.`
      );
      if (e.failures.length) console.log(`${e.failures.length} company boards unreachable.`);
    }
  });

  const failed = failedPlatforms(results);
  if (failed.length) {
    throw new Error(`refusing to replace results.json: every ${failed.join(" and ")} board failed`);
  }

  // Named individually, because the totals hide this. Two boards going quiet costs
  // whole portfolios' worth of companies while the run still reports success, and the
  // only visible symptom is a job count that looks plausibly like ordinary churn.
  const lost = failedBoards(results);
  if (lost.length) {
    console.warn(`\n${lost.length} configured board${lost.length === 1 ? "" : "s"} did not return:`);
    for (const [id, reason] of lost) console.warn(`  ${id.padEnd(24)} ${reason}`);
  }

  // Optional: a bug here must not cost the deploy, which is the job list itself.
  try {
    await classifyJobs(results);
  } catch (err) {
    console.warn(`Classification skipped: ${err.message}`);
  }

  const descriptions = splitDescriptions(results);
  await fsp.mkdir(DATA, { recursive: true });
  await fsp.writeFile(DESCRIPTIONS_FILE, JSON.stringify(descriptions));
  await fsp.writeFile(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`Wrote data/results.json and ${Object.keys(descriptions).length} descriptions`);
}

main().catch((err) => {
  console.error("Scrape failed:", err.message);
  process.exit(1);
});
