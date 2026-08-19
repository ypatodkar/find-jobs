#!/usr/bin/env node
//
// Click and visitor stats from the D1 analytics database.
//
//   node stats.js                overview, every user, top 20 jobs
//   node stats.js --users        just the per-user table
//   node stats.js --jobs         just the job table
//   node stats.js --limit 50     how many jobs to list (default 20)
//   node stats.js --json         the same numbers as JSON
//
// Reads the live database through wrangler, so it needs the same Cloudflare auth the
// deploy uses. Every statement in this file is a SELECT; nothing here writes.
//
// Three things about this data will mislead you if the script does not say them out
// loud, so it does:
//
//   1. clicks.user_id is NULL for every click recorded before user attribution
//      existed. Those clicks are real but belong to nobody, so the per-user column
//      sums to less than the site total. The overview prints the gap rather than
//      letting you discover it by subtracting.
//
//   2. "clicked by most users" is COUNT(DISTINCT user_id), not COUNT(*). One person
//      opening the same role nine times is one interested person, not nine. Both
//      numbers are shown because the difference is the interesting part.
//
//   3. A user is a browser, not a person. Clearing storage or opening a second
//      browser makes a new row, so a name appearing several times is one human.

const { execFileSync } = require("child_process");
const path = require("path");

const WORKER_DIR = path.join(__dirname, "worker");
const DB = "vcjobs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const onlyUsers = args.includes("--users");
const onlyJobs = args.includes("--jobs");
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg > -1 && args[limitArg + 1] ? Number(args[limitArg + 1]) : 20;

/**
 * Run one SELECT and hand back its rows.
 *
 * execFile rather than a shell string: the SQL contains quotes and commas, and going
 * through a shell would mean escaping them correctly on every platform for no gain.
 *
 * The retry is not defensive padding. The Cloudflare API intermittently answers a
 * valid token with "account is not authorized [code: 7403]", and the same query
 * succeeds a second later — without this the script fails roughly one run in five.
 */
