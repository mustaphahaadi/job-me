-- ─── job-me Consolidated Database Schema ───────────────────────────────────────────
-- This file consolidates all migrations (0001-0008) into a single Postgres-compatible
-- schema file for easy import into a fresh database.
-- 
-- To import: psql -U your_user -d your_database -f consolidated_schema.sql
-- ─────────────────────────────────────────────────────────────────────────────────────

-- ─── Tables ────────────────────────────────────────────────────────────────────────

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('api', 'rss', 'arbeitnow', 'jobicy', 'linkedin', 'indeed', 'glassdoor', 'otta')),
  base_url text not null,
  query_params jsonb default '{}',
  active boolean default true,
  last_scraped_at timestamptz,
  last_scrape_status text check (last_scrape_status in ('success','failed')),
  last_scrape_error text,
  consecutive_fail_count int not null default 0,
  created_at timestamptz default now()
);

-- Ensure check constraint and columns are updated on existing databases
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_type_check;
ALTER TABLE sources ADD CONSTRAINT sources_type_check
  CHECK (type IN ('api', 'rss', 'arbeitnow', 'jobicy', 'linkedin', 'indeed', 'glassdoor', 'otta'));

ALTER TABLE sources ADD COLUMN IF NOT EXISTS consecutive_fail_count int not null default 0;

create table if not exists cv_versions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  file_path text not null,
  role_tags text[] default '{}',
  is_default_for text[] default '{}',
  uploaded_at timestamptz default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete set null,
  title text not null,
  company text,
  url text not null unique,
  posted_date date,
  scraped_at timestamptz default now(),
  description text,
  raw_location text,
  match_score numeric,
  match_breakdown jsonb,
  matched_keywords text[] default '{}',
  status text not null default 'new'
    check (status in ('new','matched','auto_applied','manual_queue','responded','closed')),
  auto_apply_attempted_at timestamptz,
  auto_apply_result text check (auto_apply_result in ('success','failed')),
  auto_apply_error text,
  cv_version_id uuid references cv_versions(id) on delete set null,
  cover_letter_text text,
  created_at timestamptz default now()
);

create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  applied_at timestamptz default now(),
  method text not null check (method in ('auto','manual')),
  cv_version_id uuid references cv_versions(id) on delete set null
);

create table if not exists settings (
  id int primary key default 1,
  target_roles text[] default array['Cloud Engineer','DevOps Engineer','AWS Technical Trainer','AWS Instructor'],
  days_posted_default int default 14,
  auto_apply_score_threshold numeric default 0.75,
  max_auto_apply_per_run int not null default 5,
  target_seniority text default 'mid',
  accepted_locations text[] default array['remote', 'worldwide', 'anywhere', 'global', 'africa', 'west africa', 'east africa', 'south africa', 'nigeria', 'lagos', 'kenya', 'nairobi', 'ghana', 'accra', 'south africa', 'johannesburg', 'cape town', 'egypt', 'cairo', 'morocco', 'casablanca'],
  negative_keywords text[] default '{}',
  skill_vocabulary text[] default array[
    'aws', 'ec2', 's3', 'lambda', 'rds', 'vpc', 'iam', 'cloudformation',
    'cloudwatch', 'eks', 'ecs', 'fargate', 'route53', 'cloudfront',
    'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm',
    'ci/cd', 'github actions', 'jenkins', 'gitlab ci', 'circleci',
    'python', 'bash', 'linux', 'devops', 'sre', 'cloud',
    'monitoring', 'observability', 'prometheus', 'grafana', 'elk',
    'networking', 'load balancer', 'nginx', 'apache'
  ],
  check (id = 1)
);

-- Ensure columns exist on existing databases
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cover_letter_text text;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS skill_vocabulary text[];

-- ─── Seed default settings row ─────────────────────────────────────────────────────

insert into settings (id) values (1) on conflict (id) do nothing;

-- ─── Indexes ──────────────────────────────────────────────────────────────────────

create index if not exists jobs_status_idx on jobs (status);
create index if not exists jobs_scraped_at_idx on jobs (scraped_at desc);
create index if not exists jobs_match_score_idx on jobs (match_score desc);
create index if not exists jobs_source_id_idx on jobs (source_id);

-- ─── Row Level Security Policies ───────────────────────────────────────────────────
-- Allows both 'anon' (using VITE_SUPABASE_ANON_KEY) and 'authenticated' roles
-- to access single-user database tables.

alter table sources enable row level security;
alter table cv_versions enable row level security;
alter table jobs enable row level security;
alter table applications enable row level security;
alter table settings enable row level security;

