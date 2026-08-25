-- ─── 0001_init.sql ────────────────────────────────────────────────────────────
-- Run via: supabase db push
-- Schema from §7 of the design spec + match_breakdown column added per §8.3

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('api', 'rss')),
  base_url text not null,
  query_params jsonb default '{}',
  active boolean default true,
  last_scraped_at timestamptz,
  last_scrape_status text check (last_scrape_status in ('success','failed')),
  last_scrape_error text,
  created_at timestamptz default now()
);

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
  url text not null unique,  -- dedupe key for upsert
  posted_date date,
  scraped_at timestamptz default now(),
  description text,
  match_score numeric,
  match_breakdown jsonb,  -- §8.3: per-signal scores + weights
  matched_keywords text[] default '{}',
  status text not null default 'new'
    check (status in ('new','matched','auto_applied','manual_queue','responded','closed')),
  auto_apply_attempted_at timestamptz,
  auto_apply_result text check (auto_apply_result in ('success','failed')),
  auto_apply_error text,
  cv_version_id uuid references cv_versions(id) on delete set null,
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
  target_seniority text default 'mid',
  accepted_locations text[] default array['remote'],
  negative_keywords text[] default '{}',
  check (id = 1)
);

-- Seed a default settings row (single-user — always id=1)
insert into settings (id) values (1) on conflict (id) do nothing;

-- ─── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists jobs_status_idx on jobs (status);
create index if not exists jobs_scraped_at_idx on jobs (scraped_at desc);
create index if not exists jobs_match_score_idx on jobs (match_score desc);
create index if not exists jobs_source_id_idx on jobs (source_id);