function query(sql, attempt = 1) {
  let raw;
  try {
    raw = execFileSync(
      "npx",
      ["--yes", "wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql],
      { cwd: WORKER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (err) {
    raw = err.stdout || "";
  }

  const start = raw.indexOf("[");
  let parsed = null;
  if (start > -1) {
    try { parsed = JSON.parse(raw.slice(start)); } catch { parsed = null; }
  }
  const rows = parsed && parsed[0] && parsed[0].results;
  if (rows) return rows;

  if (attempt < 3) return query(sql, attempt + 1);
  // Surface Cloudflare's own words rather than a generic failure — "not authorized"
  // and "database not found" need very different fixes.
  const reason = (() => {
    try { return JSON.parse(raw).error.text; } catch { return raw.trim().slice(0, 200) || "no output"; }
  })();
  throw new Error(`D1 query failed after ${attempt} attempts: ${reason}`);
}

const ts = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace("T", " ") : "—");
// Truncates one short of the column so a long value always keeps a trailing space:
// a title cut to exactly the column width runs straight into the next one and the
// two read as a single string.
const pad = (s, n) => {
  const v = String(s == null ? "—" : s);
  return (v.length >= n ? v.slice(0, n - 2) + "…" : v).padEnd(n);
};
const num = (s, n) => String(s == null ? "—" : s).padStart(n);

function overview() {
  return query(`
    SELECT
      (SELECT COUNT(*) FROM users)                                        AS users,
      (SELECT COUNT(*) FROM users WHERE name IS NOT NULL)                 AS named,
      (SELECT COUNT(*) FROM users WHERE liked_at IS NOT NULL)             AS hearted,
      (SELECT COUNT(*) FROM clicks)                                       AS clicks,
      (SELECT COUNT(*) FROM clicks WHERE user_id IS NULL)                 AS unattributed,
      (SELECT COUNT(DISTINCT user_id) FROM clicks)                        AS clicking_users,
      (SELECT COUNT(DISTINCT job_id) FROM clicks)                         AS jobs_clicked,
      (SELECT MAX(ts) FROM clicks WHERE user_id IS NULL)                  AS last_unattributed,
      (SELECT MIN(ts) FROM clicks)                                        AS first_click,
      (SELECT MAX(ts) FROM clicks)                                        AS last_click
  `.trim())[0];
}

// One row per visitor. jobs is DISTINCT job_id, so a user who opened the same role
// five times counts one job and five clicks — the two columns diverging is what tells
// you someone was going back and forth rather than working through a list.
function users() {
  return query(`
    SELECT u.user_id, u.name, u.country, u.liked_at, u.first_seen, u.last_seen,
           (SELECT COUNT(*)               FROM clicks c WHERE c.user_id = u.user_id) AS clicks,
           (SELECT COUNT(DISTINCT job_id) FROM clicks c WHERE c.user_id = u.user_id) AS jobs
    FROM users u
    ORDER BY clicks DESC, u.first_seen ASC
  `.trim());
}

// LEFT JOIN, because a click can outlive the role it points at: results.json is
// rewritten every scrape and a filled job leaves the board, so the title may be gone
// from `jobs` while the click stays. Those rows still belong in the ranking.
function topJobs(limit) {
  return query(`
    SELECT c.job_id,
           COUNT(DISTINCT c.user_id) AS people,
           COUNT(*)                  AS clicks,
           MAX(c.ts)                 AS last_click,
           j.company, j.title, j.city, j.stage
    FROM clicks c
    LEFT JOIN jobs j ON j.job_id = c.job_id
    GROUP BY c.job_id
    ORDER BY people DESC, clicks DESC, last_click DESC
    LIMIT ${Number(limit) || 20}
  `.trim());
}

function main() {
  const o = overview();
  const wantUsers = !onlyJobs;
  const wantJobs = !onlyUsers;
  const u = wantUsers ? users() : [];
  const j = wantJobs ? topJobs(LIMIT) : [];

  if (asJson) {
    console.log(JSON.stringify({ overview: o, users: u, topJobs: j }, null, 2));
    return;
  }

  const attributed = o.clicks - o.unattributed;
  console.log(`\n${o.users} visitors · ${o.clicks} clicks on ${o.jobs_clicked} distinct roles`);
  console.log(`${o.named} gave a name · ${o.hearted} hearted · ${o.clicking_users} have clicked at least once`);
  console.log(`first click ${ts(o.first_click)} · last ${ts(o.last_click)}`);
  if (o.unattributed) {
    console.log(
      `\n${o.unattributed} of those clicks carry no user_id and cannot be attributed to anyone —\n` +
      `they predate user tracking (last one ${ts(o.last_unattributed)}). The per-user column below\n` +
      `therefore sums to ${attributed}, not ${o.clicks}.`
    );
  }

  if (wantUsers) {
    console.log(`\n\nALL USERS (${u.length})\n`);
    console.log(`${pad("#", 4)}${pad("NAME", 16)}${pad("CO", 4)}${num("CLICKS", 6)}${num("JOBS", 6)}  ♥  ${pad("FIRST SEEN", 18)}LAST SEEN`);
    console.log("-".repeat(84));
    u.forEach((r, i) => {
      console.log(
        pad(i + 1, 4) + pad(r.name || "—", 16) + pad(r.country || "—", 4) +
        num(r.clicks, 6) + num(r.jobs, 6) + "  " + (r.liked_at ? "♥" : " ") + "  " +
        pad(ts(r.first_seen), 18) + ts(r.last_seen)
      );
    });
    const returning = u.filter((r) => r.last_seen - r.first_seen > 60000).length;
    console.log(`\n${u.filter((r) => r.clicks === 0).length} never clicked · ${returning} came back after their first minute`);
  }

  if (wantJobs) {
    console.log(`\n\nTOP ${j.length} ROLES BY NUMBER OF PEOPLE WHO OPENED THEM\n`);
    console.log(`${pad("#", 4)}${num("PPL", 4)}${num("CLICKS", 7)}  ${pad("COMPANY", 22)}${pad("TITLE", 40)}LAST OPENED`);
    console.log("-".repeat(104));
    j.forEach((r, i) => {
      console.log(
        pad(i + 1, 4) + num(r.people, 4) + num(r.clicks, 7) + "  " +
        pad(r.company || "(not in jobs table)", 22) + pad(r.title || r.job_id, 40) + ts(r.last_click)
      );
    });
  }
  console.log("");
}

try {
  main();
} catch (err) {
  console.error(`\n${err.message}\n`);
  console.error("This reads the live D1 database, so it needs Cloudflare auth: either a");
  console.error("wrangler login, or CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the");
  console.error("environment — the same credentials .github/workflows/deploy.yml uses.\n");
  process.exit(1);
}
