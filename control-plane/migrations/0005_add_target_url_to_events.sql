-- migrations/0005_add_target_url_to_events.sql
-- Adds target_url column to events table (missing from 0003 migration)

ALTER TABLE events ADD COLUMN target_url TEXT;
