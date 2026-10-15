-- Postgres schema for the AWS move, ported from the D1/SQLite one.
--
-- Deliberately a near-literal port rather than a redesign. The migration is already
-- changing the host, the runtime and the client library; changing the data model at
-- the same time would mean a failed cutover could not be told apart from a bad query.
--
-- Two conventions carried over on purpose:
--
--   * Timestamps stay BIGINT unix-milliseconds rather than becoming timestamptz. Every
--     value the browser sends is Date.now(), every reader does arithmetic on integers,
--     and converting would mean touching the worker, sync-jobs.js, stats.js and the
--     existing rows at the same moment. It is the boring choice and it keeps the export
--     a straight copy.
--   * Booleans stay 0/1 SMALLINT for `remote` and `active`, for the same reason: the
--     scraper emits integers and the SQL compares against integers.
--
-- Worth changing later, separately, once the move is proven.

CREATE TABLE IF NOT EXISTS jobs (
  job_id      TEXT PRIMARY KEY,
  company     TEXT NOT NULL,
  title       TEXT NOT NULL,
  city        TEXT,
  url         TEXT,
  ats         TEXT,              -- ashby | greenhouse | lever | null
  source      TEXT,              -- ats | board | click
  remote      SMALLINT NOT NULL DEFAULT 0,
  posted      TEXT,              -- ISO date as published by the source
  firms       TEXT,              -- JSON array of investor ids
  salary      TEXT,
  salary_min  DOUBLE PRECISION,
  salary_max  DOUBLE PRECISION,
  seniority   TEXT,
  staff_count INTEGER,
  size        TEXT,
  stage       TEXT,
  markets     TEXT,              -- JSON array
  domain      TEXT,
  first_seen  BIGINT NOT NULL,
  last_seen   BIGINT NOT NULL,
  active      SMALLINT NOT NULL DEFAULT 1,
  clicks      INTEGER NOT NULL DEFAULT 0
);

-- Only the indexes something actually queries. D1 carried idx_jobs_seniority and
-- idx_jobs_clicks, and nothing in the worker, the sync or stats.js reads either — but
-- every one of them was still written on all ~12,700 rows of every sync, which is most
-- of why the free-tier write cap kept being hit. An index that is never read is pure
-- write cost, so they do not come across.
CREATE INDEX IF NOT EXISTS idx_jobs_active  ON jobs (active, last_seen);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs (company);

CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  name       TEXT,
  first_seen BIGINT NOT NULL,
  last_seen  BIGINT NOT NULL,
  country    TEXT,
  liked_at   BIGINT
);

