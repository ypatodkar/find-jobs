-- Separate from the analytics jobs table, which also contains stubs from clicks.
CREATE TABLE IF NOT EXISTS job_catalogue (
  job_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  posted_at TIMESTAMPTZ,
  salary_top DOUBLE PRECISION NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  description_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', description), 'B')
  ) STORED
);
CREATE INDEX IF NOT EXISTS catalogue_newest ON job_catalogue (posted_at DESC, job_id) WHERE active;
CREATE INDEX IF NOT EXISTS catalogue_company ON job_catalogue (company, job_id) WHERE active;
CREATE INDEX IF NOT EXISTS catalogue_fields ON job_catalogue USING GIN (payload) WHERE active;
CREATE INDEX IF NOT EXISTS catalogue_search ON job_catalogue USING GIN (search_vector) WHERE active;
CREATE TABLE IF NOT EXISTS catalogue_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  metadata JSONB NOT NULL
);
-- Résumé text is never persisted. Cache keys are HMACs; values contain scores only.
CREATE TABLE IF NOT EXISTS resume_match_cache (
  cache_key TEXT PRIMARY KEY,
  result JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS match_cache_expiry ON resume_match_cache (expires_at);
CREATE TABLE IF NOT EXISTS match_quota (
  quota_key TEXT NOT NULL,
  bucket BIGINT NOT NULL,
  uses INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (quota_key, bucket)
);

-- Match traces. One row per shortlist run, kept so a confusing result can be opened
-- weeks later rather than reproduced from memory.
--
-- Deliberately separate from the analytics tables next to it. Traces are append-heavy
-- and disposable; clicks and users are neither, and a burst of the first must never
-- fill the disk holding the second. The retention sweep below is what enforces that —
-- a second database would cost more and guarantee less.
--
-- Summary columns are duplicated out of the JSONB so the dashboard's list view never
-- parses 14 KB per row to show a date and a count.
CREATE TABLE IF NOT EXISTS match_trace (
  run_id      TEXT PRIMARY KEY,
  at          BIGINT NOT NULL,
  resume_hash TEXT NOT NULL,          -- HMAC of the résumé, never the text
  window_days INTEGER,
  pooled      INTEGER,
  shortlisted INTEGER,
  assessed    INTEGER,
  failed      INTEGER,
  ms          INTEGER,
  provider    TEXT,                   -- how title ranking went
  trace       JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_trace_at ON match_trace (at DESC);
