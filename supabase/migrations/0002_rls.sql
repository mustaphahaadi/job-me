-- ─── 0002_rls.sql ─────────────────────────────────────────────────────────────
-- Row Level Security: single-owner policy.
-- The frontend uses the anon key + Supabase Auth session → RLS enforced.
-- The scraper uses the service-role key → bypasses RLS for writes.

alter table sources enable row level security;
alter table cv_versions enable row level security;
alter table jobs enable row level security;
alter table applications enable row level security;
alter table settings enable row level security;

-- ─── sources ─────────────────────────────────────────────────────────────────

create policy "owner_select_sources" on sources
  for select using (auth.role() = 'authenticated');

create policy "owner_insert_sources" on sources
  for insert with check (auth.role() = 'authenticated');

create policy "owner_update_sources" on sources
  for update using (auth.role() = 'authenticated');

create policy "owner_delete_sources" on sources
  for delete using (auth.role() = 'authenticated');

-- ─── cv_versions ─────────────────────────────────────────────────────────────

create policy "owner_select_cv" on cv_versions
  for select using (auth.role() = 'authenticated');

create policy "owner_insert_cv" on cv_versions
  for insert with check (auth.role() = 'authenticated');

create policy "owner_update_cv" on cv_versions
  for update using (auth.role() = 'authenticated');

create policy "owner_delete_cv" on cv_versions
  for delete using (auth.role() = 'authenticated');

-- ─── jobs ─────────────────────────────────────────────────────────────────────

create policy "owner_select_jobs" on jobs
  for select using (auth.role() = 'authenticated');

create policy "owner_insert_jobs" on jobs
  for insert with check (auth.role() = 'authenticated');

create policy "owner_update_jobs" on jobs
  for update using (auth.role() = 'authenticated');

create policy "owner_delete_jobs" on jobs
  for delete using (auth.role() = 'authenticated');

-- ─── applications ─────────────────────────────────────────────────────────────

create policy "owner_select_applications" on applications
  for select using (auth.role() = 'authenticated');

create policy "owner_insert_applications" on applications
  for insert with check (auth.role() = 'authenticated');

create policy "owner_update_applications" on applications
  for update using (auth.role() = 'authenticated');

-- ─── settings ─────────────────────────────────────────────────────────────────

create policy "owner_select_settings" on settings
  for select using (auth.role() = 'authenticated');

create policy "owner_update_settings" on settings
  for update using (auth.role() = 'authenticated');
