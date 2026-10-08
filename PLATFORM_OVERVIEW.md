# job-me — Platform Overview

> Last updated: October 2026
> Status: Functional MVP — all core pipeline stages implemented and deployed.

---

## What This Is

`job-me` is a personal, single-owner job application tracking and discovery pipeline. It automates the tedious parts of a job search — finding relevant postings, scoring them against your profile, attempting to auto-apply where possible, and surfacing everything else for manual review — through a clean dashboard backed by a fully automated scraping pipeline.

Target roles: **Cloud Engineer, DevOps Engineer, AWS Technical Trainer / Instructor, Platform Engineer, SRE.**

---

## Architecture

A TypeScript monorepo managed with `pnpm` workspaces, split into three concerns:

```
job-me/
├── apps/web/          → React 18 + Vite SPA (the dashboard)
├── packages/
│   ├── shared/        → Types, 5-signal scoring engine, Supabase client factory, Gemini client
│   └── scraper/       → Pipeline runner, 9 connector types, Playwright auto-apply
├── supabase/
│   ├── schema.sql     → Single-file idempotent schema (tables + RLS + seed)
│   └── functions/     → trigger-pipeline edge function (GitHub dispatch)
└── .github/
    └── workflows/
        └── scrape.yml → 6-hour cron + manual dispatch pipeline
```

**Hosting split:**
- Frontend → Vercel (auto-deploy on push to `main`)
- Scraper/automation → GitHub Actions (free tier, no serverless timeout constraints)
- Database/storage → Supabase (Postgres + Auth + Storage, hosted)

---

## What Is Implemented

### 1. Database Schema (Supabase / Postgres)

Five tables, defined in a single idempotent `schema.sql` (safe to re-run on an existing database):

| Table | Purpose |
|---|---|
| `sources` | Job board configs (name, type, URL, query params, active flag, fail counters) |
| `jobs` | Every scraped job with full pipeline state, match score, and per-signal breakdown |
| `cv_versions` | Uploaded CV files with role tags and per-role default flags |
| `applications` | Audit log of every application (auto or manual) with CV used — one row per job (unique on `job_id`) |
| `settings` | Single-row config: target roles, seniority, locations, thresholds, negative keywords, skill vocabulary |

Key schema decisions implemented:
- `jobs.url` is `UNIQUE` — deduplication key for upserts
- `jobs.match_breakdown JSONB` — stores per-signal scores, not just the final number
- `sources.consecutive_fail_count` — tracks repeated failures for alerting
- `jobs.status` CHECK includes seven values: `new`, `matched`, `auto_applied`, `manual_applied`, `manual_queue`, `responded`, `closed`
- RLS policies: anon/authenticated reads for frontend; service-role key for scraper writes
- Indexes on `jobs(status)`, `jobs(scraped_at DESC)`, `jobs(match_score DESC)`, `jobs(source_id)`

---

### 2. Scraper Pipeline (`packages/scraper`)

Runs as a GitHub Actions workflow every 6 hours (or on manual dispatch). Four sequential stages:

#### Stage 1 — Scrape (`pipeline/scrape.ts`)
- Fetches all `active = true` sources from the database
- Routes each source to the correct connector (9 types: rss, api, generic_web, linkedin, indeed, glassdoor, otta, jobicy, arbeitnow)
- **Every source is scraped with the /settings configuration applied**: `{roles}` / `{role}` / `{locations}` / `{location}` / `{days}` placeholders in `base_url` and `query_params` are substituted from settings (all 9 connector types, including generic web pages where search terms live in the URL); sources with no query params at all get settings-derived defaults (first target role, first accepted location, `days_posted_default` recency window where the API supports it)
- Per-source failure isolation: one broken source never stops the rest
- Upsert strategy (3 queries instead of N+1):
  1. Fetch all existing URLs in one query
  2. Batch INSERT new jobs
  3. Single `upsert(onConflict: 'url')` for existing jobs — description/posted_date only, never resets a job's status
- Updates `last_scraped_at`, `last_scrape_status`, `last_scrape_error`, and `consecutive_fail_count` per source regardless of outcome

#### Stage 2 — Enrich (`pipeline/enrich.ts`)
- Calls Gemini (`gemini-2.5-flash`, optional — skipped without `GEMINI_API_KEY`)
- Detects spam/fake postings → immediately `closed`
- Confirms remote status → sets `raw_location = 'Remote'` when empty
- Never modifies the job description (AI summaries used to stack on every run and inflate the skills signal)

