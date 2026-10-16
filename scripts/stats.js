#!/usr/bin/env node
//
// Click, visitor and account stats from the live Postgres database on AWS.
//
//   node scripts/stats.js                overview, Google accounts, resume matching, every user, top 20 jobs
//   node scripts/stats.js --accounts     just the Google accounts
//   node scripts/stats.js --matching     just resume matching: Jev runs, jobs analysed, ratings
//   node scripts/stats.js --users        just the per-user table
//   node scripts/stats.js --jobs         just the job table
//   node scripts/stats.js --limit 50     how many jobs to list (default 20)
//   node scripts/stats.js --json         the same numbers as JSON
//
// Every statement in this file is a SELECT; nothing here writes.
//
// Connection: the standard PG* variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE,
// PGPORT) when they are set. Otherwise it reads them from the API Lambda's own
// configuration with the AWS CLI, the credentials the site itself uses, so it needs
// AWS access that can read find-jobs-api. They are held in memory for this run only;
// nothing is printed or written to disk.
//
// The database's firewall admits only allowlisted addresses, so this works from those
// networks alone; anywhere else the connection times out and the script says so.
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
//      An account is a Google sign-in, which is a person; one can span browsers.

const { execFileSync } = require("child_process");
const { Pool } = require("../aws/lambda/node_modules/pg");

const FUNCTION = "find-jobs-api";
const REGION = "us-east-1";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const only = ["--accounts", "--matching", "--users", "--jobs"].find((a) => args.includes(a));
const want = (section) => !only || only === `--${section}`;
const limitArg = args.indexOf("--limit");
const LIMIT = limitArg > -1 && args[limitArg + 1] ? Number(args[limitArg + 1]) : 20;

// The API's daily allowance of Jev runs (usage-store.cjs), read with the connection
// settings so "hit the limit" means what the site enforces.
let dailyLimit = 25;

function connection() {
  let env = process.env;
  if (!env.PGHOST) {
    try {
      env = JSON.parse(execFileSync("aws", [
        "lambda", "get-function-configuration", "--region", REGION, "--function-name", FUNCTION,
        "--query", "Environment.Variables", "--output", "json",
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    } catch (err) {
      throw new Error(`Could not read the database settings from ${FUNCTION}: ${(err.stderr || err.message).trim().split("\n")[0]}`);
    }
  }
  if (!env.PGHOST) throw new Error(`No PGHOST in the environment or in ${FUNCTION}'s configuration.`);
  if (Number(env.MATCH_DAILY_LIMIT) > 0) dailyLimit = Math.floor(Number(env.MATCH_DAILY_LIMIT));
  return {
    host: env.PGHOST,
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: env.PGDATABASE,
    ssl: env.PGSSL === "off" ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    max: 2,
  };
}

let pool;
// Postgres returns COUNT(*) and BIGINT as strings; every column here is a number or
// text, so numeric-looking strings are turned back into numbers once, here.
async function query(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : v])));
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

async function overview() {
  return (await query(`
    SELECT
      (SELECT COUNT(*) FROM users)                                        AS users,
      (SELECT COUNT(*) FROM users WHERE name IS NOT NULL)                 AS named,
      (SELECT COUNT(*) FROM users WHERE liked_at IS NOT NULL)             AS hearted,
      (SELECT COUNT(*) FROM accounts)                                     AS accounts,
      (SELECT COUNT(*) FROM clicks)                                       AS clicks,
      (SELECT COUNT(*) FROM clicks WHERE user_id IS NULL)                 AS unattributed,
      (SELECT COUNT(DISTINCT user_id) FROM clicks)                        AS clicking_users,
      (SELECT COUNT(DISTINCT job_id) FROM clicks)                         AS jobs_clicked,
      (SELECT MAX(ts) FROM clicks WHERE user_id IS NULL)                  AS last_unattributed,
      (SELECT MIN(ts) FROM clicks)                                        AS first_click,
      (SELECT MAX(ts) FROM clicks)                                        AS last_click
  `))[0];
}

