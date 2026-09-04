import type { MatchBreakdown, NormalizedJob, Settings } from './types.js';

// ─── Skill vocabulary ─────────────────────────────────────────────────────────
// The user's actual stack from their CV / certifications.
// Configurable: extend this list to match your skills.

const SKILL_VOCABULARY = [
  'aws', 'ec2', 's3', 'lambda', 'rds', 'vpc', 'iam', 'cloudformation',
  'cloudwatch', 'eks', 'ecs', 'fargate', 'route53', 'cloudfront',
  'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm',
  'ci/cd', 'github actions', 'jenkins', 'gitlab ci', 'circleci',
  'python', 'bash', 'linux', 'devops', 'sre', 'cloud',
  'monitoring', 'observability', 'prometheus', 'grafana', 'elk',
  'networking', 'load balancer', 'nginx', 'apache',
];

// ─── Seniority tokens ─────────────────────────────────────────────────────────

const SENIOR_TOKENS = ['senior', 'sr.', 'sr ', 'lead', 'principal', 'staff', '5+ years', '7+ years', '10+ years'];
const JUNIOR_TOKENS = ['junior', 'jr.', 'jr ', 'entry', 'intern', 'graduate', '0-2 years', '1+ year'];
const MID_TOKENS = ['mid', 'mid-level', 'intermediate', '2+ years', '3+ years', '3-5 years'];

type TargetSeniority = 'junior' | 'mid' | 'senior' | 'any';

// ─── Weights ──────────────────────────────────────────────────────────────────

const WEIGHTS = {
  title_match: 0.40,
  skills_overlap: 0.30,
  seniority: 0.15,
  location: 0.10,
  recency: 0.05,
} as const;

const WEIGHTS_VERSION = '1.0';

// ─── Scoring helpers ──────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter(Boolean);
}

function textContainsAny(text: string, tokens: string[]): string[] {
  const lower = text.toLowerCase();
  return tokens.filter(t => lower.includes(t));
}

function recencyScore(postedDate: string | null): number {
  if (!postedDate) return 0.5; // unknown date — neutral
  const ageMs = Date.now() - new Date(postedDate).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Exponential decay: score = e^(-ageDays/14), so a 14-day-old post scores ~0.37
  return Math.exp(-ageDays / 14);
}

function daysOld(postedDate: string | null): number {
  if (!postedDate) return -1;
  return Math.floor((Date.now() - new Date(postedDate).getTime()) / (1000 * 60 * 60 * 24));
}

// ─── Main scoring function ────────────────────────────────────────────────────

export interface ScoringOptions {
  targetRoles: string[];
  negativeKeywords?: string[];
  acceptedLocations?: string[]; // e.g. ['remote', 'uk', 'united kingdom']
  targetSeniority?: TargetSeniority;
  skillVocabulary?: string[];
}

export interface ScoringResult {
  score: number;
  breakdown: MatchBreakdown;
}

