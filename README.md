# job-me

> Personal automated job application tracking & discovery pipeline designed for Cloud Engineer, DevOps Engineer, and AWS Technical Trainer roles.

---

## 🏗 Architecture Overview

`job-me` is structured as a TypeScript monorepo managed with `pnpm` workspaces:

```
job-me/
├── apps/
│   └── web/                   # Vite + React SPA (Dashboard, Sources, CV, Settings)
├── packages/
│   ├── shared/                # Shared types, 5-signal match scoring engine, Supabase client
│   └── scraper/               # Scraper runner, RSS/API connectors, Playwright ATS auto-apply
├── supabase/
│   └── migrations/            # Postgres schema and single-owner RLS security policies
└── .github/
    └── workflows/
        └── scrape.yml         # GitHub Actions 6-hour cron & manual pipeline runner
```

---

## 🛠 Tech Stack & Design Tokens

- **Frontend**: React 18, React Router v6, Lucide React, Vanilla CSS Modules.
- **Design Tokens**: Standardized CSS custom properties in `apps/web/src/styles/tokens.css`.
  - **Color Palette**: Dark theme (`--bg: #12161c`, `--surface: #1a202c`, `--accent: #3b82f6`). No pure black or pure white.
  - **Typography**: `Inter` for UI elements, `JetBrains Mono` for metadata and data grids.
  - **Design Constraints**: Fixed card border-radius (`6px`), no pill buttons, no glassmorphism, hover effects restricted to border/background shifts.
- **Backend & Database**: Supabase (PostgreSQL with Row Level Security and Storage).
- **Scraper & Automation**: Node.js, RSS Parser, Playwright (Chromium) for Greenhouse ATS auto-apply.

---

## ⚡ Quick Start & Development

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

#### Web Application (`apps/web/.env.local`)
Create `apps/web/.env.local`:
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
CV_FILE_PATH=/absolute/path/to/resume.pdf
```

### 4. Running Locally

```bash
# Start Vite development server for web app (http://localhost:5173)
pnpm dev

# Run TypeScript typecheck across all workspace packages
pnpm -r typecheck

# Run Scrape → Match → Auto-Apply pipeline manually
pnpm pipeline
```

---

## 🗄 Database Setup (Supabase)

1. **Create a Supabase Project**: Go to [supabase.com](https://supabase.com) and create a new project.
2. **Execute Migrations**:
   - Open the **SQL Editor** in your Supabase Dashboard.
   - Run `supabase/migrations/0001_init.sql` (Creates `sources`, `jobs`, `cv_versions`, `applications`, and `settings` tables).
   - Run `supabase/migrations/0002_rls.sql` (Enables Row Level Security restricting access to single owner).
3. **Storage Bucket Setup**:
   - Navigate to **Storage** in your Supabase Dashboard.
   - Create a bucket named `cv-files` (Private bucket).
   - Configure storage policies allowing authenticated single-owner read/write.

---

## 🎯 5-Signal Match Scoring Engine

Located in `packages/shared/src/scoring.ts`, `scoreJob()` evaluates every scraped job against configurable target roles and user settings using five weighted signals:

| Signal | Weight | Logic |
|---|---|---|
| **Title Match** | 0.40 | Fuzzy matching against target roles (`Cloud Engineer`, `DevOps Engineer`, `AWS Trainer`) |
| **Skills Overlap** | 0.30 | Matches target keywords (`AWS`, `Terraform`, `Kubernetes`, `Docker`, `Python`) in job description |
| **Seniority Level** | 0.15 | Compares target seniority against job title tokens |
| **Location** | 0.10 | Remote / Hybrid / On-site matching |
| **Recency Decay** | 0.05 | Linear score reduction based on days since posting |

*Jobs containing negative keywords (e.g. "Unpaid", "Clearance Required") are automatically routed to `closed` status.*

---

## 🚀 Deployment

### Web Frontend (Vercel)
1. Import the repository into **Vercel**.
2. Set **Root Directory** to `apps/web`.
3. Build Command: `pnpm --filter @job-me/web build`.
4. Output Directory: `dist`.
5. Add Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
6. Deploy! SPA routing fallback is handled automatically by `apps/web/vercel.json`.

### Automation Pipeline (GitHub Actions)
The workflow file `.github/workflows/scrape.yml` automatically executes every 6 hours and supports manual triggers via `workflow_dispatch`.

Add the following **Repository Secrets** in **GitHub Repository Settings → Secrets and variables → Actions**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APPLICANT_FIRST_NAME`
- `APPLICANT_LAST_NAME`
- `APPLICANT_EMAIL`
- `APPLICANT_PHONE`
- `CV_FILE_PATH`

---

## 📄 License

Private repository. All rights reserved.
