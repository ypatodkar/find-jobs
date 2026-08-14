#!/usr/bin/env node
//
// Candidate startups for the featured slot.
//
//   node feature-pick.js            eligible companies, best first
//   node feature-pick.js --json     same, as JSON
//   node feature-pick.js --days 14  widen the posting window
//
// The deterministic half of the daily feature: who is *eligible*. Which one is
// actually interesting, and what to say about it, needs reading about the company —
// that is the `/feature` slash command's job, and this script is what it runs first.
//
// Eligibility, all three required:
//   - small        headcount at or under MAX_STAFF (default 200)
//   - current      at least one role posted inside the window (default 8 days)
//   - unfeatured   not already in featured.json's history
//
// Companies with no headcount on file are excluded rather than assumed small. The
// number comes from the VC boards, so "unknown" usually means a company we only ever
// saw through its own ATS — it is not evidence of being a startup.

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const ALL_JOBS = path.join(ROOT, "dist", "api", "all-jobs.json");
const FEATURED = path.join(ROOT, "featured.json");

const DAY = 86400000;
const MAX_STAFF = 200;
// Headcounts of 1 or 2 next to a handful of open roles are stale board data, not
// genuinely two-person companies, and they crowd out real ones. 3 is low enough to
// keep an actually tiny startup and high enough to drop the obvious noise.
const MIN_STAFF = 3;
const DEFAULT_DAYS = 8;

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const daysArg = args.indexOf("--days");
const WINDOW_DAYS = daysArg > -1 && args[daysArg + 1] ? Number(args[daysArg + 1]) : DEFAULT_DAYS;

function loadFeatured() {
  try {
    return JSON.parse(fs.readFileSync(FEATURED, "utf8"));
  } catch {
    return { current: null, history: [] };
  }
}

function main() {
  if (!fs.existsSync(ALL_JOBS)) {
    console.error("No dist/api/all-jobs.json — run `node build.js` first.");
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(ALL_JOBS, "utf8"));
  const companies = data.companies || [];
  const featured = loadFeatured();

  // Matched on the same normalisation the rest of the site uses for company names, so
  // "Tenex.AI" in the ledger still blocks "Tenex AI" from the board.
  const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const already = new Set([
    ...(featured.history || []).map((h) => key(h.company)),
    ...(featured.current ? [key(featured.current.company)] : []),
  ]);

  const now = Date.now();
  const byCompany = new Map();

  for (const job of data.jobs || []) {
    const co = companies[job.c];
    if (!co) continue;
    let c = byCompany.get(co.n);
    if (!c) {
      c = {
        company: co.n,
        staffCount: co.staffCount || null,
        size: co.size || null,
        stage: co.stage || null,
        markets: co.markets || [],
        domain: co.domain || null,
        roles: 0,
        recentRoles: 0,
        newest: 0,
        cities: new Set(),
        titles: [],
      };
      byCompany.set(co.n, c);
    }
    c.roles++;
    const t = job.posted ? new Date(job.posted).getTime() : 0;
    if (t > c.newest) c.newest = t;
    if (t && now - t <= WINDOW_DAYS * DAY) {
      c.recentRoles++;
      if (c.titles.length < 6) c.titles.push(job.title);
    }
    if (job.city) c.cities.add(job.city);
  }

  const eligible = [...byCompany.values()]
    .filter((c) => c.staffCount && c.staffCount >= MIN_STAFF && c.staffCount <= MAX_STAFF)
    .filter((c) => c.recentRoles > 0)
    .filter((c) => !already.has(key(c.company)))
    .map((c) => ({ ...c, cities: [...c.cities].slice(0, 4) }))
    // Most actively hiring first, then freshest. Deliberately NOT roles-per-head,
    // which sounds like a better signal but just ranks whichever company has the most
    // out-of-date headcount — the ratio is dominated by its denominator being wrong.
    .sort((a, b) => b.recentRoles - a.recentRoles || b.newest - a.newest);

  if (asJson) {
    console.log(JSON.stringify({ window: WINDOW_DAYS, maxStaff: MAX_STAFF, count: eligible.length, candidates: eligible.slice(0, 25) }, null, 2));
    return;
  }

  console.log(`\n${eligible.length} eligible — ≤${MAX_STAFF} staff, hiring in the last ${WINDOW_DAYS} days, not yet featured.`);
  console.log(`${(featured.history || []).length} already featured.\n`);

  eligible.slice(0, 20).forEach((c, i) => {
    const days = Math.round((now - c.newest) / DAY);
    console.log(
      `${String(i + 1).padStart(2)}. ${c.company.padEnd(24)} ${String(c.staffCount).padStart(4)} staff  ` +
        `${String(c.recentRoles).padStart(2)} new / ${String(c.roles).padStart(3)} open  ` +
        `${(c.stage || "—").padEnd(10)} ${days === 0 ? "today" : days + "d ago"}`
    );
    console.log(`    ${c.domain || "no domain"}  ·  ${c.markets.slice(0, 3).join(", ") || "no tags"}`);
    console.log(`    ${c.cities.join(", ") || "—"}  ·  eg ${c.titles.slice(0, 2).join(" / ") || "—"}\n`);
  });

  if (!eligible.length) {
    console.log("Nothing eligible. Widen with --days, or clear some history in featured.json.");
  }
}

main();
