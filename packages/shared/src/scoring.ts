import type { MatchBreakdown, NormalizedJob, Settings } from './types.js';
import { DEFAULT_SKILL_VOCABULARY } from './types.js';

// ─── Thresholds ─────────────────────────────────────────────────────────────

/**
 * Jobs scoring at or above this value are promoted from `new` to `matched`.
 * The auto-apply threshold (settings.auto_apply_score_threshold, default 0.75)
 * is separate — jobs between 0.40 and the auto-apply threshold sit in the
 * "matched but not auto-apply eligible" bucket for manual review.
 * Shared between scraper and frontend so the dashboard's "Clean up" action and
 * the pipeline promotion logic can never drift apart.
 */
export const MATCH_PROMOTION_THRESHOLD = 0.40;

// ─── Seniority tokens ───────────────────────────────────────────────────────

const SENIOR_TOKENS = ['senior', 'sr.', 'sr', 'lead', 'principal', 'staff', '5+ years', '7+ years', '10+ years'];
const JUNIOR_TOKENS = ['junior', 'jr.', 'jr', 'entry', 'intern', 'internship', 'graduate', '0-2 years', '1+ year'];
const MID_TOKENS    = ['mid', 'mid-level', 'intermediate', '2+ years', '3+ years', '3-5 years'];

type TargetSeniority = 'junior' | 'mid' | 'senior' | 'any';

// ─── Location vocabularies ──────────────────────────────────────────────────

/** Words that identify a Ghana location in free text. */
const GHANA_KEYWORDS = ['ghana', 'accra', 'kumasi', 'tema', 'takoradi', 'sekondi', 'cape coast', 'tamale'];

/** Words that identify a remote location in free text. */
const REMOTE_KEYWORDS = ['remote', 'worldwide', 'anywhere', 'global', 'emea', 'fully remote', '100% remote', 'work from home', 'wfh'];

/**
 * Settings-list words that make a Ghana location acceptable.
 * Checked with `includes` so an accepted entry of "ghana" or "accra" both work.
 */
const GHANA_SETTINGS_KEYS = GHANA_KEYWORDS;

/** Settings-list words that make a remote location acceptable. */
const REMOTE_SETTINGS_KEYS = ['remote', 'worldwide', 'anywhere', 'global', 'emea'];

// ─── Weights ────────────────────────────────────────────────────────────────

const WEIGHTS = {
  title_match:    0.40,
  skills_overlap: 0.30,
  seniority:      0.15,
  location:       0.10,
  recency:        0.05,
} as const;

const WEIGHTS_VERSION = '2.0';

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word token match on lowercased text.
 *
 * `includes()` is too loose for this use case: skill "java" matched
 * "javascript", seniority "mid" matched "middle", role word "go" matched
 * "algorithms". Non-alphanumeric boundaries fix all three.
 */
