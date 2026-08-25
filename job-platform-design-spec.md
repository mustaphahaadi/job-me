# Job Application Platform — Full Build Spec

Hand this entire document to the coding agent. It covers design system, pages, features, logic, and data model. Follow it exactly — do not substitute your own defaults where this doc has already made a decision.

---

## 0. What this is

A personal dashboard + automation pipeline that:
1. Scrapes job sources (APIs/RSS first) for target roles (Cloud Engineer, DevOps Engineer, AWS Technical Trainer/Instructor).
2. Filters by days-since-posted and keyword/role match.
3. Attempts auto-apply (fills + submits application forms with stored CV) where the target site supports it.
4. Queues everything else for manual review/apply.
5. Tracks every job through a pipeline: **New → Matched → Auto-Applied / Manual Queue → Responded → Closed**.

Single user (owner) only for now. No multi-tenant auth needed beyond Supabase Auth for the owner.

---

## 1. HARD CONSTRAINTS — things the agent must NOT do

These are explicit exclusions because AI coding agents default to them unprompted. Treat violating any of these as a bug, not a style choice.

- **No gradients, anywhere.** No gradient backgrounds, buttons, text, borders, or "glow" effects. All fills are flat, single colors from the token table in §2.
- **No glassmorphism** (no `backdrop-filter: blur`, no translucent frosted panels).
- **No pure black (`#000`) or pure white (`#fff`)** — use the exact tokens in §2.
- **No default cream/terracotta AI-portfolio palette** (near `#F4F1EA` background with `#D97757` accent) and **no near-black-with-neon-accent palette**. This is a slate/signal-color system — see §2, do not deviate.
- **No emoji in the UI** (not in buttons, labels, empty states, or status tags). Icons only, from one consistent icon set (Lucide).
- **No decorative numbered markers (01 / 02 / 03)** unless the content is a genuine ordered sequence.
- **No card hover scale/transform effects, no bounce, no confetti, no spinner loaders** — use the motion rules in §5 only.
- **No placeholder Lorem Ipsum copy** — use real interface copy per §6, written for this product specifically.
- **No rounded-full ("pill") buttons or fully rounded cards.** Radius is fixed at the values in §2 — small and consistent.
- **Don't invent extra color accents** beyond the token table. If a new state seems to need a color, map it to the closest existing token instead of adding one.
- **Don't restructure the pipeline stage names or their order.** They are fixed: New, Matched, Auto-Applied, Manual Queue, Responded, Closed.

---

## 2. Design Tokens

### Color

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#12161C` | App background (deep slate) |
| `--surface` | `#1A2028` | Cards, panels |
| `--surface-raised` | `#212832` | Modals, drawers, hovered cards |
| `--border` | `#2A323D` | Hairline borders/dividers |
| `--text` | `#E8E6E1` | Primary text (warm off-white) |
| `--text-muted` | `#8B93A1` | Secondary text, labels |
| `--accent` | `#5B8DBF` | Links, active states, primary buttons |
| `--success` | `#5FBF77` | Applied / auto-applied / passing |
| `--pending` | `#D9A544` | Manual queue / awaiting action |
| `--danger` | `#C4685A` | Rejected / failed / errors |
| `--new` | `#8B93A1` | New / unscored jobs |

All fills flat. No gradient, no opacity blur.

### Typography

| Role | Face | Weight |
|---|---|---|
| Headings, UI labels | Inter | 600 (headings), 500 (labels) |
| Body text | Inter | 400 |
| Data: counts, dates, status tags, match scores, code-like values | JetBrains Mono | 400/500 |

Type scale: `12 / 14 / 16 / 20 / 24 / 32` px. Line height 1.5 body, 1.2 headings. Letter-spacing +0.02em on all-caps labels.

### Spacing

8px base unit: `4 8 12 16 24 32 48 64`. Card padding `16`. Section gaps `24`. Page margins `32` desktop / `16` mobile.

### Radius & elevation

Radius `6px` cards/buttons, `4px` tags/badges. No drop shadows — use 1px `--border` + `--surface-raised` background shift for elevation.

---

## 3. Pages & Features

