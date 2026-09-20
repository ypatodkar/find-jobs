#!/usr/bin/env node
//
// Dump the live D1 database as Postgres INSERTs, ready to load into RDS.
//
//   node aws/export-d1.js              > aws/data.sql
//   node aws/export-d1.js --table users
//
// The jobs table is deliberately excluded by default. It is 20,000 rows of scraped
// metadata that the next sync rebuilds from scratch, and copying it would make the
// cutover slower and riskier for no gain — except for one column. `clicks` is a
// per-job counter the scraper cannot reproduce, so the rows carrying a non-zero count
// are exported on their own and the rest are left behind. Pass --with-jobs to take the
// whole table anyway.
//
// Everything else is irreplaceable and comes across in full: 991 clicks, 57 users and
// their hearts, 13 filter events, 3 pieces of feedback. That is the entire reason this
// script exists — the listings can always be re-scraped, a visitor's click cannot.

const { execFileSync } = require("child_process");
const path = require("path");

const WORKER_DIR = path.join(__dirname, "..", "worker");
const DB = "vcjobs";

const args = process.argv.slice(2);
const only = args.includes("--table") ? args[args.indexOf("--table") + 1] : null;
const withJobs = args.includes("--with-jobs");

// Same retry as stats.js: the Cloudflare API intermittently rejects a valid token with
// "not authorized [code: 7403]" and accepts the identical query moments later.
function query(sql, attempt = 1) {
  let raw = "";
  try {
    raw = execFileSync("npx", ["--yes", "wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql], {
      cwd: WORKER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err) {
    raw = err.stdout || "";
  }
  const start = raw.indexOf("[");
  if (start > -1) {
    try {
      const rows = JSON.parse(raw.slice(start))[0]?.results;
      if (rows) return rows;
    } catch { /* fall through to retry */ }
  }
  if (attempt < 3) return query(sql, attempt + 1);
  throw new Error(`D1 query failed after ${attempt} attempts: ${sql.slice(0, 80)}`);
}

// Postgres literal. Numbers stay bare, everything else is single-quoted with quotes
// doubled — the only escaping Postgres needs in a standard-conforming string.
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

const TABLES = {
  users: ["user_id", "name", "first_seen", "last_seen", "country", "liked_at"],
  clicks: ["id", "job_id", "user_id", "ts", "page", "firm", "country"],
  filter_events: ["id", "user_id", "ts", "action", "name", "filters", "page", "firm", "country"],
  feedback: ["id", "user_id", "name", "topic", "message", "contact", "page", "country", "ts", "emailed_at"],
};

// Batched so a table of 100k rows does not become 100k round trips on load. 500 keeps
// each statement comfortably inside any statement-size limit.
const CHUNK = 500;

function emit(table, cols, rows) {
  if (!rows.length) {
    console.log(`-- ${table}: no rows\n`);
    return;
  }
  console.log(`-- ${table}: ${rows.length} rows`);
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map((r) => `(${cols.map((c) => lit(r[c])).join(", ")})`);
    // ON CONFLICT DO NOTHING so re-running the import is safe — during a parallel run
    // this script gets run more than once, and the second pass should top up rather
    // than fail on the rows the first one already moved.
    console.log(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES\n${values.join(",\n")}\nON CONFLICT DO NOTHING;`
    );
  }
  console.log("");
}

function main() {
  console.log("-- Exported from Cloudflare D1 for the AWS move.");
  console.log(`-- ${new Date().toISOString()}`);
  console.log("BEGIN;\n");

  for (const [table, cols] of Object.entries(TABLES)) {
    if (only && only !== table) continue;
    emit(table, cols, query(`SELECT ${cols.join(", ")} FROM ${table}`));
  }

  if (!only) {
    const cols = ["job_id", "company", "title", "city", "url", "ats", "source", "remote", "posted",
      "firms", "salary", "salary_min", "salary_max", "seniority", "staff_count", "size", "stage",
      "markets", "domain", "first_seen", "last_seen", "active", "clicks"];
    const where = withJobs ? "" : " WHERE clicks > 0";
    const rows = query(`SELECT ${cols.join(", ")} FROM jobs${where}`);
    console.log(withJobs
      ? "-- jobs: full table (--with-jobs)"
      : "-- jobs: only rows with a click count the scraper cannot rebuild");
    emit("jobs", cols, rows);
  }

  // BIGSERIAL columns were given explicit ids above, so the sequences still sit at 1
  // and the next insert would collide. Postgres does not fix this on its own.
  console.log("-- Re-point the sequences past the ids just inserted.");
  for (const t of ["clicks", "filter_events", "feedback"]) {
    if (only && only !== t) continue;
    console.log(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false);`);
  }
  console.log("\nCOMMIT;");
}

main();