function hasWholeWord(text: string, token: string): boolean {
  const t = token.toLowerCase().trim();
  if (!t) return false;
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(t)}([^a-z0-9]|$)`);
  return re.test(text);
}

/** Returns every token that appears in `text` as a whole word. */
function textContainsAny(text: string, tokens: string[]): string[] {
  return tokens.filter(t => hasWholeWord(text, t));
}

/**
 * Fuzzy title score — word-level overlap between job title and target role phrases.
 *
 * Strategy:
 *   1. For each target role, split into words and count how many appear in the job title.
 *   2. Best overlap ratio across all roles becomes the raw score.
 *   3. A full exact match → 1.0. One matching word out of two → 0.5. Zero → 0.0.
 *   4. Role initialisms also count: title "SRE" fully matches role
 *      "Site Reliability Engineer" (initialism length >= 3 only, to avoid
 *      two-letter coincidences).
 *
 * The title signal comes ONLY from the user's configured target roles —
 * generic words like "manager"/"engineer" no longer grant a high score on
 * their own (that was letting irrelevant jobs cross the auto-apply threshold).
 */
function titleMatchScore(jobTitle: string, targetRoles: string[]): { score: number; matched: string[] } {
  // No configured target roles — neutral score so jobs are not force-closed.
  if (targetRoles.length === 0) return { score: 0.5, matched: [] };

  const titleLower = jobTitle.toLowerCase();
  let bestScore = 0;
  const allMatched: string[] = [];

  for (const role of targetRoles) {
    const roleWords = role.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (roleWords.length === 0) continue;

    const matchedWords = roleWords.filter(w => hasWholeWord(titleLower, w));
    let ratio = matchedWords.length / roleWords.length;
    if (matchedWords.length > 0) allMatched.push(...matchedWords);

    // Initialism match, e.g. "sre" for "site reliability engineer"
    const initialism = roleWords.map(w => w[0]!).join('');
    if (initialism.length >= 3 && hasWholeWord(titleLower, initialism)) {
      ratio = 1.0;
      allMatched.push(initialism);
    }

    if (ratio > bestScore) bestScore = ratio;
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

// ─── Main scoring function ──────────────────────────────────────────────────

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

  // ── Negative keyword check (hard stop, whole-word) ──────────────────────
  const negativeFound = textContainsAny(`${titleLower} ${descLower}`, negativeKeywords);
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

  // ── Title match (fuzzy word-level, target roles only) ───────────────────
  const { score: titleScore, matched: matchedTitleKeywords } = titleMatchScore(job.title, targetRoles);

  // ── Skills overlap (whole-word) ─────────────────────────────────────────
  const matchedSkills = textContainsAny(`${titleLower} ${descLower}`, skillVocabulary);
  // 3+ matching skills = full score (was 5 — too strict for short descriptions)
  const skillsScore = Math.min(matchedSkills.length / 3, 1.0);

  // ── Seniority (whole-word tokens) ──────────────────────────────────────
  const seniorHits = textContainsAny(`${titleLower} ${descLower}`, SENIOR_TOKENS);
  const juniorHits = textContainsAny(`${titleLower} ${descLower}`, JUNIOR_TOKENS);
  const midHits    = textContainsAny(`${titleLower} ${descLower}`, MID_TOKENS);

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

  // ── Location (driven by settings.accepted_locations) ───────────────────
  const fullTextLower = `${titleLower} ${descLower} ${locationLower}`;
  const isGhana  = GHANA_KEYWORDS.some(k => fullTextLower.includes(k));
  const isRemote = REMOTE_KEYWORDS.some(k => hasWholeWord(fullTextLower, k));

  // Empty list = accept all locations (matches the Settings page copy).
  const acceptAll = acceptedLocations.length === 0;

  // Which families does the user's accepted list allow?
  const ghanaAccepted = acceptAll || acceptedLocations.some(loc => {
    const l = loc.toLowerCase().trim();
    return l !== '' && GHANA_SETTINGS_KEYS.some(k => l.includes(k));
  });
  const remoteAccepted = acceptAll || acceptedLocations.some(loc => {
    const l = loc.toLowerCase().trim();
    return l !== '' && REMOTE_SETTINGS_KEYS.some(k => l.includes(k));
  });
  // Direct string match against non-family entries, e.g. "nigeria" in "Lagos, Nigeria"
  const explicitAccepted = acceptedLocations.some(loc => {
    const l = loc.toLowerCase().trim();
    if (l === '' || REMOTE_SETTINGS_KEYS.some(k => l.includes(k)) || GHANA_SETTINGS_KEYS.some(k => l.includes(k))) return false;
    return locationLower.includes(l);
  });

  let locationAccepted = false;
  let locationScore = 0.0;

  if (isGhana && ghanaAccepted) {
    // Top priority: Ghana jobs (both on-site and remote) get full 1.0 score
    locationAccepted = true;
    locationScore = 1.0;
  } else if (isRemote && remoteAccepted) {
    // Remote jobs for Africa/worldwide get 0.95
    locationAccepted = true;
    locationScore = 0.95;
  } else if (locationLower.trim() === '') {
    // Unspecified location — neutral score (0.5), accepted
    locationAccepted = true;
    locationScore = 0.5;
  } else if (explicitAccepted) {
    locationAccepted = true;
    locationScore = 0.8;
  } else if (acceptAll) {
    locationAccepted = true;
    locationScore = 0.8;
  } else {
    // On-site outside the accepted list — rejected (remote/Ghana-only by default)
    locationAccepted = false;
    locationScore = 0.0;
  }

  // ── Recency ───────────────────────────────────────────────────────────
  const recency = recencyScore(job.posted_date);
  const days    = daysOld(job.posted_date);

  // ── Blended score ─────────────────────────────────────────────────────
  let blended =
    titleScore     * WEIGHTS.title_match    +
    skillsScore    * WEIGHTS.skills_overlap +
    seniorityScore * WEIGHTS.seniority      +
    locationScore  * WEIGHTS.location       +
    recency        * WEIGHTS.recency;

  // Reject job if location is not accepted (e.g. foreign on-site jobs)
  if (!locationAccepted) {
    blended = 0;
  }

  // A job whose title matches NO target role is not a viable candidate at all —
  // force to 0 so irrelevant postings can never reach the auto-apply threshold.
  if (titleScore === 0) {
    blended = 0;
  }

  const breakdown: MatchBreakdown = {
    title_match:    { score: titleScore,     weight: WEIGHTS.title_match,    matched_keywords: matchedTitleKeywords },
    skills_overlap: { score: skillsScore,    weight: WEIGHTS.skills_overlap, matched_skills: matchedSkills },
    seniority:      { score: seniorityScore, weight: WEIGHTS.seniority,      detected_level: detectedLevel },
    location:       { score: locationScore,  weight: WEIGHTS.location,       accepted: locationAccepted },
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
