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
