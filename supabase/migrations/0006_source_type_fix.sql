-- ─── 0006_source_type_fix.sql ─────────────────────────────────────────────────
-- 1. Widens sources.type constraint to include arbeitnow, jobicy, linkedin,
--    indeed, glassdoor, otta (previously only 'api' and 'rss' were allowed,
--    causing inserts for seeded arbeitnow/jobicy rows to fail the check).
-- 2. Fixes seeded sources that were inserted with type='api' but need a
--    dedicated connector type.
-- 3. Adds missing DELETE policy on applications.
-- 4. Adds skill_vocabulary column to settings so users can customise their
--    skill set from the UI instead of it being a hardcoded constant.
-- 5. Seeds LinkedIn and Indeed RSS sources.

-- ─── 1. Widen sources.type constraint ────────────────────────────────────────

ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_type_check;
ALTER TABLE sources ADD CONSTRAINT sources_type_check
  CHECK (type IN ('api', 'rss', 'arbeitnow', 'jobicy', 'linkedin', 'indeed', 'glassdoor', 'otta'));

-- ─── 2. Fix seeded source types ───────────────────────────────────────────────
-- Jobicy sources were seeded with type='api'; they need type='jobicy' so the
-- scraper routes them to the dedicated JobicyConnector.
UPDATE sources SET type = 'jobicy'
  WHERE base_url LIKE '%jobicy.com%' AND type = 'api';

-- Arbeitnow sources were seeded with type='api'; they need type='arbeitnow'.
UPDATE sources SET type = 'arbeitnow'
  WHERE base_url LIKE '%arbeitnow.com%' AND type = 'api';

-- ─── 3. Missing DELETE policy on applications ─────────────────────────────────

DROP POLICY IF EXISTS "owner_delete_applications" ON applications;
CREATE POLICY "owner_delete_applications" ON applications
  FOR DELETE USING (auth.role() IN ('authenticated', 'anon'));

-- ─── 4. skill_vocabulary on settings ─────────────────────────────────────────

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS skill_vocabulary text[] DEFAULT ARRAY[
    'aws', 'ec2', 's3', 'lambda', 'rds', 'vpc', 'iam', 'cloudformation',
    'cloudwatch', 'eks', 'ecs', 'fargate', 'route53', 'cloudfront',
    'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm',
    'ci/cd', 'github actions', 'jenkins', 'gitlab ci', 'circleci',
    'python', 'bash', 'linux', 'devops', 'sre', 'cloud',
    'monitoring', 'observability', 'prometheus', 'grafana', 'elk',
    'networking', 'load balancer', 'nginx', 'apache'
  ];

-- Backfill existing settings row
UPDATE settings SET skill_vocabulary = ARRAY[
  'aws', 'ec2', 's3', 'lambda', 'rds', 'vpc', 'iam', 'cloudformation',
  'cloudwatch', 'eks', 'ecs', 'fargate', 'route53', 'cloudfront',
  'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm',
  'ci/cd', 'github actions', 'jenkins', 'gitlab ci', 'circleci',
  'python', 'bash', 'linux', 'devops', 'sre', 'cloud',
  'monitoring', 'observability', 'prometheus', 'grafana', 'elk',
  'networking', 'load balancer', 'nginx', 'apache'
] WHERE id = 1 AND skill_vocabulary IS NULL;

-- ─── 5. Seed LinkedIn and Indeed RSS sources ──────────────────────────────────
-- LinkedIn public job RSS feeds (no auth required for public searches).
-- Indeed RSS feeds (public, no key required).
-- Jobicy dedicated connector sources.
-- Otta (now Workable) public API.

INSERT INTO sources (name, type, base_url, query_params, active)
VALUES
  -- LinkedIn public RSS (keyword-based, remote filter)
  ('LinkedIn — DevOps Remote Jobs', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "devops engineer", "location": "Worldwide", "f_WT": "2", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — Cloud Engineer Remote Jobs', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "cloud engineer", "location": "Worldwide", "f_WT": "2", "f_TPR": "r604800"}'::jsonb, true),
  ('LinkedIn — AWS Instructor Remote Jobs', 'linkedin', 'https://www.linkedin.com/jobs/search', '{"keywords": "aws instructor trainer", "location": "Worldwide", "f_WT": "2", "f_TPR": "r604800"}'::jsonb, true),
  -- Indeed RSS (public, no key required)
  ('Indeed — DevOps Remote Jobs', 'indeed', 'https://www.indeed.com/rss', '{"q": "devops engineer", "l": "Remote", "sort": "date"}'::jsonb, true),
  ('Indeed — Cloud Engineer Remote Jobs', 'indeed', 'https://www.indeed.com/rss', '{"q": "cloud engineer", "l": "Remote", "sort": "date"}'::jsonb, true),
  ('Indeed — SRE Remote Jobs', 'indeed', 'https://www.indeed.com/rss', '{"q": "site reliability engineer", "l": "Remote", "sort": "date"}'::jsonb, true),
  -- Jobicy dedicated connector sources
  ('Jobicy — DevOps Remote Jobs', 'jobicy', 'https://jobicy.com/api/v2/remote-jobs', '{"tag": "devops", "count": "50"}'::jsonb, true),
  ('Jobicy — AWS Remote Jobs', 'jobicy', 'https://jobicy.com/api/v2/remote-jobs', '{"tag": "aws", "count": "50"}'::jsonb, true),
  ('Jobicy — Kubernetes Remote Jobs', 'jobicy', 'https://jobicy.com/api/v2/remote-jobs', '{"tag": "kubernetes", "count": "50"}'::jsonb, true),
  -- Arbeitnow dedicated connector
  ('Arbeitnow — DevOps Remote Jobs', 'arbeitnow', 'https://www.arbeitnow.com/api/job-board-api', '{"search": "devops engineer"}'::jsonb, true),
  ('Arbeitnow — Cloud Engineer Remote Jobs', 'arbeitnow', 'https://www.arbeitnow.com/api/job-board-api', '{"search": "cloud engineer"}'::jsonb, true)
ON CONFLICT DO NOTHING;
