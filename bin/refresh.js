#!/usr/bin/env node
//
// Refresh the live feed from the terminal.
//
//   ./refresh.js              dispatch a scrape and watch it to completion
//   ./refresh.js --no-watch   fire it and get your prompt back
//   ./refresh.js --status     show the last few runs, dispatch nothing
//
// The work happens on GitHub's runners, not this laptop, and lands on Cloudflare
// Pages — it is the same `.github/workflows/deploy.yml` the twice-daily cron uses,
// triggered through its `workflow_dispatch`. Nothing about the pipeline is duplicated
// here: this file only presses the button and reports back.
//
// Why not run the scrape on Cloudflare itself, given that's where the site lives?
// A full pass makes ~1,245 outbound requests (70 VC boards + 1,175 company ATS
// boards) and `results.json` needs ~121 MB of heap just to parse. A Worker gets
// 1,000 subrequests and 128 MB. Both ceilings are below what one pass needs, so it
// would take Workflows, chunked steps and R2 to land it — a port, not a button.

const { spawnSync } = require("child_process");

const WORKFLOW = "deploy.yml";
const BRANCH = "main";
const SITE = "https://jobs.ypatodkar.com";

// How long to wait for GitHub to materialise a run after accepting the dispatch.
// It is usually 2-3 seconds; 60 is slack for a bad API day, not an expectation.
const RUN_APPEAR_TIMEOUT_MS = 60_000;
const POLL_MS = 5_000;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => paint("2", s);
const bold = (s) => paint("1", s);
const green = (s) => paint("32", s);
const red = (s) => paint("31", s);
const yellow = (s) => paint("33", s);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run `gh` and return stdout. Throws with gh's own stderr, which is usually clear. */
function gh(args) {
  const res = spawnSync("gh", args, { encoding: "utf8" });
  if (res.error && res.error.code === "ENOENT") {
    throw new Error(
      "The GitHub CLI (`gh`) isn't installed.\n" +
        "  brew install gh && gh auth login"
    );
  }
  if (res.status !== 0) {
    throw new Error((res.stderr || res.stdout || "gh failed").trim());
  }
  return res.stdout;
}

const ghJson = (args) => JSON.parse(gh(args) || "null");

/**
 * Fail early and specifically. Every one of these has a one-line fix, and finding out
 * about them after a dispatch has supposedly gone out is worse than not dispatching.
 */
function preflight() {
  const auth = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
  if (auth.error && auth.error.code === "ENOENT") {
    throw new Error("The GitHub CLI (`gh`) isn't installed.\n  brew install gh && gh auth login");
  }
  if (auth.status !== 0) {
    throw new Error("Not signed in to GitHub.\n  gh auth login");
  }
}

/**
 * Every run id this workflow currently has, newest first. Taken before the dispatch
 * so the run we just created can be told apart from one the cron started a minute
 * ago — `gh workflow run` returns nothing that identifies its own run, and "newest
 * run" alone would happily attach us to somebody else's.
 */
function runIds(limit = 30) {
  const runs = ghJson([
    "run", "list",
    "--workflow", WORKFLOW,
    "--limit", String(limit),
    "--json", "databaseId,status,conclusion,event,createdAt,url,displayTitle",
  ]) || [];
  return runs;
}

async function waitForNewRun(before) {
  const seen = new Set(before.map((r) => r.databaseId));
  const deadline = Date.now() + RUN_APPEAR_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(2000);
    const fresh = runIds(10).filter((r) => !seen.has(r.databaseId));
    // A dispatch of ours is the only thing that can appear with this event in the
    // seconds after we asked for one; a concurrent push shows up as `push`.
    const mine = fresh.find((r) => r.event === "workflow_dispatch") || fresh[0];
    if (mine) return mine;
  }
  return null;
}

const STEP_ICON = { success: green("✓"), failure: red("✗"), cancelled: yellow("—"), skipped: dim("·") };

function secondsBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b) - new Date(a);
  return Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null;
}