### 3.1 Dashboard (`/`)
- Left rail: pipeline stages as a vertical stepper with live counts (New, Matched, Auto-Applied, Manual Queue, Responded, Closed). Click a stage to filter the job list. Collapses to horizontal tabs below 900px.
- Top filter bar: source (dropdown, multi-select), role keyword (text), days-since-posted (range), match score threshold (slider).
- Main list: job cards (see §4), newest-scanned first by default; sortable by posted date, match score, days-old.
- Empty state (no jobs match filters): "No jobs match these filters. Try widening the days-old range or clearing a filter."

### 3.2 Job Detail Drawer (slides in from right on card click)
- Full job description (scrollable), source link (opens original posting), match score with a breakdown of which keywords/criteria matched.
- Pipeline track for this job (§4), larger version.
- CV version used or suggested (from `cv_versions`), with option to swap before manual apply.
- Actions: "Mark as applied" (manual), "Dismiss," "Re-queue for auto-apply retry" (if a prior auto-apply attempt failed).
- Activity log for this job: scraped_at, matched_at, auto_apply_attempted_at (+ result), applied_at.

### 3.3 Sources (`/sources`)
- List of configured job sources (name, type: api/rss, base_url, active toggle, last_scraped_at, last_scrape_status).
- Add/edit source form: name, type, base_url/endpoint, query params (role keywords, location), active toggle.
- Manual "Run now" trigger per source (calls the scrape function directly, useful for testing a new source outside the schedule).
- Error state per source: if last 3 scrapes failed, show inline: "Last scrape of [source] failed 3 times. Check the source config." with the last error message.

