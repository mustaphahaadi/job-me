# job-me — Master Teaching & Student Setup Guide

> **Target Audience**: Students, Workshop Attendees, Software Engineers, and Educators.  
> **Objective**: Learn how to clone, configure, run 100% locally (without cloud deployment), customize 5-signal match scoring, test ATS auto-apply with CAPTCHA protection, and optionally deploy `job-me` to the cloud.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Prerequisites](#2-prerequisites)
3. [Module 1: Complete Local Setup (Zero Deployment)](#3-module-1-complete-local-setup-zero-deployment)
4. [Module 2: Database Setup & Storage Buckets](#4-module-2-database-setup--storage-buckets)
5. [Module 3: Environment Configuration](#5-module-3-environment-configuration)
6. [Module 4: Source Connectors & Template Placeholders](#6-module-4-source-connectors--template-placeholders)
7. [Module 5: Running the Dashboard & Scraper Locally](#7-module-5-running-the-dashboard--scraper-locally)
8. [Module 6: Location Rules & 5-Signal Match Engine](#8-module-6-location-rules--5-signal-match-engine)
9. [Module 7: Resilient Auto-Apply & ATS Integration](#9-module-7-resilient-auto-apply--ats-integration)
10. [Module 8: Database Management & Reset](#10-module-8-database-management--reset)
11. [Module 9: Forking & Cloud Deployment (Vercel + GitHub Actions)](#11-module-9-forking--cloud-deployment-vercel--github-actions)

---

## 1. Overview & Architecture

`job-me` is a TypeScript monorepo built using `pnpm` workspaces:

```
job-me/
├── apps/web/                    # React 18 + Vite SPA (Dashboard UI)
├── packages/
│   ├── shared/                  # Types, 5-signal match engine, Supabase/Gemini factories
│   └── scraper/                 # Scraper orchestrator, 9 connectors, Playwright ATS fillers
├── supabase/
│   └── schema.sql               # Single-file idempotent Postgres schema
└── .github/workflows/
    └── pipeline.yml             # 6-hour cron + manual execution workflow
```

### Core Pipeline Stages:
1. **Scrape**: Fetches listings across 9 source types using dynamic template placeholders (`{roles}`, `{locations}`, `{days}`) and single-query batch upserts.
2. **Enrich (AI)**: Google Gemini 1.5 Flash filters spam, recruiters, and verifies remote eligibility.
3. **Match**: Algorithmic 0–100% match scoring; auto-closes low-match listings (<25%) and foreign on-site roles.
4. **Auto-Apply**: Playwright Chromium fills Greenhouse/Lever/Workday forms with fail-fast CAPTCHA detection, cached role-matched CV PDFs, and attempt-based rate limits.

---

## 2. Prerequisites

Before starting the workshop, ensure every student has the following tools installed:

1. **Node.js**: Version `^18.0.0` or `v20.x`/`v22.x`. Verify: `node -v`
2. **pnpm**: Version `^9.0.0`. Install globally:
   ```bash
   npm install -g pnpm
   ```
3. **Git**: Installed and configured. Verify: `git --version`
4. **Supabase Account**: Free project at [supabase.com](https://supabase.com).
5. **Google Gemini API Key** *(Optional but recommended)*: Free key from [Google AI Studio](https://aistudio.google.com/app/apikey).

---

## 3. Module 1: Complete Local Setup (Zero Deployment)

Students can run the entire platform locally on their laptop without deploying to Vercel or setting up cloud infrastructure.

### Step 1: Clone the Repository
```bash
git clone https://github.com/YOUR_USERNAME/job-me.git
cd job-me
```

### Step 2: Install Monorepo Dependencies
```bash
pnpm install
```

### Step 3: Install Playwright Chromium (For Scraper & Auto-Apply)
```bash
npx playwright install --with-deps chromium
```

---

## 4. Module 2: Database Setup & Storage Buckets

1. Log into your free project at [supabase.com](https://supabase.com).
2. Go to **Project Settings → API** and copy:
   - **Project URL** (e.g., `https://xxxx.supabase.co`)
   - **anon key** (Public client key)
   - **service_role key** (Secret admin key — bypasses RLS for background scripts)
3. Open the **SQL Editor** in Supabase:
   - Open [`supabase/schema.sql`](./supabase/schema.sql) in your text editor.
   - Copy all content and paste it into the Supabase SQL Editor.
   - Click **Run**.
   > *Note*: The schema is idempotent — safe to re-run anytime. It creates all 5 tables (`sources`, `jobs`, `cv_versions`, `applications`, `settings`), RLS policies, indexes, and seeds initial sources.
4. Go to **Storage → Create a new bucket**:
   - Bucket name: `job-me-cvs`
   - Toggle: **Private**

---

## 5. Module 3: Environment Configuration

`job-me` simplifies environment setup: non-technical users only need to create a **single environment file** in the repository root directory (`.env` or `.env.local`). Both the frontend web app and the background scraper pipeline automatically inherit, resolve, and map key aliases from this single root file!

Create a single file named `.env` or `.env.local` in your project root (`/job-me/.env.local`):

```env
# ─── Supabase Configuration ───────────────────────────────────────────────────
# Copy from Supabase Project Settings → API
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Note: Supabase Dashboard keys SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and 
# SUPABASE_SECRET_KEY are also automatically detected and aliased!

# ─── Applicant Information for ATS Auto-Apply ────────────────────────────────
APPLICANT_FIRST_NAME=Jane
APPLICANT_LAST_NAME=Doe
APPLICANT_EMAIL=jane.doe@example.com
APPLICANT_PHONE=+233201234567

# ─── Optional Features ───────────────────────────────────────────────────────
# Google Gemini API Key for AI cover letters & spam filtering
# Get free key at: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your-gemini-api-key

# Playwright browser mode (false = watch browser window live in your demo, true = background)
PLAYWRIGHT_HEADLESS=false

# Optional — Required for the "Run now" button on /sources page
VITE_GITHUB_PAT=github_pat_xxxxxx
VITE_GITHUB_REPO=YOUR_USERNAME/job-me
VITE_GITHUB_BRANCH=main
```

---

## 6. Module 4: Source Connectors & Template Placeholders

`job-me` supports 9 source types out of the box. Sources can contain dynamic template placeholders that automatically pull target settings from your candidate profile:

| Connector Type | Default URL Example | Description |
|---|---|---|
| `wellfound` | `https://wellfound.com/jobs` | Startup portal scraper using Playwright auto-scroll. |
| `yc` | `https://www.workatastartup.com/jobs` | Y Combinator startup job board. |
| `jobright` | `https://jobright.ai/jobs` | AI job search portal. |
| `linkedin` | `https://www.linkedin.com/jobs/search?keywords={roles}` | LinkedIn job search connector. |
| `remotive` | `https://remotive.com/api/remote-jobs?search={roles}` | Remotive REST API connector. |
| `remoteok` | `https://remoteok.com/api` | RemoteOK API connector. |
| `weworkremotely` | `https://weworkremotely.com/remote-jobs.rss` | We Work Remotely RSS feed. |
| `rss` | Custom RSS feed URL | Generic RSS parser. |
| `generic_web` / `api` | Any custom web page or API | Configurable fallback scraper. |

### Template Placeholders Available:
- `{roles}` / `{role}`: Substituted with target candidate roles (e.g. `Fullstack, Frontend, Backend`).
- `{locations}` / `{location}`: Substituted with target candidate locations.
- `{days}`: Recency window parameter (e.g. `7`).

---

## 7. Module 5: Running the Dashboard & Scraper Locally

### 1. Start the React Frontend Dashboard
```bash
pnpm dev
```
Open your browser to `http://localhost:5173`. You will see the dark-slate dashboard ready to manage listings, sources, and CV versions!

### 2. Run the Scraper & Pipeline Locally
In a separate terminal window, execute:
```bash
pnpm pipeline
```
This runs the full 4-stage pipeline locally:
```
scrape (batch upserts) → enrich (AI spam filter) → match (5-signal scorer) → auto-apply (Playwright)
```

### 3. Run Static Checks & Vitest Suite
```bash
pnpm typecheck   # Check TypeScript across all workspace packages
pnpm test        # Run Vitest scoring engine unit tests
pnpm build       # Validate production build bundle
```

---

## 8. Module 6: Location Rules & 5-Signal Match Engine

Teach students how `job-me` scores postings from `0.00–1.00` across 5 weighted signals:

| Signal | Weight | Logic & Filtering |
|---|---|---|
| **Title Match** | **40%** | Word-level overlap against target roles + fallback for strong aliases (`engineer`, `architect`, etc.). |
| **Skills Overlap** | **30%** | Skill keyword vocabulary matches in description; 3+ matches = `1.0`. |
| **Seniority** | **15%** | Detected seniority vs target (junior / mid / senior); exact match = `1.0`, adjacent = `0.5`, mismatched = `0.1`. |
| **Location** | **10%** | Ghana priority (`1.0`), Remote (`0.95`), Unspecified (`0.5`), Foreign On-site (`0.0`). |
| **Recency** | **5%** | Exponential age decay: `e^(-days / 14)`. |

### Strict Location Rules Enforced
1. **Ghana Roles (On-site & Remote)**: Accepted with top priority (`locationScore = 1.0`).
2. **Foreign Remote Roles**: Accepted if location/title explicitly contains Remote keywords (`locationScore = 0.95`).
3. **Foreign On-site Roles**: **Hard Rejected**. Jobs located in foreign countries (e.g. Melbourne Australia, Madrid Spain, London UK) that are on-site are set to `score = 0` and transitioned to status `'closed'`.

---

## 9. Module 7: Resilient Auto-Apply & ATS Integration

Auto-apply operates via Playwright headless Chromium on supported ATS platforms with advanced safety features:

| ATS Platform | URL Pattern Matched | Safety & Features |
|---|---|---|
| **Greenhouse** | `greenhouse.io`, `boards.greenhouse.io` | Custom inputs, CV attachment, CAPTCHA protection |
| **Lever** | `jobs.lever.co`, `lever.co/` | Single-page DOM filler & CV attachment |
| **Workday** | `myworkdayjobs.com`, `wd3.myworkday.com` | Multi-step portal navigator |

### Advanced Safety & Performance Mechanisms:
1. **Fail-Fast CAPTCHA Detection (`detectCaptcha`)**: Scans pages for hCaptcha, reCAPTCHA, or Cloudflare Turnstile before form submittal; skips gracefully if detected to prevent IP blocking.
2. **Role-Matched CV Selection & Caching (`ensureCvFile`)**: Resolves candidate CV version matching the job's role category, downloads the PDF from Supabase Storage bucket (`job-me-cvs`) once per run, and caches it locally.
3. **Attempt-Based Rate Limits (`MAX_PER_RUN`)**: Tracks total submittal *attempts* (successful or failed) to prevent spamming job portals (`MAX_PER_RUN = 10`).

---

## 10. Module 8: Database Management & Reset

Demonstrate how to clear the database for a fresh scraping run:

### Option A: From the Web Dashboard (Settings Page)
1. Open the dashboard → go to **`/settings`**.
2. Scroll to the **Database Management** section at the bottom.
3. Click **Clear database**.
4. Confirm the prompt to wipe all jobs and application history.

### Option B: From the Terminal
```bash
# Clear jobs and application history:
pnpm db:clear

# Clear existing job sources as well:
pnpm db:clear-sources
```

### Option C: Reseeding Custom Sources via SQL
1. Edit the seed list at the bottom of [`supabase/schema.sql`](./supabase/schema.sql).
2. Run `pnpm db:clear-sources` (or execute `TRUNCATE sources CASCADE;` in Supabase SQL Editor).
3. Re-run `supabase/schema.sql` in Supabase SQL Editor to seed your custom list of job sources!

---

## 11. Module 9: Forking & Cloud Deployment (Vercel + GitHub Actions)

### Step 1: Deploy Frontend to Vercel
1. Fork the repo to your GitHub account.
2. Log into [vercel.com](https://vercel.com) → **Add New Project** → Import your fork.
3. Settings:
   - Framework Preset: `Vite`
   - Root Directory: `apps/web`
   - Build Command: `pnpm --filter @job-me/web build`
   - Output Directory: `dist`
4. Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Click **Deploy**.

### Step 2: Configure GitHub Actions Secrets
Go to your fork → **Settings → Secrets and variables → Actions → New repository secret**:
Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APPLICANT_FIRST_NAME`, `APPLICANT_LAST_NAME`, `APPLICANT_EMAIL`, and `GEMINI_API_KEY`.

The GitHub Actions workflow (`.github/workflows/pipeline.yml`) will execute automatically every 6 hours with zero hosting costs!
