# job-me — Platform Overview

> Last updated: June 2025  
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
│   ├── shared/        → Types, 5-signal scoring engine, Supabase client factory
│   └── scraper/       → Pipeline runner, RSS/API connectors, Playwright auto-apply
├── supabase/
│   └── migrations/    → Versioned Postgres schema (5 migrations)
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

Five tables, fully migrated across 5 versioned SQL files:

| Table | Purpose |
|---|---|
| `sources` | Job board configs (name, type, URL, query params, active flag, fail counters) |
| `jobs` | Every scraped job with full pipeline state, match score, and per-signal breakdown |
| `cv_versions` | Uploaded CV files with role tags and per-role default flags |
| `applications` | Audit log of every application (auto or manual) with CV used |
| `settings` | Single-row config: target roles, seniority, locations, thresholds, negative keywords |

Key schema decisions implemented:
- `jobs.url` is `UNIQUE` — deduplication key for upserts
- `jobs.match_breakdown JSONB` — stores per-signal scores, not just the final number
- `sources.consecutive_fail_count` — tracks repeated failures for alerting
- RLS policies: anon/authenticated reads for frontend; service-role key for scraper writes
- Indexes on `jobs(status)`, `jobs(scraped_at DESC)`, `jobs(match_score DESC)`, `jobs(source_id)`

---

### 2. Scraper Pipeline (`packages/scraper`)

Runs as a GitHub Actions workflow every 6 hours (or on manual dispatch). Three sequential stages:

#### Stage 1 — Scrape (`pipeline/scrape.ts`)
- Fetches all `active = true` sources from the database
- Routes each source to the correct connector (`RssConnector` or `ApiConnector`)
- Per-source failure isolation: one broken source never stops the rest
- Batch upsert strategy (3 queries instead of N+1):
  1. Fetch all existing URLs for the source in one query
  2. Batch INSERT new jobs
  3. Batch UPDATE description/posted_date for existing jobs — never resets a job's status
- Updates `last_scraped_at`, `last_scrape_status`, `last_scrape_error`, and `consecutive_fail_count` per source regardless of outcome

#### Stage 2 — Match (`pipeline/match.ts`)
- Fetches all `status = 'new'` jobs
- Runs the 5-signal scoring engine against each job
- Updates `match_score`, `match_breakdown`, `matched_keywords`, and `status`
- Jobs scoring `>= 0.40` move to `matched`; negative keyword hits move to `closed`

#### Stage 3 — Auto-Apply (`pipeline/auto-apply.ts`)
- Fetches `status = 'matched'` jobs at or above `auto_apply_score_threshold`
- Looks up a registered ATS connector by matching the job URL against known patterns
- Selects the best CV by matching `is_default_for` role tags against the job title
- Rate cap: max 5 auto-apply attempts per run
- On success: `status → auto_applied`, inserts into `applications`
- On failure or no connector: `status → manual_queue` with error detail stored — never leaves a job in limbo

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
| Title match | 40% | Binary: job title contains any target role keyword or domain token (cloud, devops, aws, sre, platform, trainer, etc.) — if 0, entire score is forced to 0 |
| Skills overlap | 30% | Count of skill vocabulary matches in description, normalized at 5 matches = 100% |
| Seniority | 15% | Detects senior/mid/junior tokens; exact match = 1.0, adjacent level = 0.5, wrong level = 0.1, undetected = 0.5 neutral |
| Location | 10% | Binary: job location matches any accepted location string, or is empty/remote/worldwide |
| Recency | 5% | Exponential decay `e^(-days/14)` — 14-day-old post scores ~37% on this signal |

- Negative keyword check runs first as a hard stop — forces score to 0 and status to `closed`
- All per-signal scores, weights, and matched tokens stored in `match_breakdown JSONB`
- `optionsFromSettings()` maps a `Settings` row to `ScoringOptions` automatically

---

### 6. Frontend Dashboard (`apps/web`)

Built with React 18, React Router v6, Lucide React icons, CSS Modules. Design system strictly follows the spec: dark slate theme, Inter + JetBrains Mono typography, no gradients, no glassmorphism, no emoji.

#### Pages

**Dashboard (`/`)**
- Pipeline sidebar with live counts per stage — click to filter the job list
- Filter bar: source multi-select, role keyword text search, days-since-posted range, match score threshold, sort order
- Job list with Supabase Realtime subscription (INSERT/UPDATE/DELETE events update the list live)
- Summary bar: high-match count, manual queue count, auto-applied count
- "Delete unmatched jobs" bulk action with optimistic UI and rollback on failure
- Empty states with spec-compliant copy

