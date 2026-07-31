-- D1 schema for job metadata, click tracking, and accounts.
--   npx wrangler d1 execute vcjobs --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS jobs (
  job_id     TEXT PRIMARY KEY,
  company    TEXT NOT NULL,
  title      TEXT NOT NULL,
  city       TEXT,
  url        TEXT,
  ats        TEXT,              -- ashby | greenhouse | lever | null
  source     TEXT,              -- ats | board
  remote     INTEGER NOT NULL DEFAULT 0,
  posted     TEXT,              -- ISO date as published by the source
  firms      TEXT,              -- JSON array of investor ids backing this company

  -- Role facts. salary_min/max are the numbers; salary is the preformatted string
  -- the UI shows, kept so a query doesn't have to re-derive currency and period.
  salary     TEXT,
  salary_min REAL,
  salary_max REAL,
  seniority  TEXT,

  -- Company facts. Only the Consider boards publish these, so they are frequently
  -- null — worth storing anyway, since this table outlives any single scrape.
  staff_count INTEGER,
  size        TEXT,
  stage       TEXT,
  markets     TEXT,             -- JSON array
  domain      TEXT,

  -- first_seen/last_seen are ours, not the source's: results.json is overwritten
  -- every scrape, so this table is the only place posting history survives.
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,

  clicks     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_jobs_clicks ON jobs(clicks DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(active, last_seen);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_jobs_seniority ON jobs(seniority);

-- Raw events are kept alongside the denormalised counter so that "clicks this
-- week" and per-country breakdowns stay possible; the counter alone can only
-- answer "how many, ever".
CREATE TABLE IF NOT EXISTS clicks (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id  TEXT NOT NULL,
  visitor_id TEXT,            -- anonymous per-browser id, see visitors
  ts      INTEGER NOT NULL,     -- unix ms
  page    TEXT,                 -- all.html | firm.html
  firm    TEXT,                 -- investor page the click came from, if any
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_clicks_job ON clicks(job_id);
CREATE INDEX IF NOT EXISTS idx_clicks_ts ON clicks(ts);

-- Accounts (GitHub / Google OAuth via worker/index.js). One row per (provider,
-- provider_user_id) — accounts are never merged by email, since two providers
-- reporting the same email address isn't proof of the same person, and auto-merging
-- would let someone claim another user's account by registering that email elsewhere.
CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,   -- random id, independent of the provider's id
  provider         TEXT NOT NULL,      -- github | google
  provider_user_id TEXT NOT NULL,
  email            TEXT,
  name             TEXT,
  avatar_url       TEXT,
  created_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_user_id);

-- Opaque bearer tokens, one per signed-in browser. The cookie's value *is* the
-- primary key — checked against this table on every request, not decoded — so a
-- session can be revoked by deleting the row, no JWT-blacklist problem.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Server-side mirror of the browser-local "seen" store (see track.js). One row per
-- role a signed-in user has opened, synced in both directions on every page load so
-- "opened" status follows the account across devices instead of staying per-browser.
CREATE TABLE IF NOT EXISTS seen_jobs (
  user_id    TEXT NOT NULL REFERENCES users(id),
  job_id     TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  PRIMARY KEY (user_id, job_id)
);

-- Filter activity. One row per saved view, so you can see which slices people care
-- enough about to keep. No identity attached: this is aggregate product feedback,
-- not a per-user trail.
CREATE TABLE IF NOT EXISTS filter_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id TEXT,            -- anonymous per-browser id, see visitors
  ts      INTEGER NOT NULL,      -- unix ms
  action  TEXT NOT NULL,         -- save | apply
  name    TEXT,                  -- the label the view generated for itself
  filters TEXT,                  -- JSON: the filter state, exactly as presets.js stores it
  page    TEXT,                  -- index.html | firm.html
  firm    TEXT,                  -- investor page it came from, if any
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_filter_events_ts ON filter_events (ts);
CREATE INDEX IF NOT EXISTS idx_filter_events_action ON filter_events (action);

-- Anonymous visitors. `visitor_id` is a UUID the browser mints for itself — no email,
-- no IP, nothing that identifies a person on its own. `name` is whatever they chose to
-- type when asked, and is optional: skipping leaves it NULL and everything still works.
-- This is a friendly label on a pseudonymous id, not an account.
CREATE TABLE IF NOT EXISTS visitors (
  visitor_id TEXT PRIMARY KEY,
  name       TEXT,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  country    TEXT
);

CREATE INDEX IF NOT EXISTS idx_clicks_visitor ON clicks (visitor_id);
CREATE INDEX IF NOT EXISTS idx_filter_events_visitor ON filter_events (visitor_id);
