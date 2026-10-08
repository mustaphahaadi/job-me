// ─── Pipeline status ──────────────────────────────────────────────────────────

export type JobStatus =
  | 'new'
  | 'matched'
  | 'auto_applied'
  | 'manual_applied'
  | 'manual_queue'
  | 'responded'
  | 'closed';

/**
 * The six fixed pipeline stages (spec §3.1) — used by the sidebar.
 * `manual_applied` is a job-status value but not a separate stage: those jobs
 * group under `auto_applied` in the sidebar (they have been applied to).
 */
export const JOB_STATUSES: JobStatus[] = [
  'new',
  'matched',
  'auto_applied',
  'manual_queue',
  'responded',
  'closed',
];

// ─── Data model ───────────────────────────────────────────────────────────────

export interface Source {
  id: string;
  name: string;
  type: 'api' | 'rss' | 'arbeitnow' | 'jobicy' | 'linkedin' | 'indeed' | 'glassdoor' | 'otta' | 'generic_web';
  base_url: string;
  query_params: Record<string, unknown>;
  active: boolean;
  last_scraped_at: string | null;
  last_scrape_status: 'success' | 'failed' | null;
  last_scrape_error: string | null;
  consecutive_fail_count: number;
  created_at: string;
}

export interface CvVersion {
  id: string;
  label: string;
  file_path: string;
  role_tags: string[];
  is_default_for: string[];
  uploaded_at: string;
}

export interface MatchBreakdown {
  title_match: { score: number; weight: number; matched_keywords: string[] };
  skills_overlap: { score: number; weight: number; matched_skills: string[] };
  seniority: { score: number; weight: number; detected_level: string | null };
  location: { score: number; weight: number; accepted: boolean };
  recency: { score: number; weight: number; days_old: number };
  negative_keyword_hit: boolean;
  negative_keywords_found: string[];
  weights_version: string;
}

export interface Job {
  id: string;
  source_id: string | null;
  title: string;
  company: string | null;
  url: string;
  posted_date: string | null;
  scraped_at: string;
  description: string | null;
  raw_location: string | null;
  match_score: number | null;
  match_breakdown: MatchBreakdown | null;
  matched_keywords: string[];
  status: JobStatus;
  auto_apply_attempted_at: string | null;
  auto_apply_result: 'success' | 'failed' | null;
  auto_apply_error: string | null;
  cv_version_id: string | null;
  cover_letter_text: string | null;
  created_at: string;
}

export interface Application {
  id: string;
  job_id: string;
  applied_at: string;
  method: 'auto' | 'manual';
  cv_version_id: string | null;
}

export interface Settings {
  id: 1;
  target_roles: string[];
  days_posted_default: number;
  auto_apply_score_threshold: number;
  max_auto_apply_per_run: number;
  target_seniority?: 'junior' | 'mid' | 'senior' | 'any';
  accepted_locations?: string[];
  negative_keywords?: string[];
  skill_vocabulary?: string[];
}

/**
 * Default skill vocabulary — cloud/DevOps domain, kept identical to the seed
 * value in supabase/schema.sql so a fresh DB and a missing row agree.
 */
export const DEFAULT_SKILL_VOCABULARY = [
  'aws', 'ec2', 's3', 'lambda', 'rds', 'vpc', 'iam', 'cloudformation', 'cloudwatch',
  'eks', 'ecs', 'fargate', 'route53', 'cloudfront',
  'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm',
  'ci/cd', 'github actions', 'jenkins', 'gitlab ci', 'circleci',
  'python', 'bash', 'linux',
  'devops', 'sre', 'cloud', 'monitoring', 'observability', 'prometheus', 'grafana',
  'networking', 'load balancer', 'nginx', 'apache',
];

/**
 * Default settings — kept identical to the seed row in supabase/schema.sql
 * so a fresh DB, an in-memory fallback (scraper without service-role key), and
 * the Settings page's pre-load state never disagree.
 */
export const DEFAULT_SETTINGS: Settings = {
  id: 1,
  target_roles: ['Cloud Engineer', 'DevOps Engineer', 'AWS Technical Trainer', 'AWS Instructor', 'Platform Engineer', 'Site Reliability Engineer'],
  days_posted_default: 14,
  auto_apply_score_threshold: 0.75,
  max_auto_apply_per_run: 5,
  target_seniority: 'mid',
  accepted_locations: ['remote', 'worldwide', 'anywhere', 'global', 'africa', 'west africa', 'east africa', 'south africa', 'nigeria', 'lagos', 'kenya', 'nairobi', 'ghana', 'accra', 'johannesburg', 'cape town', 'egypt', 'cairo', 'morocco', 'casablanca'],
  negative_keywords: [],
  skill_vocabulary: DEFAULT_SKILL_VOCABULARY,
};

// ─── Scraper types ────────────────────────────────────────────────────────────

export interface NormalizedJob {
  title: string;
  company: string | null;
  url: string;
  posted_date: string | null; // ISO date string YYYY-MM-DD
  description: string | null;
  raw_location: string | null;
  raw_tags: string[];
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export const STATUS_DISPLAY: Record<JobStatus, string> = {
  new: 'NEW',
  matched: 'MATCHED',
  auto_applied: 'AUTO-APPLIED',
  manual_applied: 'MANUAL-APPLIED',
  manual_queue: 'MANUAL QUEUE',
  responded: 'RESPONDED',
  closed: 'CLOSED',
};

export const STATUS_COLOR_VAR: Record<JobStatus, string> = {
  new: 'var(--new)',
  matched: 'var(--accent)',
  auto_applied: 'var(--success)',
  manual_applied: 'var(--success)',
  manual_queue: 'var(--pending)',
  responded: 'var(--accent)',
  closed: 'var(--text-muted)',
};

// Pipeline track order — fixed, do not reorder.
export const PIPELINE_TRACK: JobStatus[] = [
  'new',
  'matched',
  'auto_applied', // shown as "AUTO-APPLIED / MANUAL QUEUE" in UI
  'responded',
  'closed',
];

/** Selects the best CV for a job title by checking is_default_for role tags. Shared between scraper and frontend. */
export function selectCvForTitle(cvs: CvVersion[], jobTitle: string): CvVersion | null {
  if (cvs.length === 0) return null;
  const titleLower = jobTitle.toLowerCase();
  const byRole = cvs.find(cv => cv.is_default_for.some(role => titleLower.includes(role.toLowerCase())));
  return byRole ?? cvs[0] ?? null;
}

/** Returns the index in the pipeline track a given status occupies. */
export function pipelineIndex(status: JobStatus): number {
  if (status === 'manual_queue' || status === 'manual_applied') return 2; // same slot as auto_applied
  const idx = PIPELINE_TRACK.indexOf(status);
  return idx === -1 ? 0 : idx;
}