**Job Detail Drawer**
- Slides in from right at 200ms ease-out
- Full accessibility: focus trap, Escape to close, Tab cycling constrained to drawer
- Match score breakdown with per-signal bar chart (score × weight = contribution)
- Full pipeline track (large, with labels)
- CV version selector (swap before manual apply)
- Actions: Mark as applied, Dismiss, Re-queue for auto-apply retry (shown only on failed auto-apply)
- Auto-apply error block (shown when `auto_apply_error` is set)
- Activity log: scraped_at, matched keywords, auto-apply attempt timestamp + result

**Sources (`/sources`)**
- List of all configured sources with status indicators (success/failed icons)
- Consecutive fail count alert banner (triggers at ≥ 3 failures)
- Per-source inline error message with last error text
- Add/edit source form (modal) with JSON query params textarea
- Per-source "Run now" button and global "Run all sources" button — both trigger GitHub Actions `workflow_dispatch` via the GitHub API
- Active/inactive toggle per source

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

- Triggers: `schedule` (every 6 hours) + `workflow_dispatch` (manual from Sources page)
- Downloads `resume.pdf` from Supabase Storage into `/tmp/resume.pdf` before the pipeline run
- Installs Playwright Chromium with system deps for auto-apply
- Runs `pnpm pipeline` with all secrets injected as environment variables
- Exits non-zero on unhandled errors — failed runs are visible in the Actions tab

---

## What Can Be Improved

### High Priority

**1. Log injection (CWE-117) — scraper pipeline**
External data (job titles, company names, error messages from scraped sources) is logged directly without sanitizing newline characters. A malicious job posting could inject fake log lines. Fix: strip `\r\n` from any external string before passing to `console.log/error`.
```ts
const s = (v: unknown) => String(v).replace(/[\r\n]/g, ' ');
```
Affects: `scrape.ts`, `match.ts`, `auto-apply.ts`, `index.ts`, `clear-db.ts`, `supabase.ts`, `github.ts`.

**2. Dependency vulnerabilities — update lockfile**
- `vitest < 3.2.5` — path traversal on Windows (Critical, GHSA-5xrq-8626-4rwp). Update to `>= 3.2.5`.
- `vite < 6.4.2` — `.map` file path traversal (Medium). Update to `>= 6.4.2`.
- `react-router < 7.18.0` — unsafe deserialization in SSR mode (Medium, low impact for this SPA). Update to `>= 7.18.0`.
- `esbuild` — CORS wildcard on dev server (Medium, dev-only). Update esbuild.

**3. Match threshold inconsistency**
`match.ts` promotes jobs to `matched` at score `>= 0.40`, but `Dashboard.tsx` defines "high match" and the "delete unmatched" action at `>= 0.75`. The `auto_apply_score_threshold` default is also `0.75`. The `0.40` promotion threshold is undocumented and creates a large "matched but not auto-apply eligible" bucket that isn't clearly surfaced in the UI. Either raise the promotion threshold or add a distinct visual tier for `0.40–0.74` matched jobs.

**4. `handleMarkApplied` sets status to `auto_applied` for manual applications**
In `Dashboard.tsx`, manually marking a job as applied sets `status = 'auto_applied'` instead of a distinct manual-applied state. The pipeline track and status tag then show "AUTO-APPLIED" for a job the user applied to manually. The `applications` table correctly records `method = 'manual'`, but the job status is misleading. Consider using `responded` or adding a `manual_applied` status, or at minimum showing the application method in the drawer's activity log more prominently.

**5. No error feedback on source save/delete**
`Sources.tsx` — `handleSubmit` silently ignores Supabase errors on insert/update. If the save fails, the form closes and the user sees no feedback. Add error handling consistent with the other action handlers.

**6. `buildUrl` duplicated across connectors**
`buildUrl` and `toIsoDate` are copy-pasted identically in `connectors/rss.ts` and `connectors/api.ts`. Move to a shared `connectors/utils.ts`.

---

### Medium Priority

**7. Batch update in `scrape.ts` uses `Promise.all` per-row**
The existing batch update for existing jobs falls back to `Promise.all` with individual `.update()` calls (in slices of 20) because Supabase JS doesn't support native batch updates. This is acceptable but could be replaced with a single `upsert` call using `onConflict: 'url', ignoreDuplicates: false` and only updating `description` and `posted_date` — which would reduce it to one query.