function fmtDuration(seconds) {
  if (seconds == null) return "";
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

/**
 * Poll the run and print each step as it finishes.
 *
 * Deliberately prints on completion rather than on start: a step that is running
 * tells you nothing you can act on, and a line per state change turns a five-minute
 * scrape into a wall of repeated text.
 */
async function watchRun(run) {
  const printed = new Set();
  let lastStatus = null;

  for (;;) {
    let view;
    try {
      view = ghJson([
        "run", "view", String(run.databaseId),
        "--json", "status,conclusion,jobs,displayTitle,url",
      ]);
    } catch (err) {
      // A transient API blip should not kill a watch that is otherwise fine — the
      // run is on GitHub either way, and the next poll usually succeeds.
      console.log(dim(`  (couldn't reach GitHub, retrying: ${err.message.split("\n")[0]})`));
      await sleep(POLL_MS);
      continue;
    }

    for (const job of view.jobs || []) {
      for (const step of job.steps || []) {
        const key = `${job.databaseId}:${step.number}`;
        if (printed.has(key) || step.status !== "completed") continue;
        printed.add(key);

        // Checkout and setup-node are plumbing; the four that matter are the ones a
        // person actually waits on.
        if (/^(Set up job|Complete job|Post |actions\/|Run actions\/)/.test(step.name)) continue;
        if (step.name === "Checkout" || step.name.startsWith("Set up ")) continue;

        const icon = STEP_ICON[step.conclusion] || dim("·");
        const took = fmtDuration(secondsBetween(step.startedAt, step.completedAt));
        console.log(`  ${icon} ${step.name.padEnd(26)} ${dim(took)}`);
      }
    }

    if (view.status === "queued" && lastStatus !== "queued") {
      // The workflow's concurrency group is `deploy` with cancel-in-progress off, so
      // a run started while another is mid-scrape waits rather than clobbering it.
      console.log(dim("  queued — waiting for an in-flight run to finish"));
    }
    lastStatus = view.status;

    if (view.status === "completed") return view;
    await sleep(POLL_MS);
  }
}

/**
 * Read the deployed firm index back and report when it was scraped. 4.5 KB, and it
 * is the only claim worth making at the end: the deploy step going green means files
 * were uploaded, not that the site is serving them.
 */
async function reportLive() {
  try {
    const res = await fetch(`${SITE}/api/results.json`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const when = new Date(data.scrapedAt);
    const ageMin = Math.round((Date.now() - when) / 60000);
    const firms = Object.values(data.firms || {});
    const ok = firms.filter((f) => f.status === "ok").length;
    const listings = firms.reduce((n, f) => n + (f.count || 0), 0);

    console.log(
      `\n  live  ${SITE}\n` +
        `  ${dim("scraped")} ${when.toLocaleString()} ${dim(`(${ageMin}m ago)`)}\n` +
        // Listings, not roles: a company in several portfolios is counted once per
        // firm here. The deduped figure lives in all-jobs.json, which is 7.7 MB and
        // not worth downloading to print one number.
        `  ${dim("index")}   ${ok}/${firms.length} firms · ${listings.toLocaleString()} listings`
    );
  } catch {
    // The site being briefly unreachable says nothing about the run that just passed.
  }
}

function showStatus() {
  const runs = runIds(5);
  if (!runs.length) return console.log("No runs yet.");
  console.log(bold("Recent runs\n"));
  for (const r of runs) {
    const state = r.status === "completed" ? r.conclusion : r.status;
    const icon = STEP_ICON[state] || dim("•");
    const ago = Math.round((Date.now() - new Date(r.createdAt)) / 60000);
    console.log(`  ${icon} ${String(state).padEnd(10)} ${dim(`${r.event} · ${ago}m ago`)}  ${dim(r.url)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const watch = !args.includes("--no-watch");

  preflight();

  if (args.includes("--status")) return showStatus();

  const before = runIds();
  const inFlight = before.find((r) => r.status !== "completed");

  gh(["workflow", "run", WORKFLOW, "--ref", BRANCH]);
  console.log(`${green("→")} dispatched ${bold("Scrape and deploy")} on ${BRANCH}`);
  if (inFlight) console.log(dim(`  a run is already ${inFlight.status}; this one will queue behind it`));

  const run = await waitForNewRun(before);
  if (!run) {
    // The dispatch was accepted, so the run almost certainly exists and we simply
    // failed to spot it. Say exactly that rather than implying a failure.
    console.log(yellow("\nDispatched, but the run didn't appear in time to watch it."));
    console.log(dim(`  ./refresh.js --status    or    gh run list --workflow ${WORKFLOW}`));
    return;
  }

  console.log(dim(`  ${run.url}\n`));
  if (!watch) return;

  const done = await watchRun(run);
  if (done.conclusion === "success") {
    await reportLive();
  } else {
    console.log(`\n${red("✗")} run ${done.conclusion}. ${dim(run.url)}`);
    console.log(dim(`  gh run view ${run.databaseId} --log-failed`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\n${red("✗")} ${err.message}`);
  process.exitCode = 1;
});
