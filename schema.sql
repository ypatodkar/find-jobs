-- D1 schema for job metadata and click tracking.
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
  ts      INTEGER NOT NULL,     -- unix ms
  page    TEXT,                 -- all.html | firm.html
  firm    TEXT,                 -- investor page the click came from, if any
  country TEXT
);

CREATE INDEX IF NOT EXISTS idx_clicks_job ON clicks(job_id);
CREATE INDEX IF NOT EXISTS idx_clicks_ts ON clicks(ts);
