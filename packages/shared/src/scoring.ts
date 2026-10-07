import type { MatchBreakdown, NormalizedJob, Settings } from './types.js';
import { DEFAULT_SKILL_VOCABULARY } from './types.js';

// ─── Seniority tokens ─────────────────────────────────────────────────────────

const SENIOR_TOKENS = ['senior', 'sr.', 'sr ', 'lead', 'principal', 'staff', '5+ years', '7+ years', '10+ years'];
const JUNIOR_TOKENS = ['junior', 'jr.', 'jr ', 'entry', 'intern', 'graduate', '0-2 years', '1+ year'];
const MID_TOKENS    = ['mid', 'mid-level', 'intermediate', '2+ years', '3+ years', '3-5 years'];

type TargetSeniority = 'junior' | 'mid' | 'senior' | 'any';

// ─── Weights ──────────────────────────────────────────────────────────────────

const WEIGHTS = {
  title_match:    0.40,
  skills_overlap: 0.30,
  seniority:      0.15,
  location:       0.10,
  recency:        0.05,
} as const;

const WEIGHTS_VERSION = '1.1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function textContainsAny(text: string, tokens: string[]): string[] {
  const lower = text.toLowerCase();
  return tokens.filter(t => lower.includes(t.toLowerCase()));
}

/**
 * Fuzzy title score — word-level overlap between job title and target role phrases.
 *
 * Strategy:
 *   1. For each target role, split into words and count how many appear in the job title.
 *   2. Best overlap ratio across all roles becomes the raw score.
 *   3. A full exact match → 1.0. One matching word out of two → 0.5. Zero → 0.0.
 *
 * This means "Senior Cloud Infrastructure Engineer" still scores well against
 * "Cloud Engineer" (2/2 words match → 1.0) and "DevOps" (1/1 → 1.0).
 */
function titleMatchScore(jobTitle: string, targetRoles: string[]): { score: number; matched: string[] } {
  const titleLower = jobTitle.toLowerCase();
  let bestScore = 0;
  const allMatched: string[] = [];

  for (const role of targetRoles) {
    const roleWords = role.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (roleWords.length === 0) continue;
    const matchedWords = roleWords.filter(w => titleLower.includes(w));
    const ratio = matchedWords.length / roleWords.length;
    if (ratio > bestScore) bestScore = ratio;
    if (matchedWords.length > 0) allMatched.push(...matchedWords);
  }

  // Also check single-word aliases that are strong signals regardless of target_roles
  const STRONG_ALIASES = [
    'engineer', 'developer', 'architect', 'analyst', 'designer',
    'manager', 'lead', 'principal', 'staff', 'consultant',
  ];
  for (const alias of STRONG_ALIASES) {
    if (titleLower.includes(alias)) {
      bestScore = Math.max(bestScore, 0.8);
      allMatched.push(alias);
    }
  }

  return { score: Math.min(bestScore, 1.0), matched: [...new Set(allMatched)] };
}

function recencyScore(postedDate: string | null): number {
  if (!postedDate) return 0.5;
  const ageDays = (Date.now() - new Date(postedDate).getTime()) / 86_400_000;
  return Math.exp(-ageDays / 14);
}

function daysOld(postedDate: string | null): number {
  if (!postedDate) return -1;
  return Math.floor((Date.now() - new Date(postedDate).getTime()) / 86_400_000);
}

// ─── Main scoring function ────────────────────────────────────────────────────

