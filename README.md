# job-me

> Personal automated job application tracking & discovery pipeline designed for Cloud Engineer, DevOps Engineer, AWS Technical Trainer, and Platform Engineer roles.

---

## 🏗 Architecture Overview

`job-me` is structured as a TypeScript monorepo managed with `pnpm` workspaces:

```
job-me/
├── apps/
│   └── web/                   # Vite + React SPA (Dashboard, Summary Bar, Sources, CV, Settings)
├── packages/
│   ├── shared/                # Shared types, 5-signal match scoring engine, Supabase client
│   └── scraper/               # Scraper runner (batch upserts), RSS/API connectors, Playwright ATS auto-apply
├── supabase/
│   └── migrations/            # Postgres schema, fail counters, and single-owner RLS security policies
└── .github/
    └── workflows/
        └── scrape.yml         # GitHub Actions 6-hour cron & manual pipeline runner with auto CV download
```

---

## 🛠 Tech Stack & Design Tokens

- **Frontend**: React 18, React Router v6, Lucide React, Vanilla CSS Modules.
- **Design Tokens**: Standardized CSS custom properties in `apps/web/src/styles/tokens.css`.
  - **Color Palette**: Dark theme (`--bg: #12161C`, `--surface: #1A2028`, `--surface-raised: #212832`, `--accent: #5B8DBF`). No pure black (`#000`) or pure white (`#fff`). Flat single colors only (no gradients, no glassmorphism).
  - **Typography**: `Inter` for UI headings/body, `JetBrains Mono` for counts, match scores, dates, status tags, and code-like data.
  - **Design Constraints**: Fixed card border-radius (`6px`), badge radius (`4px`), no rounded-full pill buttons, no decorative numbers, subtle border/background hover transitions only.
- **Backend & Database**: Supabase (PostgreSQL with single-owner Row Level Security and Storage).
- **Scraper & Automation**: Node.js, RSS Parser, Playwright (Chromium) for Greenhouse ATS auto-apply with rate limiting (max 10 applications per run).

---

## ⚡ Quick Start & Local Development

### 1. Prerequisites
- Node.js `^20.0.0` or `v24.x`
- `pnpm` `^9.0.0` (`npm install -g pnpm`)

### 2. Installation
```bash
git clone <repository-url>
cd job-me
pnpm install
```

### 3. Environment Setup

#### Web Application (`apps/web/.env`)
Create or edit `apps/web/.env`:
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Optional: Enables "Run Now" manual trigger on /sources page via GitHub Actions API
VITE_GITHUB_PAT=github_pat_xxxxxx
VITE_GITHUB_REPO=owner/job-me
```

#### Scraper Package (`packages/scraper/.env`)
Create `packages/scraper/.env`:
```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Applicant Details for ATS Auto-Apply Connectors
APPLICANT_FIRST_NAME=Jane
APPLICANT_LAST_NAME=Doe
APPLICANT_EMAIL=jane.doe@example.com
APPLICANT_PHONE=+447123456789
CV_FILE_PATH=/tmp/resume.pdf
```

### 4. Running Locally

```bash
# Start Vite development server for web app (http://localhost:5173)
pnpm dev

# Run TypeScript typecheck across all workspace packages
pnpm typecheck

# Run Scrape → Match → Auto-Apply pipeline manually
pnpm pipeline
```

---

## 🗄 Database Setup & Migrations (Supabase)

1. **Create a Supabase Project**: Go to [supabase.com](https://supabase.com) and create a project.
2. **Execute Migrations in Order**:
   - Open the **SQL Editor** in your Supabase Dashboard.
   - Run `supabase/migrations/0001_init.sql` (Creates `sources`, `jobs`, `cv_versions`, `applications`, and `settings` tables).
   - Run `supabase/migrations/0002_rls.sql` (Initial RLS setup).
   - Run `supabase/migrations/0003_schema_fixes.sql` (Adds `raw_location` to `jobs` and `consecutive_fail_count` to `sources`).
   - Run `supabase/migrations/0004_fix_rls.sql`:
     > ⚠️ **Important:** In `0004_fix_rls.sql`, replace all `<OWNER_UID>` placeholders with your actual user UUID from `SELECT id FROM auth.users WHERE email = 'your@email.com';`.
3. **Storage Bucket Setup**:
   - Navigate to **Storage** in your Supabase Dashboard.
   - Create a bucket named `cv-files` (Private bucket).
   - Upload your active resume PDF as `resume.pdf`.

---

## 🎯 5-Signal Match Scoring Engine

Located in `packages/shared/src/scoring.ts`, `scoreJob()` evaluates every scraped job against configurable target roles and user settings using five weighted signals:

| Signal | Weight | Logic |
|---|---|---|
| **Title Match** | 0.40 | Fuzzy keyword matching against target roles (`Cloud Engineer`, `DevOps Engineer`, `AWS Instructor`) |
| **Skills Overlap** | 0.30 | Matches target skills (`AWS`, `Terraform`, `Kubernetes`, `Docker`, `Python`) in description |
| **Seniority Level** | 0.15 | Evaluates target seniority (`junior`, `mid`, `senior`, `any`) against job title tokens |
| **Location** | 0.10 | Validates against `accepted_locations` (`remote`, `uk`, `united kingdom`) |
| **Recency Decay** | 0.05 | Exponential score reduction based on days since posting |

*Jobs containing negative keywords (e.g. "Unpaid", "Clearance Required") are automatically closed with score forced to 0.*

---

## 🚀 Live Deployment Checklist

Follow these exact steps to run `job-me` live in production:

### Step 1: Supabase Configuration
- [x] Run all SQL migrations (`0001_init.sql` through `0004_fix_rls.sql`) in Supabase SQL Editor.
- [x] Ensure your user UUID is substituted into `0004_fix_rls.sql`.
- [x] Upload your resume to the `cv-files` bucket named `resume.pdf`.

### Step 2: Deploy Frontend SPA to Vercel
1. Import your `job-me` repository into **Vercel**.
2. Set **Framework Preset** to `Vite`.
3. Set **Root Directory** to `apps/web`.
4. Set **Build Command** to `pnpm --filter @job-me/web build`.
5. Set **Output Directory** to `dist`.
6. Add Environment Variables:
   - `VITE_SUPABASE_URL` = `https://<your-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = `<your-anon-key>`
   - `VITE_GITHUB_PAT` = `<your-github-pat-with-repo-scope>` (Optional: enables "Run now" button on `/sources`)
   - `VITE_GITHUB_REPO` = `<your-github-username>/job-me` (Optional)
7. Click **Deploy**.

### Step 3: Configure GitHub Actions Automation Pipeline
Navigate to **GitHub Repository Settings → Secrets and variables → Actions** and add:
- `SUPABASE_URL` = `https://<your-ref>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = `<your-supabase-service-role-key>`
- `APPLICANT_FIRST_NAME` = `YourFirstName`
- `APPLICANT_LAST_NAME` = `YourLastName`
- `APPLICANT_EMAIL` = `your.email@example.com`
- `APPLICANT_PHONE` = `+447000000000`

The pipeline (`.github/workflows/scrape.yml`) runs automatically **every 6 hours** and will:
1. Download `resume.pdf` from Supabase Storage into `/tmp/resume.pdf`.
2. Scrape all active sources defined on the `/sources` page.
3. Batch upsert jobs and update `consecutive_fail_count` per source.
4. Run 5-signal scoring & routing.
5. Attempt automated form submission via Playwright for matching jobs.

---

## 📄 License

Private repository. All rights reserved.

