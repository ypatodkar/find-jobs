-- Drops the OAuth account system and promotes the anonymous visitor table to be the
-- only notion of a person in this schema.
--
--   npx wrangler d1 execute vcjobs --remote --file=migrations/001-drop-accounts-rename-visitors.sql
--
-- Sign-in was never used (users/sessions/seen_jobs were all 0 rows in production), so
-- there is nothing to preserve from them. Order matters: `visitors` cannot be renamed
-- to `users` until the old `users` table is gone.

DROP TABLE IF EXISTS seen_jobs;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

ALTER TABLE visitors RENAME TO users;

-- The renamed table keeps its own column names, so its primary key has to be renamed
-- too — otherwise `users` still has a `visitor_id` column.
ALTER TABLE users RENAME COLUMN visitor_id TO user_id;

ALTER TABLE clicks RENAME COLUMN visitor_id TO user_id;
ALTER TABLE filter_events RENAME COLUMN visitor_id TO user_id;

-- SQLite carries indexes through a column rename but keeps their original names, so
-- these are recreated purely so the name matches the column again.
DROP INDEX IF EXISTS idx_clicks_visitor;
DROP INDEX IF EXISTS idx_filter_events_visitor;
CREATE INDEX IF NOT EXISTS idx_clicks_user ON clicks (user_id);
CREATE INDEX IF NOT EXISTS idx_filter_events_user ON filter_events (user_id);
