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
  user_id TEXT,               -- anonymous per-browser id, see users
  ts      INTEGER NOT NULL,     -- unix ms
  page    TEXT,                 -- all.html | firm.html
  firm    TEXT,                 -- investor page the click came from, if any
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_clicks_job ON clicks(job_id);
CREATE INDEX IF NOT EXISTS idx_clicks_ts ON clicks(ts);

-- Filter activity. One row per saved view, so you can see which slices people care
-- enough about to keep. No identity attached: this is aggregate product feedback,
-- not a per-user trail.
CREATE TABLE IF NOT EXISTS filter_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,               -- anonymous per-browser id, see users
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

-- Anonymous users. `user_id` is a UUID the browser mints for itself — no email, no
-- password, no IP, nothing that identifies a person on its own. `name` is whatever
-- they chose to type when asked, and is optional: skipping leaves it NULL and
-- everything still works. This is a friendly label on a pseudonymous id, not an
-- account you can sign in to.
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  name       TEXT,
  liked_at   INTEGER,          -- when they tapped the heart; NULL = never. One-way.
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  country    TEXT
);

CREATE INDEX IF NOT EXISTS idx_clicks_user ON clicks (user_id);
CREATE INDEX IF NOT EXISTS idx_filter_events_user ON filter_events (user_id);

-- Free-text feedback from the widget in the corner of the page. Written here first and
-- emailed second, so a mail outage or a bad API key loses a notification, never the
-- feedback itself — `emailed_at` records which rows actually got delivered.
--
-- `user_id` is the same anonymous browser id the rest of the schema uses, attached so a
-- reply-less "the filters are confusing" can be read next to what that browser actually
-- clicked. `contact` is optional and only present if they typed it.
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  name       TEXT,              -- their display name at the time, if they gave one
  topic      TEXT NOT NULL,     -- jobs | filters | design | bug | other
  message    TEXT NOT NULL,
  contact    TEXT,              -- optional email, only if they want a reply
  page       TEXT,
  country    TEXT,
  ts         INTEGER NOT NULL,
  emailed_at INTEGER            -- NULL = stored but the email never went out
);

CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback (ts);
CREATE INDEX IF NOT EXISTS idx_feedback_emailed ON feedback (emailed_at);
