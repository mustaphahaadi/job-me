-- ─── 0003_schema_fixes.sql ────────────────────────────────────────────────────
-- Adds raw_location to jobs (required by location scoring) and
-- consecutive_fail_count to sources (required by the 3-failure error rule).

-- Jobs: raw_location was attempted in scraper but column was missing from schema.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS raw_location text;

-- Sources: track consecutive failures so the UI can enforce the "3 failures" rule.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS consecutive_fail_count int NOT NULL DEFAULT 0;
