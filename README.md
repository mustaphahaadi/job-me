# job-me

A self-hosted job application pipeline. Fork it, configure it for yourself, and let it run every 6 hours on GitHub Actions — scraping job boards, scoring every posting against your skillset, generating AI cover letters, and auto-applying to Greenhouse, Lever, and Workday roles.

```
scrape → enrich (AI spam filter) → match (5-signal score) → auto-apply (AI cover letter)
```

---

## What it does

- Scrapes 9 job board types on a 6-hour cron (RSS, API, generic web, LinkedIn, Indeed, Glassdoor, Otta, Jobicy, Arbeitnow)
- Scores every job `0–100%` using a 5-signal algorithm (title, skills, seniority, location, recency)
- Filters spam and confirms remote status using Gemini AI (free tier, optional)
- Auto-applies to Greenhouse, Lever, and Workday roles above your score threshold
- Generates a tailored AI cover letter per application
- Dashboard to review, filter, dismiss, bulk-delete, and manually apply to jobs
- Full applications history with method, CV used, and score

> 📚 **Teaching & Workshop Guide**: Planning to teach or demonstrate `job-me` to students or team members? See the complete step-by-step [**TEACHING_GUIDE.md**](./TEACHING_GUIDE.md) for a zero-deployment local walkthrough.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, React Router v6, CSS Modules |
| Backend | Supabase (Postgres + RLS + Storage + Realtime) |
| Scraper | Node.js, Playwright (Chromium), rss-parser |
| AI | Google Gemini 2.5 Flash (free tier) |
| CI/CD | GitHub Actions (6-hour cron + manual trigger) |
| Hosting | Vercel (frontend) |
| Package manager | pnpm workspaces |

---

## Project structure

```
job-me/
├── apps/web/                        # Vite + React 18 dashboard
│   └── src/
│       ├── components/              # AppShell, JobCard, Drawer, FilterBar, etc.
│       ├── pages/                   # Dashboard, Sources, Applications, CV, Settings
│       ├── lib/                     # supabase.ts, github.ts
│       └── styles/                  # tokens.css, global.css
├── packages/
│   ├── shared/src/                  # Types, scoring engine, Supabase client, Gemini client
│   └── scraper/src/
│       ├── connectors/              # rss, api, linkedin, indeed, glassdoor, otta, jobicy, arbeitnow
│       ├── auto-apply-connectors/   # greenhouse, lever, workday
│       └── pipeline/                # scrape → enrich → match → auto-apply
├── supabase/
│   ├── config.toml                  # Supabase local dev config
│   └── schema.sql                   # Single-file idempotent schema (tables + RLS + seed)
└── .github/workflows/scrape.yml     # 6-hour cron pipeline
```

---

## Quick start (local dev)

### Prerequisites

- Node.js `^20` or `v24`
- pnpm `^9` — `npm install -g pnpm`
- A Supabase project (free tier is fine)

### 1. Clone or Fork

- **To run 100% locally (for learning, local testing, or teaching)**:
  ```bash
  git clone https://github.com/YOUR_USERNAME/job-me.git
  cd job-me
  pnpm install
  ```
- **To deploy automated 6-hour runs on GitHub Actions**:
  Click **Fork** on GitHub (top-right of this repo) and clone your fork.

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier works)
2. Go to **Project Settings → API** and note:
   - Project URL
   - Anon key
   - Service Role key
3. Go to **SQL Editor**, paste the contents of [`supabase/schema.sql`](./supabase/schema.sql), and click **Run**

   The schema is fully **idempotent** — safe to run on a fresh or existing database. It creates all tables, RLS policies, indexes, and seeds default job sources automatically.

4. Go to **Storage → New bucket**, name it `cv-files`, set it to **Private**

### 3. Create environment files