export function scoreJob(job: NormalizedJob, options: ScoringOptions): ScoringResult {
  const {
    targetRoles,
    negativeKeywords = [],
    acceptedLocations = ['remote'],
    targetSeniority = 'mid',
    skillVocabulary = SKILL_VOCABULARY,
  } = options;

  const titleLower = job.title.toLowerCase();
  const descLower = (job.description ?? '').toLowerCase();
  const locationLower = (job.raw_location ?? '').toLowerCase();

  // ── Negative keyword check (hard stop) ─────────────────────────────────────
  const negativeFound = textContainsAny(titleLower + ' ' + descLower, negativeKeywords);
  if (negativeFound.length > 0) {
    return {
      score: 0,
      breakdown: {
        title_match: { score: 0, weight: WEIGHTS.title_match, matched_keywords: [] },
        skills_overlap: { score: 0, weight: WEIGHTS.skills_overlap, matched_skills: [] },
        seniority: { score: 0, weight: WEIGHTS.seniority, detected_level: null },
        location: { score: 0, weight: WEIGHTS.location, accepted: false },
        recency: { score: 0, weight: WEIGHTS.recency, days_old: daysOld(job.posted_date) },
        negative_keyword_hit: true,
        negative_keywords_found: negativeFound,
        weights_version: WEIGHTS_VERSION,
      },
    };
  }

  // ── Title match ─────────────────────────────────────────────────────────────
  // Domain role tokens strictly covering Cloud, DevOps, AWS, Platform, SRE, Infrastructure, Trainer & Instructor roles
  const DOMAIN_TITLE_TOKENS = [
    'cloud', 'devops', 'dev ops', 'secops', 'devsecops', 'gitops',
    'aws', 'azure', 'gcp', 'platform', 'sre', 'site reliability', 'reliability',
    'infrastructure', 'infra', 'sysadmin', 'systems engineer', 'systems administrator',
    'trainer', 'instructor', 'educator', 'technical trainer', 'technical instructor',
  ];

  const matchedTitleKeywords = textContainsAny(
    titleLower,
    [...targetRoles.map(r => r.toLowerCase()), ...DOMAIN_TITLE_TOKENS]
  );
  const titleScore = matchedTitleKeywords.length > 0 ? 1.0 : 0.0;

  // ── Skills overlap ──────────────────────────────────────────────────────────
  const matchedSkills = textContainsAny(descLower, skillVocabulary);
  // Normalize: 5+ matching skills = full score, linear below that
  const skillsScore = Math.min(matchedSkills.length / 5, 1.0);

  // ── Seniority filter ────────────────────────────────────────────────────────
  const seniorHits = textContainsAny(titleLower + ' ' + descLower, SENIOR_TOKENS);
  const juniorHits = textContainsAny(titleLower + ' ' + descLower, JUNIOR_TOKENS);
  const midHits = textContainsAny(titleLower + ' ' + descLower, MID_TOKENS);

  let detectedLevel: string | null = null;
  if (seniorHits.length > 0) detectedLevel = 'senior';
  else if (juniorHits.length > 0) detectedLevel = 'junior';
  else if (midHits.length > 0) detectedLevel = 'mid';

  let seniorityScore = 0.5; // neutral if level undetected
  if (detectedLevel) {
    if (targetSeniority === 'any') {
      seniorityScore = 1.0;
    } else if (detectedLevel === targetSeniority) {
      seniorityScore = 1.0;
    } else if (
      (targetSeniority === 'mid' && detectedLevel === 'senior') ||
      (targetSeniority === 'senior' && detectedLevel === 'mid')
    ) {
      seniorityScore = 0.5; // adjacent level — partial credit
    } else {
      seniorityScore = 0.1; // wrong level — penalise heavily
    }
  }

  // ── Location/remote filter ───────────────────────────────────────────────────
  const locationAccepted =
    acceptedLocations.length === 0 ||
    acceptedLocations.some(loc => locationLower.includes(loc.toLowerCase())) ||
    locationLower.includes('remote') ||
    locationLower.includes('worldwide') ||
    locationLower.includes('anywhere') ||
    locationLower.includes('global') ||
    locationLower === '';
  const locationScore = locationAccepted ? 1.0 : 0.0;

  // ── Recency decay ────────────────────────────────────────────────────────────
  const recency = recencyScore(job.posted_date);
  const days = daysOld(job.posted_date);

  // ── Blended score ─────────────────────────────────────────────────────────
  let blended =
    titleScore * WEIGHTS.title_match +
    skillsScore * WEIGHTS.skills_overlap +
    seniorityScore * WEIGHTS.seniority +
    locationScore * WEIGHTS.location +
    recency * WEIGHTS.recency;

  // Strict domain filter: if title has no Cloud/DevOps/Trainer/Platform/SRE/AWS keywords, force score to 0
  if (titleScore === 0.0) {
    blended = 0.0;
  }

  const breakdown: MatchBreakdown = {
    title_match: { score: titleScore, weight: WEIGHTS.title_match, matched_keywords: matchedTitleKeywords },
    skills_overlap: { score: skillsScore, weight: WEIGHTS.skills_overlap, matched_skills: matchedSkills },
    seniority: { score: seniorityScore, weight: WEIGHTS.seniority, detected_level: detectedLevel },
    location: { score: locationScore, weight: WEIGHTS.location, accepted: locationAccepted },
    recency: { score: recency, weight: WEIGHTS.recency, days_old: days },
    negative_keyword_hit: false,
    negative_keywords_found: [],
    weights_version: WEIGHTS_VERSION,
  };

  return { score: Math.round(blended * 1000) / 1000, breakdown };
}

/**
 * Derives ScoringOptions from a Settings row.
 * Maps all known settings fields so callers don't need to pass extra options manually.
 * extra overrides take precedence if provided.
 */
export function optionsFromSettings(settings: Settings, extra?: Partial<ScoringOptions>): ScoringOptions {
  return {
    targetRoles: settings.target_roles,
    negativeKeywords: settings.negative_keywords ?? [],
    acceptedLocations: settings.accepted_locations ?? ['remote'],
    targetSeniority: settings.target_seniority ?? 'mid',
    ...extra,
  };
}