CREATE TABLE IF NOT EXISTS clicks (
  id      BIGSERIAL PRIMARY KEY,   -- was INTEGER PRIMARY KEY AUTOINCREMENT
  job_id  TEXT NOT NULL,
  user_id TEXT,
  ts      BIGINT NOT NULL,
  page    TEXT,
  firm    TEXT,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_clicks_job  ON clicks (job_id);
CREATE INDEX IF NOT EXISTS idx_clicks_ts   ON clicks (ts);
CREATE INDEX IF NOT EXISTS idx_clicks_user ON clicks (user_id);

CREATE TABLE IF NOT EXISTS filter_events (
  id      BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  ts      BIGINT NOT NULL,
  action  TEXT NOT NULL,          -- save | apply
  name    TEXT,
  filters TEXT,                   -- JSON, capped at 2000 chars by the handler
  page    TEXT,
  firm    TEXT,
  country TEXT
);
CREATE INDEX IF NOT EXISTS idx_filter_events_ts     ON filter_events (ts);
CREATE INDEX IF NOT EXISTS idx_filter_events_action ON filter_events (action);
CREATE INDEX IF NOT EXISTS idx_filter_events_user   ON filter_events (user_id);

CREATE TABLE IF NOT EXISTS feedback (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT,
  name       TEXT,
  topic      TEXT NOT NULL,
  message    TEXT NOT NULL,
  contact    TEXT,
  page       TEXT,
  country    TEXT,
  ts         BIGINT NOT NULL,
  emailed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_feedback_ts      ON feedback (ts);
CREATE INDEX IF NOT EXISTS idx_feedback_emailed ON feedback (emailed_at);

-- Résumés uploaded for matching, and the scores they got.
--
-- A résumé belongs to the visitor id the browser already carries (visitor.js); there
-- are no accounts, so that id is the only key, and every query is scoped by it. The
-- text is stored so a résumé uploaded once can be scored against any job later
-- without the browser sending it again — it never goes back to the browser.
CREATE TABLE IF NOT EXISTS resumes (
  id         TEXT PRIMARY KEY,          -- random, issued by the server
  visitor_id TEXT NOT NULL,
  label      TEXT NOT NULL,             -- what the visitor calls it; the file name at first
  file_name  TEXT,
  body       TEXT NOT NULL,             -- extracted text, capped by the handler
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resumes_visitor ON resumes (visitor_id, created_at);

-- One stored assessment per résumé and job, so reopening a job shows the score it
-- already got instead of paying for it again. "Check again" overwrites it. Deleting
-- the résumé deletes its scores.
CREATE TABLE IF NOT EXISTS resume_matches (
  resume_id  TEXT NOT NULL REFERENCES resumes (id) ON DELETE CASCADE,
  job_id     TEXT NOT NULL,
  score      SMALLINT NOT NULL,
  model      TEXT NOT NULL,
  rubric     TEXT NOT NULL,
  result     JSONB NOT NULL,            -- the full assessment from jev.js
  checked_at BIGINT NOT NULL,
  PRIMARY KEY (resume_id, job_id)
);

-- Google sign-in.
--
-- An account is one Google identity (its stable `sub`, never the email, which can
-- change). Everything the site recorded before sign-in is keyed by the browser's
-- visitor id; account_visitors links each browser an account has signed in from, so
-- clicks, filter events, feedback and the name in `users` belong to the account by
-- that join, without rewriting the rows. Résumés move to the account outright.
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,         -- random, issued by the server
  google_sub    TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL,
  name          TEXT,
  picture       TEXT,
  created_at    BIGINT NOT NULL,
  last_login_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_visitors (
  visitor_id TEXT PRIMARY KEY,            -- a browser belongs to at most one account
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  linked_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_account_visitors_account ON account_visitors (account_id);

-- Only a hash of the session token is stored, so a copy of this table cannot be used
-- to sign in as anyone.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);

-- Résumés belong to an account once one exists; visitor_id records the browser they
-- were uploaded from.
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES accounts (id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_resumes_account ON resumes (account_id, created_at);

-- What used to live only in one browser, kept on the account so it follows the person
-- to any device: the jobs they opened (the "clicked" stamps) and their saved filters.
CREATE TABLE IF NOT EXISTS account_seen (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  job_id     TEXT NOT NULL,
  ts         BIGINT NOT NULL,             -- when it was first opened
  PRIMARY KEY (account_id, job_id)
);

CREATE TABLE IF NOT EXISTS account_filters (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  items      JSONB NOT NULL,              -- the saved-filter list, as presets.js keeps it
  updated_at BIGINT NOT NULL
);

-- A stored score is only current while the job description and the rubric it was made
-- with are unchanged; desc_hash records which description that was.
ALTER TABLE resume_matches ADD COLUMN IF NOT EXISTS desc_hash TEXT;

-- Saved jobs, as saved.js keeps them: [{ id, at, job: { title, company, city, url, posted } }].
-- The copy of each job lets a saved role that has since left the boards still show.
CREATE TABLE IF NOT EXISTS account_saved (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  items      JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);

-- One review per account and analysis version. A reanalysis starts unrated;
-- previous reviews retain the exact result they evaluated, without duplicating the full uploaded resume.
CREATE TABLE IF NOT EXISTS resume_match_feedback (
  account_id          TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  resume_id           TEXT NOT NULL REFERENCES resumes (id) ON DELETE CASCADE,
  job_id              TEXT NOT NULL,
  analysis_checked_at BIGINT NOT NULL,
  rating              TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  result              JSONB NOT NULL,
  score               SMALLINT NOT NULL,
  model               TEXT NOT NULL,
  rubric              TEXT NOT NULL,
  desc_hash           TEXT,
  created_at          BIGINT NOT NULL,
  updated_at          BIGINT NOT NULL,
  PRIMARY KEY (account_id, resume_id, job_id, analysis_checked_at)
);

-- Paid résumé checks per account per day (UTC), and the feedback that unlocks more.
-- `used` counts only checks that called the model; stored scores are free. `bonus` is
-- the extra allowance granted for the day by giving feedback (see usage-store.cjs).
CREATE TABLE IF NOT EXISTS match_usage (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,             -- YYYY-MM-DD, UTC
  used       INTEGER NOT NULL DEFAULT 0,
  bonus      INTEGER NOT NULL DEFAULT 0,
  unlocks    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day)
);

CREATE TABLE IF NOT EXISTS match_feedback (
  id         BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL,         -- 1–5: how useful résumé matching has been
  message    TEXT NOT NULL,
  job_id     TEXT,                      -- the job open when it was given
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_feedback_ts ON match_feedback (created_at);
