-- Adds the feedback table used by POST /feedback.
--
--   npx wrangler d1 execute vcjobs --remote --file=migrations/002-feedback.sql
--
-- Additive only: no existing table is touched, so this is safe to run against a live
-- database while the site is serving.

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,
  name       TEXT,
  topic      TEXT NOT NULL,
  message    TEXT NOT NULL,
  contact    TEXT,
  page       TEXT,
  country    TEXT,
  ts         INTEGER NOT NULL,
  emailed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_feedback_ts ON feedback (ts);
CREATE INDEX IF NOT EXISTS idx_feedback_emailed ON feedback (emailed_at);
