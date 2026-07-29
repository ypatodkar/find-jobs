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
const ROWS_PER_STATEMENT = 200;

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
  const lines = ["BEGIN TRANSACTION;"];

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
  lines.push(`UPDATE jobs SET active = 0 WHERE last_seen < ${ts};`);
  lines.push("COMMIT;");

  fs.writeFileSync(OUT, lines.join("\n\n") + "\n");
  console.log(`${jobs.length} jobs -> ${path.basename(OUT)}`);
  console.log(`Next: npx wrangler d1 execute vcjobs --remote --file=sync.sql`);
}

main();