// Google sign-ins, oldest first. Resumes counts the ones still active (a deleted
// resume is kept, marked inactive), browsers the visitor ids linked to the account.
// Clicks are recorded per browser, so an account's clicks are those of every browser
// it has signed in on — before and after signing in. jobs is DISTINCT, as for users.
async function accounts() {
  return query(`
    SELECT a.email, a.name, a.created_at, a.last_login_at,
           (SELECT COUNT(*) FROM resumes r WHERE r.account_id = a.id AND r.active = 1) AS resumes,
           (SELECT COUNT(*) FROM account_visitors v WHERE v.account_id = a.id)        AS browsers,
           (SELECT COUNT(*) FROM clicks c JOIN account_visitors v ON v.visitor_id = c.user_id
             WHERE v.account_id = a.id)                                              AS clicks,
           (SELECT COUNT(DISTINCT c.job_id) FROM clicks c JOIN account_visitors v ON v.visitor_id = c.user_id
             WHERE v.account_id = a.id)                                              AS jobs
    FROM accounts a
    ORDER BY a.created_at ASC
  `);
}

// One row per visitor. jobs is DISTINCT job_id, so a user who opened the same role
// five times counts one job and five clicks — the two columns diverging is what tells
// you someone was going back and forth rather than working through a list.
async function users() {
  return query(`
    SELECT u.user_id, u.name, u.country, u.liked_at, u.first_seen, u.last_seen,
           (SELECT COUNT(*)               FROM clicks c WHERE c.user_id = u.user_id) AS clicks,
           (SELECT COUNT(DISTINCT job_id) FROM clicks c WHERE c.user_id = u.user_id) AS jobs
    FROM users u
    ORDER BY clicks DESC, u.first_seen ASC
  `);
}

// LEFT JOIN, because a click can outlive the role it points at: the jobs table holds
// only roles someone opened, and a filled job leaves the boards while its clicks stay.
// Those rows still belong in the ranking.
async function topJobs(limit) {
  return query(`
    SELECT c.job_id,
           COUNT(DISTINCT c.user_id) AS people,
           COUNT(*)                  AS clicks,
           MAX(c.ts)                 AS last_click,
           j.company, j.title, j.city, j.stage
    FROM clicks c
    LEFT JOIN jobs j ON j.job_id = c.job_id
    GROUP BY c.job_id, j.company, j.title, j.city, j.stage
    ORDER BY people DESC, clicks DESC, last_click DESC
    LIMIT $1
  `, [Number(limit) || 20]);
}

