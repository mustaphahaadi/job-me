-- ─── 0004_fix_rls.sql ─────────────────────────────────────────────────────────
-- Fix: RLS policies previously used auth.role() = 'authenticated' which allows
-- ANY Supabase user. This migration replaces them with owner-uid checks.
--
-- SETUP REQUIRED:
--   1. Get your Supabase Auth UID:
--      SELECT id FROM auth.users WHERE email = 'your@email.com';
--   2. Replace every occurrence of '<OWNER_UID>' below with your real UUID.
--      Example:  'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Drop old role-based policies ────────────────────────────────────────────

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

-- ─── Create owner-uid-gated policies ─────────────────────────────────────────
-- Replace '<OWNER_UID>' with your actual UUID from auth.users.

-- sources
CREATE POLICY "owner_select_sources" ON sources
  FOR SELECT USING (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_insert_sources" ON sources
  FOR INSERT WITH CHECK (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_update_sources" ON sources
  FOR UPDATE USING (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_delete_sources" ON sources
  FOR DELETE USING (auth.uid() = '<OWNER_UID>'::uuid);

-- cv_versions
CREATE POLICY "owner_select_cv" ON cv_versions
  FOR SELECT USING (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_insert_cv" ON cv_versions
  FOR INSERT WITH CHECK (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_update_cv" ON cv_versions
  FOR UPDATE USING (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_delete_cv" ON cv_versions
  FOR DELETE USING (auth.uid() = '<OWNER_UID>'::uuid);

-- jobs
CREATE POLICY "owner_select_jobs" ON jobs
  FOR SELECT USING (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_insert_jobs" ON jobs
  FOR INSERT WITH CHECK (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_update_jobs" ON jobs
  FOR UPDATE USING (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_delete_jobs" ON jobs
  FOR DELETE USING (auth.uid() = '<OWNER_UID>'::uuid);

-- applications
CREATE POLICY "owner_select_applications" ON applications
  FOR SELECT USING (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_insert_applications" ON applications
  FOR INSERT WITH CHECK (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_update_applications" ON applications
  FOR UPDATE USING (auth.uid() = '<OWNER_UID>'::uuid);

-- settings
CREATE POLICY "owner_select_settings" ON settings
  FOR SELECT USING (auth.uid() = '<OWNER_UID>'::uuid);
CREATE POLICY "owner_update_settings" ON settings
  FOR UPDATE USING (auth.uid() = '<OWNER_UID>'::uuid);