#### Stage 3 — Match (`pipeline/match.ts`)
- Scores all `new`, `matched`, and `manual_queue` jobs against the latest settings
- Promotion rules are deliberately conservative (no flapping, no retry loops):
  - `new` → `matched` at score ≥ `MATCH_PROMOTION_THRESHOLD` (0.40) with accepted location
  - `matched` stays `matched` unless closed
  - `manual_queue` is never auto-promoted — re-queueing is an explicit user action
- Negative keyword / rejected location / score < 0.25 → `closed`
- Updates `match_score`, `match_breakdown`, `matched_keywords`, and `status`

#### Stage 4 — Auto-Apply (`pipeline/auto-apply.ts`)
- Fetches `status = 'matched'` jobs at or above `auto_apply_score_threshold`
- Looks up a registered ATS connector by matching the job URL against known patterns
- Selects the best CV by matching `is_default_for` role tags against the job title, and **downloads that CV's file** from Supabase Storage (cached per run) — `CV_FILE_PATH` env is only a fallback
- Rate cap: `max_auto_apply_per_run` attempts (successes **and** failures) per run
- On success: `status → auto_applied`, inserts into `applications`
- On failure or no connector: `status → manual_queue` with error detail stored — never leaves a job in limbo
- Detects reCAPTCHA/hCaptcha walls before submitting and fails with a clear `captcha_detected` error

---

### 3. Source Connectors (`packages/scraper/src/connectors`)

**`RssConnector`** — Generic RSS/Atom feed parser:
- Appends `query_params` to `base_url` as URL search params
- Handles multiple date field formats (`isoDate`, `pubDate`, `dc:date`)
- Smart title parsing: extracts company name from common patterns (`Company: Title`, `Title at Company`, `Title - Company`)
- Extracts location from `dc:publisher`, `author`, `location` fields