**8. Auto-apply rate cap is hardcoded**
`MAX_PER_RUN = 5` in `auto-apply.ts` is a magic number. The design spec calls for it to be configurable per source. Move it to `settings` or at minimum to a named constant with a comment.

**9. `CvVersions.tsx` — no delete CV action**
Users can upload CVs and set defaults but cannot delete old versions. The storage object and database row both persist indefinitely. Add a delete button that removes both the storage object and the `cv_versions` row.

**10. `Settings.tsx` — no error state on save**
`handleSave` calls `supabase.from('settings').update(...)` but doesn't check the returned `error`. If the save fails, the button shows "Saved" anyway. Add error handling.

**11. `Dashboard.tsx` — `selectCvForJob` duplicates scraper logic**
The CV selection logic in `Dashboard.tsx` mirrors `selectCv()` in `auto-apply.ts`. Both are simple enough that drift is unlikely, but the function should live in `packages/shared` and be imported by both.

**12. Greenhouse connector — no CAPTCHA handling**
The Greenhouse connector throws on unexpected form states, which correctly routes the job to `manual_queue`. However, CAPTCHA encounters produce a generic timeout error rather than a specific `captcha_detected` error message. Detecting CAPTCHA (e.g. checking for reCAPTCHA iframe presence before submitting) would produce more actionable error messages in the drawer.

**13. RSS connector — location extraction is limited**
`extractLocation` in `rss.ts` only checks `dc:publisher`, `author`, and `location` fields. Most RSS feeds from job boards (Reed, Indeed, LinkedIn) embed location in the title or description rather than a dedicated field. A regex pass over the title/description for common location patterns (e.g. `(Remote)`, `London, UK`, `Worldwide`) would significantly improve location signal accuracy.

---

### Low Priority / Future Features

**14. Lever ATS connector**
The connector registry in `auto-apply.ts` has a commented-out `LeverConnector` entry. Lever forms follow a similar structure to Greenhouse and would cover a significant additional set of employers.

**15. Email digest**
`Settings.tsx` has a stub section for email digest notifications. A daily summary of new Manual Queue items and auto-apply results would close the loop without requiring the user to check the dashboard. Could be implemented as a Supabase Edge Function triggered by a cron.

**16. Response tracking automation**
Currently `responded` and `closed` statuses are set manually from the drawer. An email inbox connector (e.g. Gmail API watching for subject-line patterns like "application received", "interview", "unfortunately") could auto-update job statuses and remove the manual step.

**17. Skill vocabulary is hardcoded in `scoring.ts`**
`SKILL_VOCABULARY` is a static array in the scoring engine. It should be user-configurable (editable in Settings, stored in the `settings` table) so the scoring reflects the user's actual current stack without requiring a code change.

**18. No pagination on the job list**
`Dashboard.tsx` loads all jobs in a single query (`select('*')`). At low volume this is fine, but as the database grows this will become slow. Add cursor-based pagination or a virtual list.

**19. `src/` root directory is empty**
There is an empty `src/components/`, `src/pages/`, `src/styles/` directory tree at the monorepo root. This is dead scaffolding and should be removed to avoid confusion.

**20. `pnpm-lock.yaml` / `package-lock.json` coexistence**
Both `pnpm-lock.yaml` and `package-lock.json` exist at the repo root. The project uses `pnpm` — `package-lock.json` should be removed and added to `.gitignore` to prevent accidental `npm install` runs that would corrupt the lockfile.

---

## Summary Table

| Area | Status |
|---|---|
| Database schema + migrations | Complete |
| RSS connector | Complete |
| API connector (generic) | Complete |
| 5-signal scoring engine | Complete |
| Scrape pipeline stage | Complete |
| Match pipeline stage | Complete |
| Auto-apply pipeline stage | Complete |
| Greenhouse ATS connector | Complete |
| GitHub Actions workflow | Complete |
| Dashboard + realtime | Complete |
| Job detail drawer + breakdown | Complete |
| Sources management page | Complete |
| CV versions page | Complete |
| Settings page | Complete |
| Pipeline track component | Complete |
| RLS security policies | Complete |
| Lever ATS connector | Not started |
| Email digest | Stub only |
| Response tracking automation | Not started |
| Configurable skill vocabulary | Not started |
| CV delete action | Not started |
| Job list pagination | Not started |
