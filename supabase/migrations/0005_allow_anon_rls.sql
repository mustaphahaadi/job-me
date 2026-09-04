-- ─── 0005_allow_anon_rls.sql ──────────────────────────────────────────────────
-- Allow both 'anon' (using VITE_SUPABASE_ANON_KEY) and 'authenticated' roles
-- to access single-user tables without 401 Unauthorized errors on the web app.

-- ─── sources ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "owner_select_sources" ON sources;
DROP POLICY IF EXISTS "owner_insert_sources" ON sources;
DROP POLICY IF EXISTS "owner_update_sources" ON sources;
DROP POLICY IF EXISTS "owner_delete_sources" ON sources;

CREATE POLICY "owner_select_sources" ON sources FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_sources" ON sources FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_sources" ON sources FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_sources" ON sources FOR DELETE USING (auth.role() IN ('authenticated', 'anon'));

-- ─── cv_versions ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "owner_select_cv" ON cv_versions;
DROP POLICY IF EXISTS "owner_insert_cv" ON cv_versions;
DROP POLICY IF EXISTS "owner_update_cv" ON cv_versions;
DROP POLICY IF EXISTS "owner_delete_cv" ON cv_versions;

CREATE POLICY "owner_select_cv" ON cv_versions FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_cv" ON cv_versions FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_cv" ON cv_versions FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_cv" ON cv_versions FOR DELETE USING (auth.role() IN ('authenticated', 'anon'));

-- ─── jobs ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "owner_select_jobs" ON jobs;
DROP POLICY IF EXISTS "owner_insert_jobs" ON jobs;
DROP POLICY IF EXISTS "owner_update_jobs" ON jobs;
DROP POLICY IF EXISTS "owner_delete_jobs" ON jobs;

CREATE POLICY "owner_select_jobs" ON jobs FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_jobs" ON jobs FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_jobs" ON jobs FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_jobs" ON jobs FOR DELETE USING (auth.role() IN ('authenticated', 'anon'));

-- ─── applications ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "owner_select_applications" ON applications;
DROP POLICY IF EXISTS "owner_insert_applications" ON applications;
DROP POLICY IF EXISTS "owner_update_applications" ON applications;

CREATE POLICY "owner_select_applications" ON applications FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_applications" ON applications FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_applications" ON applications FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));

-- ─── settings ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "owner_select_settings" ON settings;
DROP POLICY IF EXISTS "owner_update_settings" ON settings;

CREATE POLICY "owner_select_settings" ON settings FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_settings" ON settings FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));

-- ─── Seed initial active sources ──────────────────────────────────────────────
INSERT INTO sources (name, type, base_url, query_params, active)
VALUES 
  ('Remotive DevOps Jobs Feed', 'rss', 'https://remotive.com/remote-jobs/feed/dev-ops', '{}'::jsonb, true),
  ('Weworkremotely DevOps Jobs', 'rss', 'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss', '{}'::jsonb, true)
ON CONFLICT DO NOTHING;