**`apps/web/.env.local`**
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Required for the "Run now" button on /sources — GitHub PAT with
# repo + workflow scope (or fine-grained with Actions: Read and write)
VITE_GITHUB_PAT=github_pat_xxxxxx
VITE_GITHUB_REPO=YOUR_USERNAME/job-me
VITE_GITHUB_BRANCH=main
```

**`packages/scraper/.env`**
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

APPLICANT_FIRST_NAME=Jane
APPLICANT_LAST_NAME=Doe
APPLICANT_EMAIL=jane.doe@example.com
APPLICANT_PHONE=+447123456789   # optional
CV_FILE_PATH=/path/to/your-cv.pdf

# Optional — enables AI cover letter generation and spam filtering
# Free tier: 15 req/min, 1M tokens/day
# Get key: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=
```

### 4. Run locally

```bash
pnpm dev          # Dashboard at http://localhost:5173
pnpm pipeline     # Run the full scrape → enrich → match → auto-apply pipeline once
pnpm typecheck    # TypeScript check across all packages
pnpm test         # Run unit tests
pnpm build        # Production build of the frontend
```

---

## Full deployment

### Step 1 — Deploy the frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your fork
2. Configure the project:

| Setting | Value |
|---|---|
| Framework Preset | `Vite` |
| Root Directory | `apps/web` |
| Build Command | `pnpm --filter @job-me/web build` |
| Output Directory | `dist` |
| Install Command | `pnpm install` |

3. Add environment variables under **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://your-project-ref.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `VITE_GITHUB_PAT` | GitHub PAT with `repo` + `workflow` scopes — enables the "Run now" button |
| `VITE_GITHUB_REPO` | `YOUR_USERNAME/job-me` |
| `VITE_GITHUB_BRANCH` | `main` (optional) |

4. Click **Deploy**

#### Custom domain (optional)

- Apex domain (`yourdomain.com`) → DNS `A` record → `76.76.21.21`
- Subdomain (`jobs.yourdomain.com`) → DNS `CNAME` → `cname.vercel-dns.com`

Vercel provisions SSL automatically.

### Step 2 — Configure GitHub Actions secrets