### 3.4 CV Versions (`/cv`)
- List of uploaded CV files (label, file, upload date, which roles it's tagged for).
- Upload new version (stored in Supabase Storage).
- Set default CV per role type (Cloud Engineer / DevOps Engineer / AWS Trainer) so auto-apply and manual suggestions pick the right one.

### 3.5 Settings (`/settings`)
- Target roles/keywords list (editable).
- Days-since-posted default filter.
- Match score threshold for auto-apply eligibility (jobs below threshold always go to Manual Queue even if a form could technically be auto-filled).
- Notification preference (e.g. email digest of new Manual Queue items) — optional, can be a stub for later.

---

## 4. Signature element: the pipeline track

Every job card and the detail drawer show a horizontal tracker — one dot per stage (New, Matched, Auto-Applied or Manual Queue, Responded, Closed), connected by a line. Filled dots = passed stages, colored by that stage's token. Current stage dot pulses (2s opacity fade, no spinner). Hollow dots = upcoming stages.

```
●───●───●───○───○
New  Matched  Auto-Applied  Responded  Closed
```

This is the one recurring motif. Do not add a second competing motif (no progress rings, no gradient badges, no confetti on completion).

Status tags (e.g. "MANUAL QUEUE", "AUTO-APPLIED") are small, monospace, uppercase, colored by stage — they double as the track's legend.

### Job card layout
Pipeline track (top) → title + company (Inter 600/16) → source + posted-date + match-score (JetBrains Mono 12, `--text-muted`) → status tag (top-right corner).

---

## 5. Motion

Minimal, functional only:
- Card hover: 1px border color shift + slight background lift. No scale/transform.
- Drawer: slides in over 200ms ease-out.
- Current-stage dot: pulse as described in §4.
- No page-load animation sequence, no scroll-triggered reveals.

---

## 6. Copy voice

Plain, active voice, no marketing tone.
- Buttons say exactly what they do: "Mark as applied," not "Confirm."
- Status tags are nouns/short verb phrases: "MANUAL QUEUE," "AUTO-APPLIED."
- Errors state what happened and what's next, in the interface's voice: "Last scrape of [source] failed 3 times. Check the source config." Never "Something went wrong."
- Empty states are an invitation to act: "Nothing waiting on you. New unmatched jobs will land here."

---

## 7. Data model (Supabase / Postgres)

```sql
create table sources (
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

create table cv_versions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  file_path text not null,
  role_tags text[],
  is_default_for text[],
  uploaded_at timestamptz default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id),
  title text not null,
  company text,
  url text not null,
  posted_date date,
  scraped_at timestamptz default now(),
  description text,
  match_score numeric,
  matched_keywords text[],
  status text not null default 'new'
    check (status in ('new','matched','auto_applied','manual_queue','responded','closed')),
  auto_apply_attempted_at timestamptz,
  auto_apply_result text check (auto_apply_result in ('success','failed', null)),
  auto_apply_error text,
  cv_version_id uuid references cv_versions(id),
  created_at timestamptz default now()
);

create table applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id),
  applied_at timestamptz default now(),
  method text not null check (method in ('auto','manual')),
  cv_version_id uuid references cv_versions(id)
);

create table settings (
  id int primary key default 1,
  target_roles text[],
  days_posted_default int default 14,
  auto_apply_score_threshold numeric default 0.75,
  check (id = 1)
);
```

Status values in `jobs.status` map 1:1 to the pipeline stage names in §3/§4 — do not rename one without renaming the other.

---

## 8. Automation logic (detailed)

### 8.1 Repo structure (monorepo)

```
/apps
  /web          → React SPA (dashboard)
/packages
  /scraper      → source connectors + scheduled jobs (runs in GitHub Actions)
  /shared       → shared types, Supabase client, scoring logic used by both web and scraper
```

Shared types/scoring logic live in one package so the frontend's match-score display and the scraper's match-score calculation can never drift apart.

### 8.2 Scheduled scrape
- GitHub Actions cron (e.g. `0 */6 * * *`, every 6 hours). Each active source in `sources` is fetched by its connector (one connector module per source `type`/site, so adding a source = adding a connector, not editing a monolith script).
- Each connector returns a normalized job object: `{title, company, url, posted_date, description, raw_location, raw_tags}`.
- Upsert into `jobs` keyed on `url` (dedupe). If a job already exists, update `description`/`posted_date` only — never reset a job that's already progressed past `new` back to `new`.
- On connector failure: catch per-source, don't let one broken source kill the whole run. Write `last_scrape_status = 'failed'`, `last_scrape_error = <message>` to that source; continue to the next source. Update `last_scraped_at` regardless of outcome.

### 8.3 Matching pass — go beyond keyword-substring matching
A naive "does the title contain 'DevOps'" match produces too many false positives/negatives to be useful for actual job-hunting. Score every `new` job on multiple weighted signals, not one:

- **Title match** (highest weight): role keywords from `settings.target_roles` matched against the job title specifically, not just the body — a title match is a much stronger signal than a body mention.
- **Required skills/keywords overlap**: extract a skill list from the job description (match against a maintained skill vocabulary — AWS, Docker, Kubernetes, Terraform, CI/CD, etc. — pulled from the user's own certifications/CV keywords so the vocabulary reflects their actual stack) and score overlap.
- **Seniority filter**: detect "senior," "5+ years," "lead," etc. vs "junior," "entry," "intern," and penalize/boost based on a configured target seniority range in `settings` — prevents wildly mismatched-level postings from scoring high just because the title matches.
- **Location/remote filter**: hard-exclude or down-weight jobs outside configured accepted locations (remote / specific countries), configurable in `settings`.
- **Recency**: `posted_date` age factors in as a decay — a perfect keyword match posted 40 days ago should not outrank a good match posted yesterday when both are near the auto-apply threshold, since the older listing is more likely already filled.
- **Negative keywords**: a configurable exclude list in `settings` (e.g. roles/industries to actively avoid) that force `status` toward a low score or straight to `closed` regardless of other signals.

Store the individual signal scores (not just the final blended number) in `matched_keywords`/a `match_breakdown` jsonb column, so the detail drawer's "match score breakdown" (§3.2) can show *why* a job scored the way it did, and so the weights can be tuned later without re-scraping.

Add to schema: `jobs.match_breakdown jsonb` (per-signal scores + weights used).

Final blended score → `match_score`. `status` moves to `matched` only if `match_score > 0`; otherwise stays `new` (effectively filtered out of the active pipeline, still visible if the user wants to audit misses).

### 8.4 Auto-apply pass
- Eligibility: `status = 'matched'` AND `match_score >= auto_apply_score_threshold` AND the source/site has a registered auto-apply connector (not every source will — most won't, and that's expected, not a bug).
- Each auto-apply connector is site-specific (Playwright script per ATS pattern where feasible — e.g. Greenhouse and Lever forms follow fairly consistent structures across companies, so one connector per ATS platform, not per company, covers many employers at once).
- Before submitting: fill using the `cv_version_id` set as default for the job's detected role type (from `cv_versions.is_default_for`); if no clear role match, fall back to a general default CV and flag it in the activity log.
- On success: `status = 'auto_applied'`, insert into `applications` with `method = 'auto'`, set `auto_apply_attempted_at`, `auto_apply_result = 'success'`.
- On failure (form structure changed, CAPTCHA encountered, unexpected required field): do not retry silently in a loop. Set `status = 'manual_queue'`, `auto_apply_result = 'failed'`, store `auto_apply_error` with enough detail to diagnose (which step failed), so the user can either fix the connector or apply manually. Never leave a job stuck in limbo with no status change.
- Rate/politeness limits: cap auto-apply attempts per source per run (e.g. max 5) to avoid hammering a site or looking like abuse — configurable per source.

### 8.5 Manual queue
- Everything below threshold, without a connector, or that failed auto-apply lands here — this is the expected common case, not the exception, so the UI (§3.1/§3.2) should treat it as a first-class list, not a dumping ground.
- User marks applied from the drawer → row added to `applications` with `method = 'manual'`, `status` set based on user action.

### 8.6 Response tracking
Manual for now — user updates `status = 'responded'` or `'closed'` from the drawer when they hear back. (Future: an email-inbox connector could auto-detect rejection/interview-request emails and update status, but that's out of scope for v1.)

---

## 9. Deployment

### 9.1 Repo & hosting split
- **Monorepo** as laid out in §8.1, single GitHub repo.
- **Frontend (`/apps/web`)** → **Vercel**. Connect the GitHub repo, set the project root to `apps/web`, framework preset = Vite/React (or CRA, whichever the scaffold uses). Vercel auto-deploys on every push to `main` (production) and generates preview deployments for pull requests/branches.
- **Scraper/automation (`/packages/scraper`)** → **GitHub Actions**, not Vercel. Vercel serverless functions have execution time limits too short for Playwright-based scraping/auto-apply runs; a scheduled Actions workflow (`.github/workflows/scrape.yml` with a `schedule:` cron trigger, plus `workflow_dispatch:` for manual "run now" triggers from the Sources page via the GitHub API) is the right fit and stays free at this usage volume.
- **Backend** → Supabase project (hosted, free tier): Postgres, Auth, Storage all live there — nothing to deploy manually beyond running the schema migration (§7) once via the Supabase SQL editor or CLI.

### 9.2 Environment variables / secrets
- Supabase URL and anon key → Vercel project environment variables (safe for frontend, respects Row Level Security).
- Supabase service-role key → **GitHub Actions repo secret only** (`SUPABASE_SERVICE_ROLE_KEY`). Never expose the service-role key to the frontend/Vercel — it bypasses Row Level Security.
- Any per-source API keys (if a job source requires one) → GitHub Actions secrets, referenced by the relevant connector.
- Keep a `.env.example` in each app/package listing required variable names (no real values) so the setup is reproducible.

### 9.3 Supabase configuration
- Enable Row Level Security on all tables; since this is single-user, the simplest correct policy is "authenticated owner only" for all reads/writes from the frontend, with the scraper using the service-role key (which bypasses RLS) for its writes.
- Create a Storage bucket for CV files (e.g. `cv-files`), private by default, accessed via signed URLs from the frontend.
- Run the schema in §7 as a versioned migration (Supabase CLI `supabase migration new` + `supabase db push`) rather than pasting SQL ad hoc, so schema changes are tracked in the repo alongside the code that depends on them.

### 9.4 GitHub Actions workflow shape
- `scrape.yml`: scheduled (`schedule: cron`) + manually triggerable (`workflow_dispatch`), installs the scraper package's dependencies (including Playwright browsers via `npx playwright install --with-deps` for the auto-apply pass), runs the scrape → match → auto-apply pipeline in sequence, exits non-zero on unhandled errors so a failed run is visible in the Actions tab (in addition to the per-source error handling in §8.2, which keeps one bad source from failing the whole job).
- Secrets referenced via `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}` etc., configured in the repo's Settings → Secrets and variables → Actions.

### 9.5 Domains
- Vercel provides a free `*.vercel.app` subdomain by default; a custom domain is optional and can be added later in Vercel's project settings without any other change.
