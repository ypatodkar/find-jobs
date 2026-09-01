// Turns the latest results.json into an idempotent SQL upsert for D1.
//
//   node sync-jobs.js
//   npx wrangler d1 execute vcjobs --remote --file=sync.sql
//
// Deliberately never touches `clicks` or `first_seen` — those are the two columns
// the scrape has no business knowing about, and clobbering either would throw away
// exactly the history this table exists to keep.

const fs = require("fs");
const path = require("path");

const RESULTS = process.argv[2] || path.join(__dirname, "results.json");
const OUT = process.argv[3] || path.join(__dirname, "sync.sql");
// D1 rejects an over-long statement with SQLITE_TOOBIG. At ~800 bytes a row, 200
// rows produced ~160 KB statements and failed; 50 keeps each one near 40 KB with
// plenty of headroom for longer titles and market lists.
const ROWS_PER_STATEMENT = 50;

// Job titles, companies and salaries come from third-party boards, so every value
// interpolated here is untrusted. Doubling the quote is the whole of SQLite string
// escaping — unlike MySQL it gives backslash no special meaning inside a literal —
// and NUL is stripped because it would truncate the statement.
const q = (v) => (v == null || v === "" ? "NULL" : `'${String(v).replace(/\0/g, "").replace(/'/g, "''")}'`);
const n = (v) => (v ? 1 : 0);

// Number.isFinite, not !isNaN: a board publishing "1e999" parses to Infinity, which
// SQLite reads as a bare identifier and rejects — aborting the whole transaction and
// losing every other row with it.
const num = (v) => {
  if (v == null || v === "") return "NULL";
  const x = Number(v);
  return Number.isFinite(x) ? x : "NULL";
};

const COLUMNS = [
  "job_id", "company", "title", "city", "url", "ats", "source", "remote", "posted", "firms",
  "salary", "salary_min", "salary_max", "seniority",
  "staff_count", "size", "stage", "markets", "domain",
  "first_seen", "last_seen",
];

// Everything except job_id, first_seen and clicks gets refreshed from the scrape.
const UPDATED = COLUMNS.filter((c) => c !== "job_id" && c !== "first_seen");

function row(j, ts) {
  return `(${[
    q(j.job_id), q(j.company), q(j.title), q(j.city), q(j.url), q(j.ats), q(j.source),
    n(j.remote), q(j.posted), q(JSON.stringify(j.firms || [])),
    q(j.salary), num(j.salaryMin), num(j.salaryMax), q(j.seniority),
    num(j.staffCount), q(j.size), q(j.stage), q(JSON.stringify(j.markets || [])), q(j.domain),
    ts, ts,
  ].join(", ")})`;
}

function collect(data) {
  // Same merge as /api/all-jobs: one company can sit in several portfolios, so a job
  // is one row carrying every investor that backs it.
  const merged = new Map();
  for (const [firmId, r] of Object.entries(data.firms || {})) {
    if (r.status !== "ok") continue;
    for (const j of r.jobs || []) {
      if (!j.job_id) continue;
      const existing = merged.get(j.job_id);
      if (existing) {
        if (!existing.firms.includes(firmId)) existing.firms.push(firmId);
        if (existing.source !== "ats" && j.source === "ats") {
          Object.assign(existing, j, { firms: existing.firms });
        }
      } else {
        merged.set(j.job_id, { ...j, firms: [firmId] });
      }
    }
  }
  return [...merged.values()];
}

function main() {
  if (!fs.existsSync(RESULTS)) {
    console.error("No results.json — run a scrape first.");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
  const jobs = collect(data);
  if (!jobs.length) {
    console.error("results.json has no jobs carrying a job_id — re-scrape with the current scraper.");
    process.exit(1);
  }

  const ts = data.scrapedAt ? Date.parse(data.scrapedAt) : Date.now();

  // No BEGIN/COMMIT: D1 rejects SQL transaction statements in a --file execution and
  // wraps the whole file in its own transaction anyway, so the batch is already atomic
  // — "if the execution fails to complete, your DB will return to its original state".
  const lines = [];

  for (let i = 0; i < jobs.length; i += ROWS_PER_STATEMENT) {
    const values = jobs.slice(i, i + ROWS_PER_STATEMENT).map((j) => row(j, ts));
    lines.push(
      `INSERT INTO jobs (${COLUMNS.join(", ")})\nVALUES\n${values.join(",\n")}\n` +
        `ON CONFLICT(job_id) DO UPDATE SET\n  ` +
        UPDATED.map((c) => `${c}=excluded.${c}`).join(", ") +
        `, active=1;`
    );
  }

  // Anything not in this scrape has come off the boards. Kept, not deleted — a click
  // recorded last week should still resolve to a company and a title.
  //
  // `AND active = 1` is not a tidiness clause, it is most of the cost. Without it this
  // rewrites every row that is not in the current scrape on every single run, including
  // the thousands that were already inactive and are being set to the value they
  // already hold. On a table of 18,562 rows with 12,588 live, that was ~6,000 writes a
  // run spent changing nothing, and D1's free tier bills 100,000 writes a day.
  lines.push(`UPDATE jobs SET active = 0 WHERE last_seen < ${ts} AND active = 1;`);

  fs.writeFileSync(OUT, lines.join("\n\n") + "\n");
  // Printed because this number is the D1 bill. The free tier allows 100,000 written
  // rows a day across every run combined, and one sync writes at least one row per live
  // job — so the ceiling is roughly (100,000 / this number) syncs in a day, and it is
  // worth seeing that arithmetic in the log rather than in a warning email.
  console.log(`${jobs.length} jobs -> ${path.basename(OUT)} (~${jobs.length.toLocaleString()} rows written per sync)`);
  console.log(`Next: npx wrangler d1 execute vcjobs --remote --file=sync.sql`);
}

main();