Go to your fork → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | `https://your-project-ref.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key |
| `APPLICANT_FIRST_NAME` | ✅ | Your first name |
| `APPLICANT_LAST_NAME` | ✅ | Your last name |
| `APPLICANT_EMAIL` | ✅ | Your email for job applications |
| `APPLICANT_PHONE` | Optional | Your phone e.g. `+447123456789` |
| `GEMINI_API_KEY` | Optional | Enables AI features (cover letters + spam filter) |

The pipeline runs automatically every 6 hours. You can also trigger it manually from the `/sources` page using the **Run now** button — it dispatches `workflow_dispatch` via the GitHub API using `VITE_GITHUB_PAT`.

> **More secure alternative (optional, technical setups):** the `trigger-pipeline` Supabase Edge Function keeps the PAT server-side instead of the frontend bundle:
> ```bash
> supabase functions deploy trigger-pipeline --no-verify-jwt
> supabase secrets set GH_TOKEN=github_pat_xxxxxx GITHUB_REPO=YOUR_USERNAME/job-me GITHUB_BRANCH=main
> ```
> The button works with either mechanism — both write the same `workflow_dispatch` event.

### Step 3 — Upload your CV

1. Open the dashboard → go to `/cv`
2. Upload your CV (PDF)
3. Set it as the default for your target roles

The pipeline downloads the file of each job's **role-matched** CV row from Supabase Storage automatically (a `CV_FILE_PATH` fallback is used only for jobs that match no CV row) — no hardcoded paths.

### Step 4 — Configure your settings

Go to `/settings` and set:

- **Target roles** — job title keywords for the scoring engine; also the default search terms for sources with no query params of their own (use `{role}` / `{roles}` placeholders to wire them into any source)
- **Target seniority** — junior / mid / senior / any
- **Accepted locations** — used by the location scoring signal and as the default scrape location (use `{location}` / `{locations}` placeholders)
- **Negative keywords** — any keyword that immediately disqualifies a job
- **Skill vocabulary** — skills from your CV used for the skills overlap signal
- **Auto-apply threshold** — minimum score to trigger auto-apply (default 75%)
- **Max auto-apply per run** — rate cap per pipeline run (default 5)
- **Days-since-posted default** — feed filter and recency scoring window (use `{days}` placeholder)

### Step 5 — Get a Gemini API key (optional, free)

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click **Create API key**
3. Add it as `GEMINI_API_KEY` in both GitHub Actions secrets and `packages/scraper/.env`

Free tier: **15 requests/minute, 1 million tokens/day** — more than enough.

With a key set, the pipeline will:
- Filter spam/fake/MLM postings before scoring
- Confirm remote status on ambiguous listings
- Generate a tailored 3-paragraph cover letter per auto-apply

Without a key, the pipeline runs normally — AI steps are silently skipped.

---

## Dashboard pages

| Page | Route | Description |
|---|---|---|
| Dashboard | `/` | Job list with pipeline sidebar, filter bar, bulk-delete, and detail drawer |
| Sources | `/sources` | Add/edit/toggle job board sources, trigger manual runs |
| Applications | `/applications` | Full history of every auto and manual application |
| CV | `/cv` | Upload CV versions, set defaults per role |
| Settings | `/settings` | Target roles, seniority, locations, skills, thresholds |

---

## Scoring engine

Every job is scored `0.00–1.00` across 5 signals:

| Signal | Weight | Logic |
|---|---|---|
| Title match | **40%** | Whole-word overlap against your target roles (initialisms like SRE ↔ Site Reliability Engineer match too). No role words → score forced to 0 |
| Skills overlap | **30%** | Whole-word match against your skill vocabulary in the description |
| Seniority | **15%** | Detected level vs target; adjacent levels get partial credit |
| Location | **10%** | Driven by your accepted-locations setting: 1.0 for listed Ghana locations, 0.95 for listed remote locations, 0.8 for other accepted locations; anything else → rejected and closed. An empty list accepts all locations |
| Recency decay | **5%** | Exponential decay — 14-day-old post scores ~37% |

A negative keyword hit forces the score to `0.00` immediately and closes the job. Jobs scoring ≥ 40% (`MATCH_PROMOTION_THRESHOLD`) with an accepted location are promoted from **New** to **Matched**; already-matched jobs keep their status (no flapping), and manual-queue jobs are never auto-promoted.

---

## Source connectors

| Type | Notes |
|---|---|
| `rss` | Generic RSS/Atom — WeWorkRemotely, Remotive, NoDesk, HN Jobs, Dev.to |
| `api` | Generic REST API — RemoteOK, Remotive API |
| `generic_web` | Playwright headless scraper — auto-detects job cards/links on any public career/board page |
| `arbeitnow` | Free EU/remote API, no key needed |
| `jobicy` | Free remote API, no key needed |
| `linkedin` | Playwright headless scraper — no login, first ~25 public results |
| `indeed` | Playwright headless scraper |
| `glassdoor` | Playwright headless scraper |
| `otta` | Free public API |

---

## Auto-apply connectors

| ATS | URL pattern matched |
|---|---|
| Greenhouse | `greenhouse.io`, `boards.greenhouse.io` |
| Lever | `jobs.lever.co`, `lever.co/` |
| Workday | `myworkdayjobs.com`, `wd3.myworkday.com`, `wd1.myworkday.com` |

Jobs with no matching connector go to **Manual Queue** automatically (these don't consume rate-cap budget). Every attempt against a connector — success or failure — counts toward the per-run rate cap.

---

## Adding job sources

From `/sources`, click **Add source**:

- **Name** — display name
- **Type** — connector type from the table above
- **Base URL** — the feed or API endpoint
- **Query params** — JSON object of URL parameters

### Settings placeholders

Every source is scraped with your **/settings** configuration applied. Any of these placeholders can be used in the **Base URL** or in **Query params** (string values), and are substituted at scrape time:

| Placeholder | Resolves to |
|---|---|
| `{roles}` | All target roles, space-joined |
| `{role}` | First target role |
| `{locations}` | All accepted locations, space-joined |
| `{location}` | First accepted location |
| `{days}` | Days-since-posted default |

This works for **all 9 source types** — including generic web pages, where the search terms live in the URL itself. Sources without placeholders keep their configured values verbatim. Sources with **no query params at all** get settings-derived defaults automatically (first target role, first accepted location, and a recency window from `days_posted_default` where the API supports it).

### Example configs

**Generic Web Page (Playwright) — any careers page, driven by Settings**
```json
{
  "type": "generic_web",
  "base_url": "https://example.com/jobs?q={role}&location={location}&posted_within={days}",
  "query_params": { "card_selector": ".job-card", "title_selector": ".job-card h3" }
}
```

**Generic Web Page (Playwright) — Public Careers Page (fixed URL)**
```json
{
  "type": "generic_web",
  "base_url": "https://remotive.com/remote-devops-jobs",
  "query_params": {}
}
```

**Indeed Playwright — DevOps Remote**
```json
{
  "type": "indeed",
  "base_url": "https://www.indeed.com/jobs",
  "query_params": { "q": "devops engineer", "l": "Remote", "sort": "date", "fromage": "7" }
}
```

**LinkedIn — SRE Worldwide**
```json
{
  "type": "linkedin",
  "base_url": "https://www.linkedin.com/jobs/search",
  "query_params": { "keywords": "site reliability engineer", "location": "Worldwide", "f_WT": "2", "f_TPR": "r604800" }
}
```

**WeWorkRemotely RSS**
```json
{
  "type": "rss",
  "base_url": "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
  "query_params": {}
}
```

**Jobicy — Terraform**
```json
{
  "type": "jobicy",
  "base_url": "https://jobicy.com/api/v2/remote-jobs",
  "query_params": { "tag": "terraform", "count": "50" }
}
```

---

## Environment variables reference

### `apps/web/.env.local`

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon key (safe to expose in frontend) |
| `VITE_GITHUB_PAT` | Optional | GitHub PAT with `repo` + `workflow` scopes — enables the "Run now" button |
| `VITE_GITHUB_REPO` | Optional | `username/repo` — required if PAT is set |
| `VITE_GITHUB_BRANCH` | Optional | Branch to trigger workflow on (default: `main`) |

### `packages/scraper/.env` / GitHub Actions secrets

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key — bypasses RLS, keep secret |
| `APPLICANT_FIRST_NAME` | ✅ | Used in auto-apply form fields |
| `APPLICANT_LAST_NAME` | ✅ | Used in auto-apply form fields |
| `APPLICANT_EMAIL` | ✅ | Used in auto-apply form fields |
| `APPLICANT_PHONE` | Optional | Used in auto-apply phone fields |
| `CV_FILE_PATH` | Optional* | Fallback CV path — used only for jobs that match no CV row |
| `GEMINI_API_KEY` | Optional | Enables AI spam filtering and cover letter generation |

> \* In GitHub Actions, `CV_FILE_PATH` is seeded automatically by the workflow when a CV exists in Supabase Storage, and auto-apply downloads each job's role-matched CV regardless. You only need to set it manually for local pipeline runs without uploaded CVs.

---

## Contributing

1. Fork the repo and create a feature branch
2. Run `pnpm typecheck && pnpm test && pnpm build` before opening a PR — all three must pass
3. Keep secrets out of committed code — use `.env.example` files as the reference
4. Add a connector? Follow the `AutoApplyConnector` interface in `packages/scraper/src/auto-apply-connectors/base.ts`

---

## License

MIT — free for personal and commercial use.