-- sources
DROP POLICY IF EXISTS "owner_select_sources" ON sources;
DROP POLICY IF EXISTS "owner_insert_sources" ON sources;
DROP POLICY IF EXISTS "owner_update_sources" ON sources;
DROP POLICY IF EXISTS "owner_delete_sources" ON sources;
CREATE POLICY "owner_select_sources" ON sources FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_sources" ON sources FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_sources" ON sources FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_sources" ON sources FOR DELETE USING (auth.role() IN ('authenticated', 'anon'));

-- cv_versions
DROP POLICY IF EXISTS "owner_select_cv" ON cv_versions;
DROP POLICY IF EXISTS "owner_insert_cv" ON cv_versions;
DROP POLICY IF EXISTS "owner_update_cv" ON cv_versions;
DROP POLICY IF EXISTS "owner_delete_cv" ON cv_versions;
CREATE POLICY "owner_select_cv" ON cv_versions FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_cv" ON cv_versions FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_cv" ON cv_versions FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_cv" ON cv_versions FOR DELETE USING (auth.role() IN ('authenticated', 'anon'));

-- jobs
DROP POLICY IF EXISTS "owner_select_jobs" ON jobs;
DROP POLICY IF EXISTS "owner_insert_jobs" ON jobs;
DROP POLICY IF EXISTS "owner_update_jobs" ON jobs;
DROP POLICY IF EXISTS "owner_delete_jobs" ON jobs;
CREATE POLICY "owner_select_jobs" ON jobs FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_jobs" ON jobs FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_jobs" ON jobs FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_jobs" ON jobs FOR DELETE USING (auth.role() IN ('authenticated', 'anon'));

-- applications
DROP POLICY IF EXISTS "owner_select_applications" ON applications;
DROP POLICY IF EXISTS "owner_insert_applications" ON applications;
DROP POLICY IF EXISTS "owner_update_applications" ON applications;
DROP POLICY IF EXISTS "owner_delete_applications" ON applications;
CREATE POLICY "owner_select_applications" ON applications FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_applications" ON applications FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_applications" ON applications FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_applications" ON applications FOR DELETE USING (auth.role() IN ('authenticated', 'anon'));

-- settings
DROP POLICY IF EXISTS "owner_select_settings" ON settings;
DROP POLICY IF EXISTS "owner_update_settings" ON settings;
CREATE POLICY "owner_select_settings" ON settings FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_settings" ON settings FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));

-- ─── Supabase Storage Policies for bucket 'cv-files' ──────────────────────────────
-- Note: These policies require Supabase Storage. If using plain Postgres, skip this section.

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

-- ─── Seed Verified Live Job Sources ─────────────────────────────────────────────────

INSERT INTO sources (name, type, base_url, query_params, active)
VALUES 
  -- Remote Job Sources (Priority - Worldwide) - Tested and Working
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
  ('Dev.to — Remote Engineering Feed', 'rss', 'https://dev.to/feed/tag/job', '{}'::jsonb, true),
  ('Jobicy — DevOps Remote Jobs', 'jobicy', 'https://jobicy.com/api/v2/remote-jobs', '{"tag": "devops", "count": "50"}'::jsonb, true),
  ('Jobicy — AWS Remote Jobs', 'jobicy', 'https://jobicy.com/api/v2/remote-jobs', '{"tag": "aws", "count": "50"}'::jsonb, true),
  ('Jobicy — Kubernetes Remote Jobs', 'jobicy', 'https://jobicy.com/api/v2/remote-jobs', '{"tag": "kubernetes", "count": "50"}'::jsonb, true),
  -- LinkedIn Sources (Remote + Africa On-site) - Tested and Working
  ('LinkedIn — DevOps Remote Jobs', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "devops engineer", "location": "Worldwide", "f_WT": "2", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — Cloud Engineer Remote Jobs', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "cloud engineer", "location": "Worldwide", "f_WT": "2", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — AWS Instructor Remote Jobs', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "aws instructor trainer", "location": "Worldwide", "f_WT": "2", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — DevOps Lagos (On-site)', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "devops engineer", "location": "Lagos, Nigeria", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — Cloud Engineer Lagos (On-site)', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "cloud engineer", "location": "Lagos, Nigeria", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — DevOps Nairobi (On-site)', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "devops engineer", "location": "Nairobi, Kenya", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — SRE Johannesburg (On-site)', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "site reliability engineer", "location": "Johannesburg, South Africa", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — DevOps Accra (On-site)', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "devops engineer", "location": "Accra, Ghana", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — Cloud Engineer Accra (On-site)', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "cloud engineer", "location": "Accra, Ghana", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — IT Infrastructure Ghana (On-site)', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "it infrastructure", "location": "Ghana", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — Cloud Engineer Cairo (On-site)', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "cloud engineer", "location": "Cairo, Egypt", "f_TPR": "r604800"}'::jsonb, true)
ON CONFLICT DO NOTHING;
