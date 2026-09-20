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
