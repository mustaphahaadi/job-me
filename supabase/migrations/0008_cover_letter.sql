-- ─── 0008_cover_letter.sql ───────────────────────────────────────────────────
-- Adds cover_letter_text to jobs so AI-generated cover letters are stored
-- per-job and visible in the dashboard drawer before/after auto-apply.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS cover_letter_text text;
