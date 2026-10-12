# job-me

> **An autonomous, self-hosted job application pipeline and personal tracking dashboard.**  
> Scrapes 9 job board sources, scores postings against your exact technical profile using a 5-signal algorithm, filters spam with Google Gemini AI, generates tailored cover letters, and auto-applies to ATS systems (Greenhouse, Lever, Workday) using Playwright — all running 24/7 for **$0 hosting cost**.

```
+------------+     +--------------+     +-------------+     +----------------+
| 1. SCRAPE  | --> |  2. ENRICH   | --> |  3. MATCH   | --> | 4. AUTO-APPLY  |
| 9 boards   |     | Gemini AI    |     | 5 signals   |     | Playwright ATS |
| & feeds    |     | Spam filter  |     | 0%-100% fit |     | & CV upload    |
+------------+     +--------------+     +-------------+     +----------------+
```

---

## Workshop and Setup Navigation

Follow this guide step-by-step for post-presentation workshops and deployment:

1. [Platform Overview](#platform-overview)
2. [Architecture and Hosting Specifications](#architecture-and-hosting-specifications)
3. [System Prerequisites (Linux and Windows)](#system-prerequisites-linux-and-windows)
4. [Track A: Local Setup Guide (Zero Cloud Deployment)](#track-a-local-setup-guide-zero-cloud-deployment)
5. [Track B: Cloud Deployment Guide (24/7 Automation)](#track-b-cloud-deployment-guide-247-automation)
6. [Environment Variables Reference (.env.local)](#environment-variables-reference-envlocal)
7. [Platform Logic and Scoring Engine](#platform-logic-and-scoring-engine)
8. [Dashboard Structure and User Workflow](#dashboard-structure-and-user-workflow)
9. [Commands and Database Maintenance Reference](#commands-and-database-maintenance-reference)
10. [Troubleshooting and Platform FAQ](#troubleshooting-and-platform-faq)

---

## Platform Overview

Job hunting burnout is driven by three frictions:
1. **The Time Sink:** Re-typing your name, contact details, and uploading CVs to repetitive Greenhouse, Lever, and Workday forms.
2. **Information Fatigue:** Sifting through recruiter spam, ghost listings, and duplicate postings across dozens of boards.
3. **Location Mismatch:** Spending time applying to international roles only to get auto-rejected because they require non-sponsored on-site presence.

**`job-me` solves this with an end-to-end autonomous engine:**
- **Automated Discovery:** Scrapes listings every 6 hours across 9 source types (RSS, APIs, LinkedIn, RemoteOK, Jobicy, Arbeitnow, generic web pages).
- **Intelligent 5-Signal Scoring:** Evaluates title match, skill overlap, seniority, location eligibility, and recency on a calibrated scale (0% to 100%).
- **Strict Location Engine:** Gives Ghana and African roles top priority (1.0), accepts verified remote foreign roles (0.95), and hard-rejects foreign on-site roles (0.0 -> Closed).
- **Automated Submissions:** Playwright Chromium fills out application forms, attaches the correct role-matched PDF CV, and writes a tailored AI cover letter.
- **Fail-Safe Routing:** Automatically routes CAPTCHA-protected or non-standard roles to a **Manual Queue** for 1-click review.

---

## Architecture and Hosting Specifications

| Layer | Technology | Hosting & Cost |
|---|---|---|
| **Frontend Dashboard** | React 18, React Router v6, CSS Modules, Lucide Icons | **Vercel** — Free tier ($0) |
| **Database & Storage** | Supabase (PostgreSQL + Row Level Security + Storage Buckets + Realtime) | **Supabase** — Free tier ($0) |
| **Automation Pipeline** | Node.js, Playwright (Chromium), `rss-parser` | **GitHub Actions** — 6-hour cron ($0) |
| **AI Intelligence** | Google Gemini 2.5 Flash (Spam detection & cover letters) | **Google AI Studio** — Free tier ($0) |
| **Monorepo Tooling** | TypeScript, pnpm workspaces, Vitest | Local machine ($0) |

```
job-me/
|-- apps/web/                    -> React 18 + Vite SPA dashboard
|-- packages/
|   |-- shared/                  -> Scoring engine, domain types, Supabase & Gemini clients
|   `-- scraper/                 -> 4-stage pipeline, 9 connectors, Playwright ATS form-fillers
|-- supabase/
|   |-- schema.sql               -> Single-file idempotent database schema & seed data
|   `-- functions/               -> Optional trigger-pipeline edge function
`-- .github/workflows/
    `-- scrape.yml               -> 6-hour cron and manual dispatch GitHub Actions pipeline
```

---

## System Prerequisites (Linux and Windows)

Ensure your operating system meets the requirements below.

### 1. Node.js (v20.x or v24.x)
- **Linux (Ubuntu/Debian):**
  ```bash
  # Check current version
  node -v

  # If not installed or below v20, install via NodeSource or NVM:
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **Linux (Fedora/RHEL):**
  ```bash
  sudo dnf install -y nodejs
  ```
- **Windows:**
  - Verify in PowerShell or Command Prompt: `node -v`
  - If not installed, download from [nodejs.org](https://nodejs.org) or install via `winget`:
    ```powershell
    winget install OpenJS.NodeJS.LTS
    ```

### 2. Package Manager (pnpm ^9.0.0)
Install `pnpm` globally on either operating system:
```bash
npm install -g pnpm
pnpm -v
```

### 3. Git
- **Linux:** `sudo apt-get install -y git` (or distribution package manager).
- **Windows:** Download from [git-scm.com](https://git-scm.com) or run `winget install Git.Git`.

### 4. Supabase & Google Gemini Accounts
- **Supabase Account:** Free tier project at [supabase.com](https://supabase.com).
- **Google Gemini API Key:** Optional free key at [Google AI Studio](https://aistudio.google.com/app/apikey).

---

## Track A: Local Setup Guide (Zero Cloud Deployment)

Run the entire system locally on your laptop without setting up cloud servers or deploying to Vercel.

### Step 1: Clone the Repository

**Linux (Bash / Zsh):**
```bash
git clone https://github.com/mustaphahaadi/job-me.git
cd job-me
```

**Windows (PowerShell / Command Prompt):**
```powershell
git clone https://github.com/mustaphahaadi/job-me.git
cd job-me
```

---

### Step 2: Install Monorepo Dependencies

Run from the root directory on either Linux or Windows:
```bash
pnpm install
```

---

### Step 3: Install Playwright Chromium

Playwright requires Chromium binaries and operating system shared libraries to control web forms:

**Linux (Ubuntu / Debian):**
```bash
# Installs Chromium and required OS libraries (libnss3, libasound2, etc.)
npx playwright install --with-deps chromium
```
*Note for Linux users without sudo:* If `--with-deps` prompts for administrative privileges you do not possess, run `npx playwright install chromium`. Ensure baseline desktop libraries are present.

**Windows (PowerShell):**
```powershell
npx playwright install chromium
```

---

### Step 4: Configure Supabase Database and Storage

1. Log into your [Supabase Dashboard](https://supabase.com/dashboard) and select your project.
2. Navigate to **Project Settings -> API** and copy:
   - **Project URL** (format: `https://[project-ref].supabase.co`)
   - **anon / public key**
   - **service_role key** (secret key granting pipeline write access)
3. Open the **SQL Editor** in Supabase:
   - Open [`supabase/schema.sql`](./supabase/schema.sql) in this repository.
   - Copy the entire SQL content, paste it into the SQL Editor, and click **Run**.  
   *Note: The schema is fully idempotent. It safely creates all 5 tables (`sources`, `jobs`, `cv_versions`, `applications`, `settings`), indexes, Row Level Security policies, and initial job sources.*
4. Create the CV Storage Bucket:
   - Go to **Storage -> New Bucket**.
   - Bucket name: `cv-files` (must be exact).
   - Set Privacy to: **Private**.
   - Click **Save bucket**.

---

### Step 5: Configure the Single Root Environment File (.env.local)

`job-me` resolves all keys for both the web frontend and scraper pipeline from a **single file in the project root**.

**Linux (Bash):**
```bash
cp .env.example .env.local
nano .env.local  # or open in your preferred editor
```

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Populate `.env.local` with your configuration:

```env
# --- Supabase Database and Storage -------------------------------------------
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# --- Applicant Information (Used by Playwright for ATS form filling) ---------
APPLICANT_FIRST_NAME=Mustapha
APPLICANT_LAST_NAME=Haadi
APPLICANT_EMAIL=mustapha.haadi@example.com
APPLICANT_PHONE=+233548367637

# --- OpenRouter AI (Optional - Free Tier or Pay-as-you-go) ----------------
# Obtain API key at: https://openrouter.ai/keys
OPENROUTER_API_KEY=your-openrouter-api-key-here
# OPENROUTER_MODEL=google/gemini-2.5-flash  # optional override, default: google/gemini-2.5-flash

# --- Playwright Browser Visibility -------------------------------------------
# false = watch Chromium open and fill forms live on screen (ideal for local testing)
# true  = run silently in the background
PLAYWRIGHT_HEADLESS=false
```

---

### Step 6: Start the Local Dashboard

Run the development server from the repository root:
```bash
pnpm dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser. The dark-slate dashboard interface will load.

---

### Step 7: Upload Your CV and Configure Settings

1. In the dashboard, navigate to **CV Versions (`/cv`)**.
2. Click **Upload CV**, select your PDF CV file, provide a label (for example, `DevOps Engineer`), and assign relevant role tags.
3. Check the **Default for** options for your target roles so the pipeline knows which CV to attach per role.
4. Navigate to **Settings (`/settings`)** and adjust:
   - **Target roles:** (e.g., `Cloud Engineer`, `DevOps Engineer`, `SRE`)
   - **Target seniority:** (`junior`, `mid`, `senior`, or `any`)
   - **Skill vocabulary:** technical keywords from your resume (`aws`, `docker`, `kubernetes`, `terraform`, `linux`, `python`)
   - **Auto-apply score threshold:** minimum score to trigger automated application (default: `75%`)

---

### Step 8: Execute the Scraper and Auto-Apply Pipeline

Open a second terminal window in the root directory and execute:

**Linux / Windows:**
```bash
pnpm pipeline
```

The pipeline executes the four sequential stages:
```
=== [job-me] Pipeline started ===
[scrape] Running 5 source(s)...
[enrich] Checking postings with Gemini 2.5 Flash...
[match] Scored jobs against settings: 56 matched, 12 new, 706 closed.
[auto-apply] Launching Playwright Chromium...
=== [job-me] Pipeline complete ===
```
Because `PLAYWRIGHT_HEADLESS=false` was configured, Chromium will display on screen, open eligible job URLs, fill in your details, attach your CV, and submit. The web dashboard updates simultaneously in real time via Supabase Realtime without page reloads.

---

## Track B: Cloud Deployment Guide (24/7 Automation)

Deploy the system to run autonomously in the cloud at $0 cost.

### Step 1: Deploy Web Frontend to Vercel

1. Fork this repository to your GitHub account.
2. Sign in to [vercel.com](https://vercel.com) and click **Add New Project**.
3. Import your forked repository.
4. Set the project configuration:
   - **Framework Preset:** `Vite`
   - **Root Directory:** `apps/web`
   - **Build Command:** `pnpm --filter @job-me/web build`
   - **Output Directory:** `dist`
   - **Install Command:** `pnpm install`
5. In **Environment Variables**, define:
   - `VITE_SUPABASE_URL` = `https://your-project-ref.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
   - *(Optional)* `VITE_GITHUB_PAT` = your GitHub Personal Access Token (enables the "Run now" button on the dashboard)
   - *(Optional)* `VITE_GITHUB_REPO` = `your-username/job-me`
6. Click **Deploy**. Your dashboard is now active on a global HTTPS URL.

---

### Step 2: Configure GitHub Actions Secrets

In your forked GitHub repository, navigate to:  
**Settings -> Secrets and variables -> Actions -> New repository secret**

Add the following repository secrets:

| Secret Name | Requirement | Description |
|---|---|---|
| `SUPABASE_URL` | Required | Your Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Your Supabase `service_role` secret key |
| `APPLICANT_FIRST_NAME` | Required | Applicant first name for application forms |
| `APPLICANT_LAST_NAME` | Required | Applicant last name for application forms |
| `APPLICANT_EMAIL` | Required | Applicant email address |
| `APPLICANT_PHONE` | Optional [Recommended] | Applicant phone number (e.g. `+233548367637`) |
| `GEMINI_API_KEY` | Optional [Recommended] | Gemini API key for AI spam detection and cover letters |

---

### Step 3: Automated 6-Hour Scheduled Execution

The workflow file [`.github/workflows/scrape.yml`](./.github/workflows/scrape.yml) is scheduled to run every 6 hours:
```yaml
on:
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch:
```
- GitHub provisions an Ubuntu runner on the free tier.
- Playwright Chromium is initialized.
- The pipeline downloads your role-matched CV from Supabase Storage.
- Executes `pnpm pipeline` headlessly.
- Consumes approximately 300 minutes per month out of GitHub's **2,000 free minutes per month**.

---

### Step 4: On-Demand Manual Cloud Trigger

You do not need to wait for the 6-hour cron schedule:
- **From Dashboard:** Open the `/sources` page and click **Run now** or **Run all sources**. This triggers `workflow_dispatch` via the GitHub API using `VITE_GITHUB_PAT`.
- **From GitHub UI:** Go to **Actions -> Run pipeline -> Run workflow**.

---

## Environment Variables Reference (.env.local)

Both local execution and the frontend web app resolve settings from root `/.env.local`:

| Variable | Target Scope | Status | Purpose |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Web + Pipeline | Required | Supabase project URL (`https://xxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Web + Pipeline | Required | Public Supabase anon key for browser client queries |
| `SUPABASE_SERVICE_ROLE_KEY` | Pipeline | Required | Admin secret key (bypasses RLS for scraper write operations) |
| `APPLICANT_FIRST_NAME` | Pipeline | Required | First name entered into ATS application forms |
| `APPLICANT_LAST_NAME` | Pipeline | Required | Last name entered into ATS application forms |
| `APPLICANT_EMAIL` | Pipeline | Required | Contact email address entered into ATS forms |
| `OPENROUTER_API_KEY` | Pipeline | Optional [Recommended] | OpenRouter key for AI spam checking and tailored cover letters |
| `OPENROUTER_MODEL` | Pipeline | Optional | Model identifier (default: `google/gemini-2.5-flash` or `openai/gpt-4o-mini`) |
| `PLAYWRIGHT_HEADLESS` | Pipeline | Optional | `false` to display Chromium on desktop; `true` for headless |
| `VITE_GITHUB_PAT` | Web | Optional | Personal access token (`repo` + `workflow`) for "Run now" button |
| `VITE_GITHUB_REPO` | Web | Optional | `username/job-me` target for GitHub dispatch |
| `VITE_GITHUB_BRANCH` | Web | Optional | Target git branch (default: `main`) |

---

## Platform Logic and Scoring Engine

### 1. The 4-Stage Pipeline Flow

1. **Stage 1 — Scrape (`pipeline/scrape.ts`):**
   - Queries active sources in the database.
   - Routes through 9 connector implementations: `rss`, `api`, `generic_web`, `linkedin`, `indeed`, `glassdoor`, `otta`, `jobicy`, and `arbeitnow`.
   - Substitutes search placeholders (`{roles}`, `{locations}`, `{days}`) dynamically from your user settings.
   - Executes batch upserts against unique job URLs to prevent duplicates.
2. **Stage 2 — Enrich (`pipeline/enrich.ts`):**
   - Submits raw listings to Google Gemini 2.5 Flash.
   - Detects fraudulent/spam postings and transitions them directly to `closed`.
   - Verifies remote work eligibility without altering original job descriptions.
3. **Stage 3 — Match (`pipeline/match.ts`):**
   - Applies the 5-signal algorithmic scoring engine against configured settings.
   - Scores greater than or equal to 40% with accepted locations transition from `new` to `matched`.
   - Low-scoring postings (< 25%) or foreign on-site roles are marked `closed`.
4. **Stage 4 — Auto-Apply (`pipeline/auto-apply.ts`):**
   - Retrieves `matched` postings meeting or exceeding the auto-apply threshold (default: 75%).
   - Matches ATS patterns for Greenhouse, Lever, and Workday.
   - Downloads the corresponding role-matched CV PDF from Supabase Storage.
   - Playwright navigates the form, inputs applicant information, attaches the CV, and records the audit log in `applications`.

---

### 2. The 5-Signal Match Engine (`packages/shared/src/scoring.ts`)

```
Match Score = (Title * 0.40) + (Skills * 0.30) + (Seniority * 0.15) + (Location * 0.10) + (Recency * 0.05)
```

| Signal | Weight | Logic and Constraints |
|---|---|---|
| **Title Match** | **40%** | Word-level overlap against target roles (handles initialisms like SRE <-> Site Reliability Engineer). **Hard Stop**: if title has no overlap with target roles, overall score is forced to `0.00`. |
| **Skills Overlap** | **30%** | Evaluates description against technical vocabulary (`aws`, `docker`, `kubernetes`, `terraform`, `linux`, `python`). 3 or more matches equals 100%. |
| **Seniority** | **15%** | Evaluates Junior, Mid, or Senior tokens. Exact level match = 1.0; adjacent level = 0.5; mismatched level = 0.1. |
| **Location Rules** | **10%** | **Ghana roles:** score 1.0 (on-site or remote).<br/>**Foreign remote roles:** score 0.95.<br/>**Foreign on-site roles:** Hard reject (score 0, status `closed`). |
| **Recency** | **5%** | Exponential decay curve: `e^(-days / 14)`. New postings receive full score. |

---

### 3. Resilience and Safety Guardrails

- **Fail-Fast CAPTCHA Detection:** Scans DOM for Cloudflare Turnstile, reCAPTCHA, or hCaptcha prior to form entry. If detected, execution halts immediately and routes the posting to the **Manual Queue** to protect applicant IP reputation.
- **Attempt-Based Rate Limiting:** Form submissions are bounded by `max_auto_apply_per_run` (default: 5 to 10 per run) to maintain human-like application pacing.
- **Manual Queue Safe Routing:** Roles on unsupported platforms, custom career sites, or requiring manual clarification are safely staged in the Manual Queue for 1-click candidate review.

---

## Dashboard Navigation and Workflow

| Route | Page | Purpose and Functionality |
|---|---|---|
| **`/`** | **Dashboard** | Real-time job listing with stage counts (`New`, `Matched`, `Auto-Applied`, `Manual Queue`, `Responded`, `Closed`). Filter bar, sort selection, and slide-in **Job Detail Drawer** displaying 5-signal breakdown charts and cover letters. |
| **`/sources`** | **Sources** | Manage job boards, view error logs and consecutive failure counts, configure search parameters, and trigger manual cloud pipeline executions via **Run now**. |
| **`/applications`** | **Applications** | Full audit history of all submissions (automated or manual), recording timestamps, CV version used, and match score. |
| **`/cv`** | **CV Versions** | Upload PDF resumes to Supabase Storage, tag by role classification, and toggle primary defaults per role. |
| **`/settings`** | **Settings** | Configure target roles, accepted locations, negative keywords, skill vocabulary, auto-apply thresholds, and database maintenance options. |

---

## Commands and Database Maintenance Reference

Run these commands from the repository root:

```bash
# --- Development and Verification --------------------------------------------
pnpm dev              # Launch Vite web dashboard at http://localhost:5173
pnpm pipeline         # Run the full scrape -> enrich -> match -> auto-apply pipeline
pnpm typecheck        # Verify TypeScript compilation across all workspace packages
pnpm test             # Execute Vitest test suite for scoring engine
pnpm build            # Produce production web application bundle

# --- Database Reset and Maintenance ------------------------------------------
pnpm db:clear         # Purge jobs and applications tables for a clean test run
pnpm db:clear-sources # Truncate and reset the sources table
```

---

## Troubleshooting and Platform FAQ

### 1. `Error: Chromium executable doesn't exist`
- **Linux:** Run `npx playwright install --with-deps chromium`. If library dependencies are missing, install them via your distribution package manager (`sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2`).
- **Windows:** Run `npx playwright install chromium` in PowerShell.

### 2. `Supabase Storage: Bucket not found (cv-files)`
- In the Supabase Dashboard, open **Storage**, click **New bucket**, enter the exact name `cv-files`, select **Private**, and click **Save**.

### 3. Windows PowerShell: `Execution of scripts is disabled on this system`
- Open PowerShell as Administrator and run:
  ```powershell
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  ```
- Alternatively, execute commands inside Git Bash.

### 4. Why do scraped postings receive a 0% match score?
- Inspect your **Target Roles** configuration in `/settings`. If a job posting title does not contain any of your designated role terms (e.g. `Cloud`, `DevOps`, `SRE`), the scoring engine forces the score to `0.00` to prevent unintended submissions.

### 5. Will job platforms block my IP address?
- No. `job-me` executes on a spaced 6-hour interval, limits application attempts to 5-10 per execution batch, and immediately aborts with safe manual routing if a CAPTCHA challenge is detected.

---

## License

MIT License. Free for personal, educational, and commercial use.  
Built for job seekers who want 24/7 automation with zero hosting costs.
