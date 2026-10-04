-- ─────────────────────────────────────────────────────────────────────────────
-- job-me · Database Schema
-- ─────────────────────────────────────────────────────────────────────────────
-- Single-file schema for a fresh Supabase (or plain Postgres) database.
-- Replaces the previous 0001–0008 individual migration files.
--
-- How to apply
-- ────────────────
-- Option A — Supabase SQL Editor:
--   Paste this file into the SQL Editor and click Run.
--
-- Option B — Supabase CLI:
--   supabase db push
--
-- Option C — plain psql:
--   psql -U <user> -d <database> -f schema.sql
--
-- Idempotent: safe to run multiple times on an existing database.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sources (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text        NOT NULL,
  type                  text        NOT NULL,
  base_url              text        NOT NULL,
  query_params          jsonb       NOT NULL DEFAULT '{}',
  active                boolean     NOT NULL DEFAULT true,
  last_scraped_at       timestamptz,
  last_scrape_status    text        CHECK (last_scrape_status IN ('success', 'failed')),
  last_scrape_error     text,
  consecutive_fail_count int        NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Enforce allowed connector types (idempotent: drops and re-adds)
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_type_check;
ALTER TABLE sources ADD CONSTRAINT sources_type_check
  CHECK (type IN ('api', 'rss', 'arbeitnow', 'jobicy', 'linkedin', 'indeed', 'glassdoor', 'otta'));

-- Backfill column for databases that pre-date migration 0003
ALTER TABLE sources ADD COLUMN IF NOT EXISTS consecutive_fail_count int NOT NULL DEFAULT 0;


CREATE TABLE IF NOT EXISTS cv_versions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text        NOT NULL,
  file_path     text        NOT NULL,
  role_tags     text[]      NOT NULL DEFAULT '{}',
  is_default_for text[]     NOT NULL DEFAULT '{}',
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE IF NOT EXISTS jobs (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id                 uuid        REFERENCES sources(id) ON DELETE SET NULL,
  title                     text        NOT NULL,
  company                   text,
  url                       text        NOT NULL UNIQUE,
  posted_date               date,
  scraped_at                timestamptz NOT NULL DEFAULT now(),
  description               text,
  raw_location              text,
  match_score               numeric,
  match_breakdown           jsonb,
  matched_keywords          text[]      NOT NULL DEFAULT '{}',
  status                    text        NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new', 'matched', 'auto_applied', 'manual_queue', 'responded', 'closed')),
  auto_apply_attempted_at   timestamptz,
  auto_apply_result         text        CHECK (auto_apply_result IN ('success', 'failed')),
  auto_apply_error          text,
  cv_version_id             uuid        REFERENCES cv_versions(id) ON DELETE SET NULL,
  cover_letter_text         text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- Backfill columns for databases that pre-date migrations 0003 / 0008
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS raw_location       text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cover_letter_text  text;


CREATE TABLE IF NOT EXISTS applications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid        REFERENCES jobs(id) ON DELETE CASCADE,
  applied_at    timestamptz NOT NULL DEFAULT now(),
  method        text        NOT NULL CHECK (method IN ('auto', 'manual')),
  cv_version_id uuid        REFERENCES cv_versions(id) ON DELETE SET NULL
);


CREATE TABLE IF NOT EXISTS settings (
  id                          int     PRIMARY KEY DEFAULT 1,
  target_roles                text[]  NOT NULL DEFAULT ARRAY[
    'Cloud Engineer', 'DevOps Engineer', 'AWS Technical Trainer',
    'AWS Instructor', 'Platform Engineer', 'Site Reliability Engineer'
  ],
  days_posted_default         int     NOT NULL DEFAULT 14,
  auto_apply_score_threshold  numeric NOT NULL DEFAULT 0.75,
  max_auto_apply_per_run      int     NOT NULL DEFAULT 5,
  target_seniority            text             DEFAULT 'mid',
  accepted_locations          text[]           DEFAULT ARRAY[
    'remote', 'worldwide', 'anywhere', 'global',
    'africa', 'west africa', 'east africa', 'south africa',
    'nigeria', 'lagos', 'kenya', 'nairobi',
    'ghana', 'accra', 'johannesburg', 'cape town',
    'egypt', 'cairo', 'morocco', 'casablanca'
  ],
  negative_keywords           text[]           DEFAULT '{}',
  skill_vocabulary            text[]           DEFAULT ARRAY[
    'aws', 'ec2', 's3', 'lambda', 'rds', 'vpc', 'iam', 'cloudformation',
    'cloudwatch', 'eks', 'ecs', 'fargate', 'route53', 'cloudfront',
    'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm',
    'ci/cd', 'github actions', 'jenkins', 'gitlab ci', 'circleci',
    'python', 'bash', 'linux', 'devops', 'sre', 'cloud',
    'monitoring', 'observability', 'prometheus', 'grafana', 'elk',
    'networking', 'load balancer', 'nginx', 'apache'
  ],
  CHECK (id = 1)
);

-- Backfill columns for databases that pre-date migrations 0006 / 0007
ALTER TABLE settings ADD COLUMN IF NOT EXISTS skill_vocabulary       text[];
ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_auto_apply_per_run int NOT NULL DEFAULT 5;


-- ─── Seed: default settings row ──────────────────────────────────────────────

INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Backfill skill_vocabulary for existing rows that were seeded before migration 0006
UPDATE settings
SET skill_vocabulary = ARRAY[
  'aws', 'ec2', 's3', 'lambda', 'rds', 'vpc', 'iam', 'cloudformation',
  'cloudwatch', 'eks', 'ecs', 'fargate', 'route53', 'cloudfront',
  'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm',
  'ci/cd', 'github actions', 'jenkins', 'gitlab ci', 'circleci',
  'python', 'bash', 'linux', 'devops', 'sre', 'cloud',
  'monitoring', 'observability', 'prometheus', 'grafana', 'elk',
  'networking', 'load balancer', 'nginx', 'apache'
]
WHERE id = 1 AND skill_vocabulary IS NULL;


-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS jobs_status_idx       ON jobs (status);
CREATE INDEX IF NOT EXISTS jobs_scraped_at_idx   ON jobs (scraped_at DESC);
CREATE INDEX IF NOT EXISTS jobs_match_score_idx  ON jobs (match_score DESC);
CREATE INDEX IF NOT EXISTS jobs_source_id_idx    ON jobs (source_id);


-- ─── Row Level Security ───────────────────────────────────────────────────────
-- This is a single-user personal tool — all policies grant access to both
-- 'authenticated' (Supabase Auth session) and 'anon' (anon key, no login).
-- The scraper uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS entirely.

ALTER TABLE sources      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cv_versions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings     ENABLE ROW LEVEL SECURITY;

-- sources
DROP POLICY IF EXISTS "owner_select_sources" ON sources;
DROP POLICY IF EXISTS "owner_insert_sources" ON sources;
DROP POLICY IF EXISTS "owner_update_sources" ON sources;
DROP POLICY IF EXISTS "owner_delete_sources" ON sources;
CREATE POLICY "owner_select_sources" ON sources FOR SELECT USING      (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_sources" ON sources FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_sources" ON sources FOR UPDATE USING      (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_sources" ON sources FOR DELETE USING      (auth.role() IN ('authenticated', 'anon'));

-- cv_versions
DROP POLICY IF EXISTS "owner_select_cv" ON cv_versions;
DROP POLICY IF EXISTS "owner_insert_cv" ON cv_versions;
DROP POLICY IF EXISTS "owner_update_cv" ON cv_versions;
DROP POLICY IF EXISTS "owner_delete_cv" ON cv_versions;
CREATE POLICY "owner_select_cv" ON cv_versions FOR SELECT USING      (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_cv" ON cv_versions FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_cv" ON cv_versions FOR UPDATE USING      (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_cv" ON cv_versions FOR DELETE USING      (auth.role() IN ('authenticated', 'anon'));

-- jobs
DROP POLICY IF EXISTS "owner_select_jobs" ON jobs;
DROP POLICY IF EXISTS "owner_insert_jobs" ON jobs;
DROP POLICY IF EXISTS "owner_update_jobs" ON jobs;
DROP POLICY IF EXISTS "owner_delete_jobs" ON jobs;
CREATE POLICY "owner_select_jobs" ON jobs FOR SELECT USING      (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_jobs" ON jobs FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_jobs" ON jobs FOR UPDATE USING      (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_jobs" ON jobs FOR DELETE USING      (auth.role() IN ('authenticated', 'anon'));

-- applications
DROP POLICY IF EXISTS "owner_select_applications" ON applications;
DROP POLICY IF EXISTS "owner_insert_applications" ON applications;
DROP POLICY IF EXISTS "owner_update_applications" ON applications;
DROP POLICY IF EXISTS "owner_delete_applications" ON applications;
CREATE POLICY "owner_select_applications" ON applications FOR SELECT USING      (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_insert_applications" ON applications FOR INSERT WITH CHECK (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_applications" ON applications FOR UPDATE USING      (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_delete_applications" ON applications FOR DELETE USING      (auth.role() IN ('authenticated', 'anon'));

-- settings (read + update only — no insert/delete, row is seeded above)
DROP POLICY IF EXISTS "owner_select_settings" ON settings;
DROP POLICY IF EXISTS "owner_update_settings" ON settings;
CREATE POLICY "owner_select_settings" ON settings FOR SELECT USING (auth.role() IN ('authenticated', 'anon'));
CREATE POLICY "owner_update_settings" ON settings FOR UPDATE USING (auth.role() IN ('authenticated', 'anon'));


-- ─── Storage: cv-files bucket policies ───────────────────────────────────────
-- Requires Supabase Storage. Skip this block if using plain Postgres.

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


-- ─── Seed: job sources ───────────────────────────────────────────────────────
-- Verified working sources. ON CONFLICT DO NOTHING = safe to re-run.

INSERT INTO sources (name, type, base_url, query_params, active) VALUES

  -- ── Remote RSS/API sources ────────────────────────────────────────────────
  ('Remotive — All Remote Jobs',           'rss', 'https://remotive.com/remote-jobs/feed',                                     '{}'::jsonb, true),
  ('Remotive — DevOps API',                'api', 'https://remotive.com/api/remote-jobs?category=devops',                      '{}'::jsonb, true),
  ('WeWorkRemotely — DevOps & Sysadmin',   'rss', 'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',     '{}'::jsonb, true),
  ('WeWorkRemotely — Back-End Programming','rss', 'https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss', '{}'::jsonb, true),
  ('WeWorkRemotely — All Remote Jobs',     'rss', 'https://weworkremotely.com/remote-jobs.rss',                                '{}'::jsonb, true),
  ('NoDesk — Remote Engineering Jobs',     'rss', 'https://nodesk.co/remote-jobs/index.xml',                                   '{}'::jsonb, true),
  ('HackerNews — Remote Tech Jobs',        'rss', 'https://hnrss.org/jobs',                                                    '{}'::jsonb, true),
  ('RemoteOK — DevOps',                    'api', 'https://remoteok.com/api?tag=devops',                                       '{}'::jsonb, true),
  ('RemoteOK — AWS',                       'api', 'https://remoteok.com/api?tag=aws',                                          '{}'::jsonb, true),
  ('RemoteOK — Cloud',                     'api', 'https://remoteok.com/api?tag=cloud',                                        '{}'::jsonb, true),
  ('Dev.to — Remote Engineering Feed',     'rss', 'https://dev.to/feed/tag/job',                                               '{}'::jsonb, true),

  -- ── Jobicy ───────────────────────────────────────────────────────────────
  ('Jobicy — DevOps',     'jobicy', 'https://jobicy.com/api/v2/remote-jobs', '{"tag": "devops",      "count": "50"}'::jsonb, true),
  ('Jobicy — AWS',        'jobicy', 'https://jobicy.com/api/v2/remote-jobs', '{"tag": "aws",         "count": "50"}'::jsonb, true),
  ('Jobicy — Kubernetes', 'jobicy', 'https://jobicy.com/api/v2/remote-jobs', '{"tag": "kubernetes",  "count": "50"}'::jsonb, true),

  -- ── Arbeitnow ────────────────────────────────────────────────────────────
  ('Arbeitnow — DevOps Remote',   'arbeitnow', 'https://www.arbeitnow.com/api/job-board-api', '{"search": "devops engineer"}'::jsonb,  true),
  ('Arbeitnow — Cloud Engineer',  'arbeitnow', 'https://www.arbeitnow.com/api/job-board-api', '{"search": "cloud engineer"}'::jsonb,   true),

  -- ── LinkedIn: Remote (worldwide) ─────────────────────────────────────────
  ('LinkedIn — DevOps Remote',           'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "devops engineer",       "location": "Worldwide", "f_WT": "2", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — Cloud Engineer Remote',   'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "cloud engineer",        "location": "Worldwide", "f_WT": "2", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — AWS Instructor Remote',   'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "aws instructor trainer", "location": "Worldwide", "f_WT": "2", "f_TPR": "r604800"}'::jsonb, true),

  -- ── LinkedIn: Africa on-site ──────────────────────────────────────────────
  ('LinkedIn — DevOps Lagos',            'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "devops engineer",          "location": "Lagos, Nigeria",           "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — Cloud Engineer Lagos',    'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "cloud engineer",           "location": "Lagos, Nigeria",           "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — DevOps Nairobi',          'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "devops engineer",          "location": "Nairobi, Kenya",           "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — SRE Johannesburg',        'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "site reliability engineer","location": "Johannesburg, South Africa","f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — DevOps Accra',            'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "devops engineer",          "location": "Accra, Ghana",             "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — Cloud Engineer Accra',    'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "cloud engineer",           "location": "Accra, Ghana",             "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — IT Infrastructure Ghana', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "it infrastructure",        "location": "Ghana",                    "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — Cloud Engineer Cairo',    'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "cloud engineer",           "location": "Cairo, Egypt",             "f_TPR": "r604800"}'::jsonb, true)

ON CONFLICT DO NOTHING;