export interface ScoringOptions {
  targetRoles: string[];
  negativeKeywords?: string[];
  acceptedLocations?: string[];
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
    skillVocabulary = DEFAULT_SKILL_VOCABULARY,
  } = options;

  const titleLower    = job.title.toLowerCase();
  const descLower     = (job.description ?? '').toLowerCase();
  const locationLower = (job.raw_location ?? '').toLowerCase();

  // ── Negative keyword check (hard stop) ────────────────────────────────────
  const negativeFound = textContainsAny(titleLower + ' ' + descLower, negativeKeywords);
  if (negativeFound.length > 0) {
    return {
      score: 0,
      breakdown: {
        title_match:    { score: 0, weight: WEIGHTS.title_match,    matched_keywords: [] },
        skills_overlap: { score: 0, weight: WEIGHTS.skills_overlap, matched_skills: [] },
        seniority:      { score: 0, weight: WEIGHTS.seniority,      detected_level: null },
        location:       { score: 0, weight: WEIGHTS.location,       accepted: false },
        recency:        { score: 0, weight: WEIGHTS.recency,        days_old: daysOld(job.posted_date) },
        negative_keyword_hit: true,
        negative_keywords_found: negativeFound,
        weights_version: WEIGHTS_VERSION,
      },
    };
  }

  // ── Title match (fuzzy word-level) ────────────────────────────────────────
  const { score: titleScore, matched: matchedTitleKeywords } = titleMatchScore(job.title, targetRoles);

  // ── Skills overlap ────────────────────────────────────────────────────────
  // Search both title and description for skill keywords
  const matchedSkills = textContainsAny(titleLower + ' ' + descLower, skillVocabulary);
  // 3+ matching skills = full score (was 5 — too strict for short descriptions)
  const skillsScore = Math.min(matchedSkills.length / 3, 1.0);

  // ── Seniority ─────────────────────────────────────────────────────────────
  const seniorHits = textContainsAny(titleLower + ' ' + descLower, SENIOR_TOKENS);
  const juniorHits = textContainsAny(titleLower + ' ' + descLower, JUNIOR_TOKENS);
  const midHits    = textContainsAny(titleLower + ' ' + descLower, MID_TOKENS);

  let detectedLevel: string | null = null;
  if (seniorHits.length > 0)      detectedLevel = 'senior';
  else if (juniorHits.length > 0) detectedLevel = 'junior';
  else if (midHits.length > 0)    detectedLevel = 'mid';

  let seniorityScore = 0.6; // neutral if level undetected (slightly positive — unspecified roles are often open)
  if (detectedLevel) {
    if (targetSeniority === 'any') {
      seniorityScore = 1.0;
    } else if (detectedLevel === targetSeniority) {
      seniorityScore = 1.0;
    } else if (
      (targetSeniority === 'mid'    && detectedLevel === 'senior') ||
      (targetSeniority === 'senior' && detectedLevel === 'mid')
    ) {
      seniorityScore = 0.5; // adjacent — partial credit
    } else {
      seniorityScore = 0.1; // wrong level
    }
  }

  // ── Location ──────────────────────────────────────────────────────────────
  const REMOTE_KEYWORDS = ['remote', 'worldwide', 'anywhere', 'global', 'emea', 'fully remote', '100% remote', 'work from home', 'wfh'];
  const GHANA_KEYWORDS  = ['ghana', 'accra', 'kumasi', 'tema', 'takoradi', 'sekondi', 'cape coast', 'tamale'];

  const fullTextLower = `${titleLower} ${descLower} ${locationLower}`;
  const isGhana  = GHANA_KEYWORDS.some(k => fullTextLower.includes(k));
  const isRemote = REMOTE_KEYWORDS.some(k => fullTextLower.includes(k));

  let locationAccepted = false;
  let locationScore = 0.0;

  if (isGhana) {
    // Top priority: Ghana jobs (both on-site and remote) get full 1.0 score
    locationAccepted = true;
    locationScore = 1.0;
  } else if (isRemote) {
    // Remote jobs for Africa/worldwide get 0.95
    locationAccepted = true;
    locationScore = 0.95;
  } else if (locationLower.trim() === '') {
    // Unspecified location — neutral score (0.5), accepted
    locationAccepted = true;
    locationScore = 0.5;
  } else {
    // On-site outside Ghana — rejected per requirement (remote only unless Ghana)
    const matchesAccepted = acceptedLocations.some(loc => {
      const l = loc.toLowerCase();
      return l !== 'remote' && l !== 'worldwide' && l !== 'anywhere' && l !== 'global' && locationLower.includes(l);
    });
    if (matchesAccepted) {
      locationAccepted = true;
      locationScore = 0.8;
    } else {
      locationAccepted = false;
      locationScore = 0.0;
    }
  }

  // ── Recency ───────────────────────────────────────────────────────────────
  const recency = recencyScore(job.posted_date);
  const days    = daysOld(job.posted_date);

  // ── Blended score ─────────────────────────────────────────────────────────
  let blended =
    titleScore    * WEIGHTS.title_match    +
    skillsScore   * WEIGHTS.skills_overlap +
    seniorityScore * WEIGHTS.seniority     +
    locationScore  * WEIGHTS.location      +
    recency        * WEIGHTS.recency;

  // Reject job if location is not accepted (e.g. foreign on-site jobs)
  if (!locationAccepted) {
    blended = 0;
  }

  // Only hard-zero if BOTH title AND skills are completely empty
  if (titleScore === 0 && skillsScore === 0) {
    blended = 0;
  }

  const breakdown: MatchBreakdown = {
    title_match:    { score: titleScore,    weight: WEIGHTS.title_match,    matched_keywords: matchedTitleKeywords },
    skills_overlap: { score: skillsScore,   weight: WEIGHTS.skills_overlap, matched_skills: matchedSkills },
    seniority:      { score: seniorityScore, weight: WEIGHTS.seniority,     detected_level: detectedLevel },
    location:       { score: locationScore,  weight: WEIGHTS.location,      accepted: locationAccepted },
    recency:        { score: recency,        weight: WEIGHTS.recency,        days_old: days },
    negative_keyword_hit: false,
    negative_keywords_found: [],
    weights_version: WEIGHTS_VERSION,
  };

  return { score: Math.round(blended * 1000) / 1000, breakdown };
}

export function optionsFromSettings(settings: Settings, extra?: Partial<ScoringOptions>): ScoringOptions {
  return {
    targetRoles:       settings.target_roles,
    negativeKeywords:  settings.negative_keywords ?? [],
    acceptedLocations: settings.accepted_locations ?? ['remote'],
    targetSeniority:   settings.target_seniority ?? 'mid',
    skillVocabulary:   settings.skill_vocabulary ?? DEFAULT_SKILL_VOCABULARY,
    ...extra,
  };
}