// Resume matching. Two tables answer different questions, and the difference matters:
//
//   match_usage     one row per account per UTC day; `used` counts Jev runs that
//                   succeeded (a failed run is refunded), re-analyses included. This
//                   is how many times Jev was actually called.
//   resume_matches  one row per resume-and-job pair, holding the latest analysis; a
//                   re-analysis overwrites it. This is how many different pairs, and
//                   their current scores.
//
// Runs can exceed pairs (people re-analyse), and pairs are counted across every resume
// ever uploaded, deleted ones included, since their analyses were real.
async function matching() {
  const totals = (await query(`
    SELECT
      (SELECT COALESCE(SUM(used), 0) FROM match_usage)                     AS runs,
      (SELECT COUNT(DISTINCT account_id) FROM match_usage WHERE used > 0)  AS people,
      (SELECT COUNT(*) FROM resume_matches)                                AS pairs,
      (SELECT COUNT(DISTINCT job_id) FROM resume_matches)                  AS jobs,
      (SELECT COUNT(DISTINCT resume_id) FROM resume_matches)               AS resumes,
      (SELECT ROUND(AVG(score)) FROM resume_matches)                       AS avg_score,
      (SELECT COUNT(*) FROM match_usage WHERE used >= $1)                  AS limit_days,
      (SELECT COALESCE(SUM(unlocks), 0) FROM match_usage)                  AS unlocks,
      (SELECT COUNT(*) FROM resume_match_feedback WHERE rating = 'up')     AS ups,
      (SELECT COUNT(*) FROM resume_match_feedback WHERE rating = 'down')   AS downs,
      (SELECT COUNT(*) FROM resume_match_feedback WHERE updated_at > created_at) AS changed,
      (SELECT MIN(day) FROM match_usage)                                   AS first_day
  `, [dailyLimit]))[0];

  const people = await query(`
    WITH m AS (SELECT r.account_id, m.* FROM resume_matches m JOIN resumes r ON r.id = m.resume_id)
    SELECT a.email,
           (SELECT COALESCE(SUM(u.used), 0) FROM match_usage u WHERE u.account_id = a.id)  AS runs,
           (SELECT COUNT(*) FROM m WHERE m.account_id = a.id)                              AS pairs,
           (SELECT COUNT(DISTINCT m.job_id) FROM m WHERE m.account_id = a.id)              AS jobs,
           (SELECT COUNT(DISTINCT m.resume_id) FROM m WHERE m.account_id = a.id)           AS resumes,
           (SELECT ROUND(AVG(m.score)) FROM m WHERE m.account_id = a.id)                   AS avg_score,
           (SELECT MAX(m.checked_at) FROM m WHERE m.account_id = a.id)                     AS last_run,
           (SELECT COUNT(*) FROM match_usage u WHERE u.account_id = a.id AND u.used >= $1) AS limit_days,
           (SELECT COALESCE(SUM(u.unlocks), 0) FROM match_usage u WHERE u.account_id = a.id) AS unlocks,
           (SELECT COUNT(*) FROM resume_match_feedback f WHERE f.account_id = a.id AND f.rating = 'up')   AS ups,
           (SELECT COUNT(*) FROM resume_match_feedback f WHERE f.account_id = a.id AND f.rating = 'down') AS downs
    FROM accounts a
    ORDER BY runs DESC, pairs DESC, a.created_at ASC
  `, [dailyLimit]);

  const days = await query(`
    SELECT day, SUM(used) AS runs, COUNT(*) FILTER (WHERE used > 0) AS people
    FROM match_usage GROUP BY day ORDER BY day DESC LIMIT 30
  `);

  // Whether people trust a high score more than a low one: thumbs by the score they rated.
  const bands = await query(`
    SELECT CASE WHEN score >= 80 THEN '80–100' WHEN score >= 60 THEN '60–79'
                WHEN score >= 40 THEN '40–59' ELSE '0–39' END AS band,
           COUNT(*) FILTER (WHERE rating = 'up')   AS ups,
           COUNT(*) FILTER (WHERE rating = 'down') AS downs
    FROM resume_match_feedback GROUP BY band ORDER BY MIN(score) DESC
  `);

  const recent = await query(`
    SELECT f.updated_at, f.rating, f.score, f.job_id, j.company, j.title
    FROM resume_match_feedback f LEFT JOIN jobs j ON j.job_id = f.job_id
    ORDER BY f.updated_at DESC LIMIT 10
  `);

  // The 1–5 rating and comment given to unlock more runs once a day's are used up.
  const unlockFeedback = await query(`
    SELECT f.created_at, f.rating, f.message, a.email
    FROM match_feedback f JOIN accounts a ON a.id = f.account_id
    ORDER BY f.created_at DESC
  `);

  return { totals, people: people.filter((r) => r.runs || r.pairs), days, bands, recent, unlockFeedback };
}

