# job-me — Master Teaching & Student Setup Guide

> **Target Audience**: Students, Workshop Attendees, Software Engineers, and Educators.  
> **Objective**: Learn how to clone, configure, run 100% locally (without cloud deployment), customize scoring algorithms, test auto-apply, and optionally deploy `job-me` to the cloud.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Prerequisites](#2-prerequisites)
3. [Module 1: Complete Local Setup (Zero Deployment)](#3-module-1-complete-local-setup-zero-deployment)
4. [Module 2: Database Setup & Seed](#4-module-2-database-setup--seed)
5. [Module 3: Environment Configuration](#5-module-3-environment-configuration)
6. [Module 4: Running the Dashboard & Scraper Locally](#6-module-4-running-the-dashboard--scraper-locally)
7. [Module 5: Understanding Location Rules & Match Engine](#7-module-5-understanding-location-rules--match-engine)
8. [Module 6: Auto-Apply Setup & ATS Integration](#8-module-6-auto-apply-setup--ats-integration)
9. [Module 7: Database Management & Reset](#9-module-7-database-management--reset)
10. [Module 8: Forking & Cloud Deployment (Vercel + GitHub Actions)](#10-module-8-forking--cloud-deployment-vercel--github-actions)

---

## 1. Overview & Architecture

`job-me` is a TypeScript monorepo built using `pnpm` workspaces:

```
job-me/
├── apps/web/                  # React 18 + Vite SPA (Dashboard UI)
├── packages/
│   ├── shared/                # Types, 5-signal match scoring engine, Supabase/Gemini client factories
│   └── scraper/               # Scraper orchestrator, connectors (RSS, API, LinkedIn), Playwright ATS fillers
├── supabase/
│   └── schema.sql             # Single-file idempotent Postgres schema
└── .github/workflows/scrape.yml # 6-hour cron + manual execution pipeline
```

---

## 2. Prerequisites

Before starting the workshop, ensure every student has the following tools installed:

1. **Node.js**: Version `^20.0.0` or `v24.x`. Check with: `node -v`
2. **pnpm**: Version `^9.0.0`. Install globally via:
   ```bash
   npm install -g pnpm
   ```
3. **Git**: Installed and configured. Check with: `git --version`
4. **Supabase Account**: Free project at [supabase.com](https://supabase.com).

---

## 3. Module 1: Complete Local Setup (Zero Deployment)

Students can run the entire platform locally on their laptop without deploying to Vercel or setting up GitHub Actions.

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

## 4. Module 2: Database Setup & Seed

1. Log into your free project at [supabase.com](https://supabase.com).
2. Go to **Project Settings → API** and copy:
   - **Project URL** (e.g., `https://xxxx.supabase.co`)
   - **anon key** (Public client key)
   - **service_role key** (Secret admin key — bypasses RLS for background scripts)
3. Open the **SQL Editor** in Supabase:
   - Open [`supabase/schema.sql`](./supabase/schema.sql) in your text editor.
   - Copy all content and paste it into the Supabase SQL Editor.
   - Click **Run**.
   > *Note*: The schema is idempotent — safe to re-run anytime. It creates all 5 tables (`sources`, `jobs`, `cv_versions`, `applications`, `settings`), RLS policies, indexes, and seeds initial job sources.
4. Go to **Storage → Create a new bucket**:
   - Bucket name: `cv-files`
   - Toggle: **Private**

---

## 5. Module 3: Environment Configuration

Create two environment files in your workspace:

### 1. Frontend Environment File: `apps/web/.env.local`
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Optional — enables the "Run now" button on /sources page
VITE_GITHUB_PAT=github_pat_xxxxxx
VITE_GITHUB_REPO=YOUR_USERNAME/job-me
VITE_GITHUB_BRANCH=main
```

### 2. Scraper Environment File: `packages/scraper/.env`
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Applicant identity details for Auto-Apply form filling
APPLICANT_FIRST_NAME=Jane
APPLICANT_LAST_NAME=Doe
APPLICANT_EMAIL=jane.doe@example.com
APPLICANT_PHONE=+233201234567

# Optional — local path to CV PDF file (e.g., ./my-cv.pdf)
# If left blank, the scraper automatically downloads your CV from Supabase Storage!
CV_FILE_PATH=

# Optional — Google Gemini 1.5 Flash API Key for AI cover letters & spam filtering
# Get free key at: https://aistudio.google.com/app/apikey
GEMINI_API_KEY=
```

---

## 6. Module 4: Running the Dashboard & Scraper Locally

### 1. Start the React Frontend Dashboard
```bash
pnpm dev
```
Open your browser to `http://localhost:5173`. You will see the dark-slate dashboard ready to receive job postings!

### 2. Run the Scraper & Pipeline Locally
In a separate terminal window, execute:
```bash
pnpm pipeline
```
This runs the full 4-stage pipeline locally:
```
scrape → enrich (AI spam filter) → match (5-signal scorer) → auto-apply (Playwright)
```

### 3. Run Static Checks & Tests
```bash
pnpm typecheck   # Check TypeScript across all workspace packages
pnpm test        # Run scoring engine unit tests (Vitest)
pnpm build       # Test production Vite build
```

---

## 7. Module 5: Understanding Location Rules & Match Engine

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
3. **Foreign On-site Roles**: **Hard Rejected**. Jobs located in foreign countries (e.g. Melbourne Australia, Madrid Spain, London UK) that are on-site are automatically set to `score = 0` and transitioned to status `'closed'`.

---

## 8. Module 6: Auto-Apply Setup & ATS Integration

Auto-apply operates via Playwright headless Chromium on supported ATS platforms:

| ATS Platform | URL Pattern Matched |
|---|---|
| **Greenhouse** | `greenhouse.io`, `boards.greenhouse.io` |
| **Lever** | `jobs.lever.co`, `lever.co/` |
| **Workday** | `myworkdayjobs.com`, `wd3.myworkday.com`, `wd1.myworkday.com` |

### Steps to Test Auto-Apply:
1. Upload a PDF CV on the **`/cv`** dashboard page.
2. Select default roles for your CV version.
3. Go to **`/settings`** and set the **Auto-apply score threshold** (e.g., 60% or 65%).
4. Run `pnpm pipeline` locally.
5. Postings hosted on Greenhouse/Lever/Workday with scores above threshold will auto-submit! Postings on custom/third-party sites move to **Manual Queue** for 1-click manual review.

---

## 9. Module 7: Database Management & Reset

Demonstrate how to clear the database for a fresh scraping run:

### Option A: From the Web Dashboard (Settings Page)
1. Open the dashboard → go to **`/settings`**.
2. Scroll to the **Database Management** section at the bottom.
3. Click **Clear database**.
4. Confirm the prompt to wipe all jobs and application history.

### Option B: From the Terminal
```bash
pnpm db:clear
```

---

## 10. Module 8: Forking & Cloud Deployment (Vercel + GitHub Actions)

### Step 1: Fork and Deploy Frontend to Vercel
1. Fork the repo to your GitHub account.
2. Log into [vercel.com](https://vercel.com) → **Add New Project** → Import your fork.
3. Settings:
   - Framework Preset: `Vite`
   - Root Directory: `apps/web`
   - Build Command: `pnpm --filter @job-me/web build`
   - Output Directory: `dist`
4. Add Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Click **Deploy**.

### Step 2: Configure GitHub Actions Secrets
Go to your fork → **Settings → Secrets and variables → Actions → New repository secret**:
Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APPLICANT_FIRST_NAME`, `APPLICANT_LAST_NAME`, `APPLICANT_EMAIL`, and `GEMINI_API_KEY`.

The GitHub Actions workflow (`.github/workflows/scrape.yml`) will now execute automatically every 6 hours!
