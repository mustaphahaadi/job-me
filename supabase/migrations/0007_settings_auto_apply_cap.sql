-- ─── 0007_settings_auto_apply_cap.sql ────────────────────────────────────────
-- Adds max_auto_apply_per_run to settings so the rate cap is configurable
-- from the UI instead of being hardcoded at 5 in the pipeline.

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS max_auto_apply_per_run int NOT NULL DEFAULT 5;

UPDATE settings SET max_auto_apply_per_run = 5 WHERE id = 1;