async function main() {
  pool = new Pool(connection());
  const o = await overview();
  const a = want("accounts") ? await accounts() : [];
  const mt = want("matching") ? await matching() : null;
  const u = want("users") ? await users() : [];
  const j = want("jobs") ? await topJobs(LIMIT) : [];

  if (asJson) {
    console.log(JSON.stringify({ overview: o, accounts: a, matching: mt, users: u, topJobs: j }, null, 2));
    return;
  }

  const attributed = o.clicks - o.unattributed;
  console.log(`\n${o.users} visitors · ${o.accounts} Google accounts · ${o.clicks} clicks on ${o.jobs_clicked} distinct roles`);
  console.log(`${o.named} gave a name · ${o.hearted} hearted · ${o.clicking_users} have clicked at least once`);
  console.log(`first click ${ts(o.first_click)} · last ${ts(o.last_click)}`);
  if (o.unattributed) {
    console.log(
      `\n${o.unattributed} of those clicks carry no user_id and cannot be attributed to anyone —\n` +
      `they predate user tracking (last one ${ts(o.last_unattributed)}). The per-user column below\n` +
      `therefore sums to ${attributed}, not ${o.clicks}.`
    );
  }

  if (want("accounts")) {
    console.log(`\n\nGOOGLE ACCOUNTS (${a.length})\n`);
    console.log(`${pad("#", 4)}${pad("EMAIL", 34)}${pad("NAME", 18)}${num("CLICKS", 7)}${num("JOBS", 6)}${num("CVS", 5)}${num("BROWSERS", 9)}  ${pad("SIGNED UP", 18)}LAST LOGIN`);
    console.log("-".repeat(118));
    a.forEach((r, i) => {
      console.log(
        pad(i + 1, 4) + pad(r.email, 34) + pad(r.name || "—", 18) + num(r.clicks, 7) + num(r.jobs, 6) +
        num(r.resumes, 5) + num(r.browsers, 9) + "  " + pad(ts(r.created_at), 18) + ts(r.last_login_at)
      );
    });
  }

  if (mt) {
    const t = mt.totals;
    const rated = t.ups + t.downs;
    console.log(`\n\nRESUME MATCHING (Jev)\n`);
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    console.log(`${plural(t.runs, "Jev run", "Jev runs")} by ${plural(t.people, "person", "people")} since ${t.first_day || "—"} · ${t.pairs} resume-and-job pairs analysed`);
    console.log(`${t.jobs} different jobs · ${t.resumes} resumes · average score ${t.avg_score ?? "—"}/100`);
    console.log(`${t.limit_days} times someone used the whole daily allowance of ${dailyLimit} · ${t.unlocks} unlocked more with feedback`);
    console.log(`${rated} analyses rated: ${t.ups} 👍 · ${t.downs} 👎${rated ? ` (${Math.round((t.ups / rated) * 100)}% up)` : ""} · ${t.changed} changed their rating`);

    console.log(`\n${pad("#", 4)}${pad("EMAIL", 34)}${num("RUNS", 5)}${num("PAIRS", 6)}${num("JOBS", 6)}${num("CVS", 5)}${num("AVG", 5)}${num("👍", 4)}${num("👎", 4)}${num("LIMIT", 7)}  LAST RUN`);
    console.log("-".repeat(104));
    mt.people.forEach((r, i) => {
      console.log(
        pad(i + 1, 4) + pad(r.email, 34) + num(r.runs, 5) + num(r.pairs, 6) + num(r.jobs, 6) + num(r.resumes, 5) +
        num(r.avg_score ?? "—", 5) + num(r.ups, 4) + num(r.downs, 4) +
        num(r.limit_days ? `${r.limit_days}d${r.unlocks ? "+" + r.unlocks : ""}` : "—", 7) + "  " + ts(r.last_run)
      );
    });
    console.log(`\nRUNS is every Jev call, re-analyses included; PAIRS the resume-and-job pairs with a`);
    console.log(`stored result. LIMIT is days the allowance ran out, +N the times more were unlocked.`);
    console.log(`Runs are counted from ${t.first_day || "the first counted day"}, so analyses before then appear in PAIRS only.`);
    const owned = mt.people.reduce((n, r) => n + r.pairs, 0);
    if (owned < t.pairs) console.log(`${t.pairs - owned} pair(s) belong to resumes uploaded before sign-in existed, so to no account.`);

    if (mt.days.length) {
      console.log(`\nRUNS PER DAY (UTC, latest ${mt.days.length})`);
      mt.days.forEach((d) => console.log(`  ${d.day}  ${num(d.runs, 5)} runs  ${num(d.people, 3)} ${d.people === 1 ? "person" : "people"}  ${"▇".repeat(Math.min(60, d.runs))}`));
    }
    if (mt.bands.length) {
      console.log(`\nRATINGS BY THE SCORE THAT WAS RATED`);
      mt.bands.forEach((b) => console.log(`  ${pad(b.band, 8)}${num(b.ups, 4)} 👍 ${num(b.downs, 4)} 👎`));
    }
    if (mt.recent.length) {
      console.log(`\nLATEST RATINGS`);
      mt.recent.forEach((r) => console.log(`  ${pad(ts(r.updated_at), 18)}${r.rating === "up" ? "👍" : "👎"} ${num(r.score, 3)}  ${pad(r.company || "", 22)}${r.title || r.job_id}`));
    }
    if (mt.unlockFeedback.length) {
      const avg = mt.unlockFeedback.reduce((n, f) => n + f.rating, 0) / mt.unlockFeedback.length;
      console.log(`\nFEEDBACK GIVEN TO UNLOCK MORE RUNS (${mt.unlockFeedback.length}, average ${avg.toFixed(1)}/5)`);
      mt.unlockFeedback.forEach((f) => console.log(`  ${pad(ts(f.created_at), 18)}${f.rating}/5  ${pad(f.email, 30)}${String(f.message).replace(/\s+/g, " ").slice(0, 120)}`));
    }
  }

  if (want("users")) {
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

  if (want("jobs")) {
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

main()
  .catch((err) => {
    console.error(`\n${err.message}\n`);
    if (/timeout|ETIMEDOUT|ECONNREFUSED|no pg_hba|not allowed/i.test(err.message)) {
      console.error("The database only accepts allowlisted networks. Run this from one of them, or");
      console.error("add this network's address to the database's security group first.\n");
    }
    process.exitCode = 1;
  })
  .finally(() => pool && pool.end());