**`ApiConnector`** — Generic REST API connector:
- Supports top-level arrays or `results`/`jobs`/`data` wrapper objects
- Normalizes across common field name variations (`title`/`position`/`job_title`/`role`, `company`/`company_name`/`employer`, etc.)
- Handles nested company objects (e.g. Adzuna's `company.display_name`)
- Handles epoch timestamps and ISO date strings

Both connectors are subclassable — extend `ApiConnector.parse()` or `ApiConnector.normalizeItem()` for source-specific quirks without touching the base.

The remaining seven connector types live alongside them: `generic_web` (Playwright scraper for any public careers page — search terms can be wired into the URL via `{role}`/`{location}` placeholders), `linkedin`, `indeed`, `glassdoor` (Playwright scrapers), `otta`, `jobicy`, and `arbeitnow` (free public APIs). Shared helpers (`buildUrl`, `toIsoDate`, `sanitizeLog`, `extractLocationFromText`, `applySettingsToSource`) live in `connectors/utils.ts` — `sanitizeLog` strips `\r\n` from every external string before it reaches a log line.

---

### 4. Auto-Apply Connectors (`packages/scraper/src/auto-apply-connectors`)

**`GreenhouseConnector`** — Playwright-based Greenhouse ATS form filler:
- Fills first name, last name, email, phone
- Uploads CV via `input[type="file"]`
- Submits and waits for confirmation text or URL change
- Throws descriptive errors on each failure point (no file input found, submit button missing, no confirmation)
- Registered in a URL-pattern registry in `auto-apply.ts` — adding a new ATS = adding one entry to the registry

---

### 5. 5-Signal Match Scoring Engine (`packages/shared/src/scoring.ts`)

Shared between the scraper and frontend so scores are always calculated identically.

| Signal | Weight | Logic |
|---|---|---|
| Title match | 40% | Whole-word overlap against target roles; initialisms (SRE ↔ Site Reliability Engineer) match; no role words → entire score forced to 0 |
| Skills overlap | 30% | Count of whole-word skill vocabulary matches in description, normalized at 3 matches = 100% |
| Seniority | 15% | Detects senior/mid/junior tokens (whole-word only — "middle" ≠ "mid"); exact = 1.0, adjacent = 0.5, wrong level = 0.1, undetected = 0.5 neutral |
| Location | 10% | Settings-driven: 1.0 for listed Ghana locations, 0.95 for listed remote locations, 0.8 for other listed locations; unlisted → rejected and closed; empty list accepts all |
| Recency | 5% | Exponential decay `e^(-days/14)` — 14-day-old post scores ~37% on this signal |

- Negative keyword check runs first as a hard stop — forces score to 0 and status to `closed`
- All per-signal scores, weights, and matched tokens stored in `match_breakdown JSONB`
- `optionsFromSettings()` maps a `Settings` row to `ScoringOptions` automatically
- `MATCH_PROMOTION_THRESHOLD` (0.40) is exported from the shared package and used by both the scraper and the frontend — one constant, no drift

---

### 6. Frontend Dashboard (`apps/web`)

Built with React 18, React Router v6, Lucide React icons, CSS Modules. Design system strictly follows the spec: dark slate theme, Inter + JetBrains Mono typography, no gradients, no glassmorphism, no emoji.

#### Pages

**Dashboard (`/`)**
- Pipeline sidebar with live counts per stage — click to filter the job list. The six fixed stages are New, Matched, Auto-Applied, Manual Queue, Responded, Closed; `manual_applied` jobs group under Auto-Applied
- Filter bar: source multi-select, role keyword text search, days-since-posted range, match score threshold, sort order
- Job list with Supabase Realtime subscription (INSERT/UPDATE/DELETE events update the list live) and pagination (200 per page, "Load more")
- Summary bar: high-match count (at the configured auto-apply threshold), manual queue count, auto-applied count
- "Delete unmatched jobs" bulk action with optimistic UI and rollback on failure
- Empty states with spec-compliant copy

**Job Detail Drawer**
- Slides in from right at 200ms ease-out
- Full accessibility: focus trap, Escape to close, Tab cycling constrained to drawer
- Match score breakdown with per-signal bar chart (score × weight = contribution) and the auto-apply eligibility line (score vs threshold)
- Full pipeline track (large, with labels)
- CV version selector (swap before manual apply)
- Actions: Mark as applied (`manual_applied`), Mark responded (`responded`, for applied jobs), Dismiss, Re-queue for auto-apply retry (shown only on failed auto-apply)
- Auto-apply error block (shown when `auto_apply_error` is set)
- Activity log: scraped_at, matched keywords, auto-apply attempt timestamp + result

**Sources (`/sources`)**
- List of all configured sources with status indicators (success/failed icons)
- Consecutive fail count alert banner (triggers at ≥ 3 failures)
- Per-source inline error message with last error text
- Add/edit source form (modal) with JSON query params textarea
- Per-source "Run now" button and global "Run all sources" button — both call the `trigger-pipeline` edge function, which dispatches `workflow_dispatch` server-side (GitHub PAT stays in function secrets, never in the frontend bundle)
- Active/inactive toggle per source (optimistic, with rollback and error feedback on failure)

**CV Versions (`/cv`)**
- Upload form: label, PDF file, role tags, default-for role checkboxes
- Files stored in Supabase Storage `cv-files` bucket, accessed via signed URLs
- Per-CV "Set as default for" role buttons — toggling one removes it from all other CVs for that role
- Click CV label to open signed URL in new tab

**Settings (`/settings`)**
- Target roles list (add/remove, quick-add presets)
- Target seniority radio (junior / mid / senior / any)
- Accepted locations list (add/remove, quick-add presets)
- Negative keywords list (add/remove, quick-add presets, styled in danger color)
- Days-since-posted default (number input)
- Auto-apply score threshold (range slider, 0–100%)
- Email digest stub (placeholder for future feature)
- Save with 2-second "Saved" confirmation

#### Components

| Component | Description |
|---|---|
| `PipelineTrack` | Horizontal dot-and-line tracker. Filled dots = past stages. Current dot pulses (2s opacity fade). Compact (no labels) on cards, full (with labels) in drawer. |
| `JobCard` | Pipeline track → title + company → location badge + keyword tags → source + date + score → status tag (top-right) |
| `StatusTag` | Monospace uppercase status badge, colored by stage token |
| `PipelineSidebar` | Vertical stage list with live counts. Collapses to horizontal tabs below 900px |
| `FilterBar` | Source multi-select, keyword input, days range, score threshold, sort dropdown |
| `AppShell` | Nav sidebar + page outlet |

---

### 7. GitHub Actions Workflow (`.github/workflows/scrape.yml`)

- Triggers: `schedule` (every 6 hours) + `workflow_dispatch` (manual, via the `trigger-pipeline` edge function)
- Optionally downloads the newest CV from Supabase Storage into `/tmp/resume.pdf` as a fallback (never fails the run)
- Installs Playwright Chromium with system deps for auto-apply
- Runs `pnpm pipeline` with all secrets injected as environment variables
- Exits non-zero on unhandled errors — failed runs are visible in the Actions tab

---

## What Can Be Improved

### Fixed in the October 2026 pass

The following issues from the original review have been addressed:

- **Log injection (CWE-117)** — `sanitizeLog()` strips `\r\n` from external strings; used across the scraper.
- **Match threshold inconsistency** — promotion threshold exported as `MATCH_PROMOTION_THRESHOLD` from `@job-me/shared`; the dashboard surfaces the configured `auto_apply_score_threshold` instead of a hardcoded 0.75.
- **Manual applications showed as AUTO-APPLIED** — new `manual_applied` status (schema CHECK, status tag, pipeline-track slot 2, groups under Auto-Applied in the sidebar).
- **Silent source save/delete/toggle failures** — all Sources handlers report errors and roll back optimistic updates.
- **`buildUrl`/`toIsoDate` duplication** — shared in `connectors/utils.ts` alongside `sanitizeLog` and `extractLocationFromText`.
- **Per-row batch updates in `scrape.ts`** — single `upsert(onConflict: 'url')`.
- **Hardcoded rate cap** — `settings.max_auto_apply_per_run`; counts attempts (successes and failures).
- **CV selection drift** — `selectCvForTitle()` lives in `@job-me/shared` and is used by both the dashboard and the scraper; auto-apply downloads the matched CV's file per job.
- **CAPTCHA handling** — Greenhouse/Lever/Workday detect reCAPTCHA/hCaptcha and fail with a specific `captcha_detected` error.
- **No pagination** — dashboard loads 200 jobs per page with a "Load more" button.
- **Lever connector** — implemented and registered.
- **Hardcoded skill vocabulary** — editable in Settings (`settings.skill_vocabulary`).
- **Dead `src/` scaffolding and stray `package-lock.json`** — removed.
- **Design-token drift** — `tokens.css` palette uses the exact spec §2 hexes, radius 6/4px, no drop shadows (1px `--border` + raised surface instead); six `color: #fff` rules now use `var(--text)`.
- **Scoring false positives** — whole-word matching for skills/seniority/negative keywords; no generic title aliases; irrelevant titles score 0; empty accepted-locations list accepts every location.
- **Enrichment stacking** — the enrich step no longer rewrites the job description (summaries used to stack on every run and inflate the skills signal).
- **PAT in frontend** — the GitHub PAT moved to the `trigger-pipeline` edge function secrets.
- **Match-status flapping** — only `new` jobs can be promoted to `matched`; `manual_queue` jobs are never auto-promoted.

### Still open

**1. Dependency advisories**
`react-router-dom` 6.x has a low-impact SSR deserialization advisory (this is a CSR-only SPA), and `esbuild`'s dev-server CORS setting is dev-only. Worth bumping at the next dependency refresh; `vitest` (3.2.7) and `vite` (6.4.3) are already on fixed versions.

**2. RSS connector — location extraction is limited**
`extractLocation` in `rss.ts` only checks `dc:publisher`, `author`, and `location` fields. Most job-board RSS feeds embed location in the title or description. A regex pass over title/description would improve the location signal.

**3. Email digest**
`Settings.tsx` has a stub section. A daily summary of Manual Queue items and auto-apply results could be a Supabase Edge Function on a cron.

**4. Response tracking automation**
`responded` and `closed` are still set manually (via the drawer's **Mark responded** action). An email inbox connector could auto-update statuses.

**5. RLS is anon-permissive (owner decision)**
Policies grant both `anon` and `authenticated` roles — anyone holding the anon key can read and write. This is deliberate for this single-owner tool, which has no login flow. The original review suggested authenticated-only RLS behind a login page; the owner declined that change. Revisit if the tool is ever shared.

---

## Summary Table

| Area | Status |
|---|---|
| Database schema (single-file idempotent) | Complete |
| RSS connector | Complete |
| API connector (generic) | Complete |
| 5-signal scoring engine | Complete |
| Scrape pipeline stage | Complete |
| Enrich pipeline stage (Gemini) | Complete |
| Match pipeline stage | Complete |
| Auto-apply pipeline stage | Complete |
| Greenhouse / Lever / Workday ATS connectors | Complete |
| GitHub Actions workflow | Complete |
| `trigger-pipeline` edge function | Complete |
| Dashboard + realtime + pagination | Complete |
| Job detail drawer + breakdown | Complete |
| Sources management page | Complete |
| CV versions page (upload, defaults, delete) | Complete |
| Settings page | Complete |
| Pipeline track component | Complete |
| RLS security policies | Complete (anon + authenticated; see "Still open" #5) |
| Email digest | Stub only |
| Response tracking automation | Not started |
| RSS location extraction | Partial |
