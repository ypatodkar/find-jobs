// Headless scrape, for CI and for populating a fresh clone.
//
//   node scrape.js
//
// Runs the shared pipeline and writes results.json as a one-shot process suitable
// for local use and scheduled automation.

const fsp = require("fs/promises");
const path = require("path");
const { runScrape, failedPlatforms } = require("./pipeline");

const RESULTS_FILE = path.join(__dirname, "results.json");

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

  await fsp.writeFile(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`Wrote results.json`);
}

main().catch((err) => {
  console.error("Scrape failed:", err.message);
  process.exit(1);
});
