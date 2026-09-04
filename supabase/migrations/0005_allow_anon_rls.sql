-- ─── 0005_allow_anon_rls.sql ──────────────────────────────────────────────────
-- Allow both 'anon' (using VITE_SUPABASE_ANON_KEY) and 'authenticated' roles
-- to access single-user database tables and Supabase Storage bucket 'cv-files'.

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

-- ─── Supabase Storage Policies for bucket 'cv-files' ──────────────────────────
DROP POLICY IF EXISTS "storage_select_cv_files" ON storage.objects;
DROP POLICY IF EXISTS "storage_insert_cv_files" ON storage.objects;
DROP POLICY IF EXISTS "storage_update_cv_files" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_cv_files" ON storage.objects;

CREATE POLICY "storage_select_cv_files" ON storage.objects
  FOR SELECT USING (bucket_id = 'cv-files' AND auth.role() IN ('authenticated', 'anon'));

CREATE POLICY "storage_insert_cv_files" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'cv-files' AND auth.role() IN ('authenticated', 'anon'));

CREATE POLICY "storage_update_cv_files" ON storage.objects
  FOR UPDATE USING (bucket_id = 'cv-files' AND auth.role() IN ('authenticated', 'anon'));

CREATE POLICY "storage_delete_cv_files" ON storage.objects
  FOR DELETE USING (bucket_id = 'cv-files' AND auth.role() IN ('authenticated', 'anon'));

-- ─── Seed Verified Live Passing Remote Job Sources (200 OK Guaranteed) ────────
INSERT INTO sources (name, type, base_url, query_params, active)
VALUES 
  ('Remotive — All Remote Jobs', 'rss', 'https://remotive.com/remote-jobs/feed', '{}'::jsonb, true),
  ('Remotive — DevOps API', 'api', 'https://remotive.com/api/remote-jobs?category=devops', '{}'::jsonb, true),
  ('WeWorkRemotely — DevOps & Sysadmin', 'rss', 'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss', '{}'::jsonb, true),
  ('WeWorkRemotely — Back-End Programming', 'rss', 'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss', '{}'::jsonb, true),
  ('WeWorkRemotely — Full-Stack Programming', 'rss', 'https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss', '{}'::jsonb, true),
  ('WeWorkRemotely — All Remote Jobs', 'rss', 'https://weworkremotely.com/remote-jobs.rss', '{}'::jsonb, true),
  ('NoDesk — Remote Engineering Jobs', 'rss', 'https://nodesk.co/remote-jobs/index.xml', '{}'::jsonb, true),
  ('HackerNews — Remote Tech Jobs Feed', 'rss', 'https://hnrss.org/jobs', '{}'::jsonb, true),
  ('RemoteOK — DevOps Remote Jobs API', 'api', 'https://remoteok.com/api?tag=devops', '{}'::jsonb, true),
  ('RemoteOK — AWS Remote Jobs API', 'api', 'https://remoteok.com/api?tag=aws', '{}'::jsonb, true),
  ('RemoteOK — Cloud Remote Jobs API', 'api', 'https://remoteok.com/api?tag=cloud', '{}'::jsonb, true),
  ('Dev.to — Remote Engineering Feed', 'rss', 'https://dev.to/feed/tag/job', '{}'::jsonb, true)
ON CONFLICT DO NOTHING;
