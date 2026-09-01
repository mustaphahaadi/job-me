-- ─── 0004_fix_rls.sql ─────────────────────────────────────────────────────────
-- Fix: Replaces static placeholder with valid dynamic Postgres RLS check.
-- Restricts access to registered authenticated user(s) in auth.users.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Drop old policies ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS "owner_select_sources"     ON sources;
DROP POLICY IF EXISTS "owner_insert_sources"     ON sources;
DROP POLICY IF EXISTS "owner_update_sources"     ON sources;
DROP POLICY IF EXISTS "owner_delete_sources"     ON sources;

DROP POLICY IF EXISTS "owner_select_cv"          ON cv_versions;
DROP POLICY IF EXISTS "owner_insert_cv"          ON cv_versions;
DROP POLICY IF EXISTS "owner_update_cv"          ON cv_versions;
DROP POLICY IF EXISTS "owner_delete_cv"          ON cv_versions;

DROP POLICY IF EXISTS "owner_select_jobs"        ON jobs;
DROP POLICY IF EXISTS "owner_insert_jobs"        ON jobs;
DROP POLICY IF EXISTS "owner_update_jobs"        ON jobs;
DROP POLICY IF EXISTS "owner_delete_jobs"        ON jobs;

DROP POLICY IF EXISTS "owner_select_applications" ON applications;
DROP POLICY IF EXISTS "owner_insert_applications" ON applications;
DROP POLICY IF EXISTS "owner_update_applications" ON applications;

DROP POLICY IF EXISTS "owner_select_settings"    ON settings;
DROP POLICY IF EXISTS "owner_update_settings"    ON settings;

-- ─── Create owner policies ───────────────────────────────────────────────────

-- sources
CREATE POLICY "owner_select_sources" ON sources
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "owner_insert_sources" ON sources
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "owner_update_sources" ON sources
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "owner_delete_sources" ON sources
  FOR DELETE USING (auth.role() = 'authenticated');

-- cv_versions
CREATE POLICY "owner_select_cv" ON cv_versions
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "owner_insert_cv" ON cv_versions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "owner_update_cv" ON cv_versions
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "owner_delete_cv" ON cv_versions
  FOR DELETE USING (auth.role() = 'authenticated');

-- jobs
CREATE POLICY "owner_select_jobs" ON jobs
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "owner_insert_jobs" ON jobs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "owner_update_jobs" ON jobs
  FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "owner_delete_jobs" ON jobs
  FOR DELETE USING (auth.role() = 'authenticated');

-- applications
CREATE POLICY "owner_select_applications" ON applications
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "owner_insert_applications" ON applications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "owner_update_applications" ON applications
  FOR UPDATE USING (auth.role() = 'authenticated');

-- settings
CREATE POLICY "owner_select_settings" ON settings
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "owner_update_settings" ON settings
  FOR UPDATE USING (auth.role() = 'authenticated');

