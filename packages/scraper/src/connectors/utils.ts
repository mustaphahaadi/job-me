import type { Source } from '@job-me/shared';

export function buildUrl(base: string, params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return base;
  const qs = new URLSearchParams(entries).toString();
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
}

/** The /settings fields that drive scrape queries. */
export interface ScrapeSettings {
  target_roles?: string[];
  accepted_locations?: string[];
  days_posted_default?: number;
}

/**
 * Applies the /settings configuration to a source before scraping.
 *
 * Any `{placeholder}` in base_url or in a string query_param is
 * substituted from settings:
 *   {roles}     all target roles, space-joined
 *   {role}      first target role
 *   {locations} all accepted locations, space-joined
 *   {location}  first accepted location
 *   {days}      days_posted_default
 *
 * This makes every source type follow the Settings page — including
 * generic web pages, where the search terms live in the URL itself
 * (e.g. base_url "https://example.com/jobs?q={role}&l={location}").
 * Sources without placeholders keep their configured values verbatim.
 */
export function applySettingsToSource(source: Source, settings: ScrapeSettings): Source {
  const roles = settings.target_roles ?? [];
  const locations = settings.accepted_locations ?? [];
  const values: Record<string, string> = {
    roles: roles.join(' '),
    role: roles[0] ?? 'Software Engineer',
    locations: locations.join(' '),
    location: locations[0] ?? '',
    days: String(settings.days_posted_default ?? 14),
  };

  const substitute = (text: string): string =>
    text.replace(/\{(roles?|locations?|days)\}/gi, (match, key: string) =>
      values[key.toLowerCase()] ?? match);

  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source.query_params ?? {})) {
    params[key] = typeof value === 'string' ? substitute(value) : value;
  }

  return { ...source, base_url: substitute(source.base_url), query_params: params };
}

export function toIsoDate(raw: string): string | null {
  // Handle Unix epoch integers (e.g. Arbeitnow created_at: 1788865797)
  const asNum = Number(raw);
  if (!isNaN(asNum) && asNum > 1_000_000_000 && asNum < 9_999_999_999) {
    return new Date(asNum * 1000).toISOString().slice(0, 10);
  }

  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Decodes the HTML entities commonly found in ATS API payloads. */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const value = Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => {
      const value = parseInt(code, 16);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
    });
}

/** Converts an HTML job description into plain text for scoring and AI prompts. */
export function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

/** Whole-word match on lowercased text — avoids `tema` matching `Temasek`. */
function containsWholeWord(text: string, token: string): boolean {
  const t = token.toLowerCase().trim();
  if (!t) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text);
}

/** Strip newlines from external strings before logging (CWE-117). */
export function sanitizeLog(v: unknown): string {
  return String(v).replace(/[\r\n\t]/g, ' ').slice(0, 300);
}

/**
 * Extracts a location string from free-text (title or description).
 * Checks for common patterns: "(Remote)", "London, UK", "Worldwide", etc.
 */
export function extractLocationFromText(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Explicit remote/worldwide signals. "global" is intentionally excluded:
  // in a title it usually means a global team ("Global Infrastructure
  // Engineer"), not a remote work arrangement.
  if (/\b(remote|worldwide|anywhere|fully remote|100% remote|work from home|wfh)\b/.test(lower)) {
    return 'Remote';
  }

  // Parenthesised location: "(London)", "(UK)", "(United States)"
  const parenMatch = text.match(/\(([A-Za-z][A-Za-z ,]{2,40})\)/);
  if (parenMatch) return parenMatch[1]!.trim();

  // "Location: X" or "Based in X"
  const labelMatch = text.match(/(?:location|based in|located in)[:\s]+([A-Za-z][A-Za-z ,]{2,40})/i);
  if (labelMatch) return labelMatch[1]!.trim();

  return null;
}

/**
 * Fast pre-filter for ATS and broad board APIs (Greenhouse, Ashby, Lever).
 * Ensures only jobs matching the user's configured profile (target roles,
 * technical keywords, and location rules) are stored in the database,
 * preventing boards with 400+ jobs from flooding the dashboard.
 */
export function isJobRelevantToProfile(
  title: string,
  rawLocation: string | null | undefined,
  settings?: import('@job-me/shared').Settings,
  description?: string | null
): boolean {
  const titleLower = title.toLowerCase().trim();
  const locLower = (rawLocation ?? '').toLowerCase().trim();
  const descLower = (description ?? '').toLowerCase().trim();

  // 1. Role / Technical Domain Filter
  const targetRoles = (settings?.target_roles ?? []).map(r => r.toLowerCase().trim());
  const defaultDomainKeywords = [
    'cloud', 'devops', 'sre', 'site reliability', 'platform',
    'infrastructure', 'infra', 'systems', 'aws', 'linux', 'kubernetes',
    'k8s', 'terraform', 'reliability', 'trainer', 'instructor',
    'solutions architect', 'software engineer, infrastructure', 'software engineer, platform',
    'backend', 'systems engineer'
  ];

  // Generic role words are not evidence of a domain match on their own:
  // "Sales Engineer" should not pass because it contains "engineer".
  const GENERIC_ROLE_WORDS = new Set([
    'engineer', 'developer', 'specialist', 'manager', 'lead', 'senior',
    'junior', 'staff', 'principal', 'architect', 'consultant', 'analyst',
  ]);

  const hasRoleMatch = targetRoles.some(role => {
    const words = role.split(/\s+/).filter(Boolean);
    if (words.length === 0) return false;
    return words.some(w => !GENERIC_ROLE_WORDS.has(w) && containsWholeWord(titleLower, w));
  }) || defaultDomainKeywords.some(kw => containsWholeWord(titleLower, kw));

  if (!hasRoleMatch) return false;

  // Hard exclusions: sales, marketing, hr, legal, recruiter, finance, etc.
  const EXCLUDED_TITLE_TOKENS = [
    'account executive', 'sales', 'marketing', 'recruiter', 'recruiting',
    'talent acquisition', 'legal', 'counsel', 'finance', 'payroll', 'accounting',
    'office manager', 'customer success', 'customer support', 'business development',
    'graphic designer', 'copywriter', 'content creator', 'internship', 'intern',
    'paralegal', 'administrative', 'workforce management', 'workplace operations'
  ];
  if (EXCLUDED_TITLE_TOKENS.some(token => containsWholeWord(titleLower, token))) {
    return false;
  }

  // Title-only negative-keyword check is a cheap pre-filter. The match step
  // performs the full title + description check and closes the job there.
  if (settings?.negative_keywords && settings.negative_keywords.length > 0) {
    if (settings.negative_keywords.some(neg => containsWholeWord(titleLower, neg))) {
      return false;
    }
  }

  // 2. Strict Location Policy:
  // - Ghana: on-site & remote allowed
  // - Outside Ghana: strictly remote
  const isGhana = ['ghana', 'accra', 'kumasi', 'tema', 'takoradi', 'cape coast', 'tamale'].some(k =>
    containsWholeWord(locLower, k) || containsWholeWord(titleLower, k)
  );

  if (isGhana) return true;

  // Outside Ghana: reject if the location explicitly says hybrid or in-office.
  // Do not check the title: "Hybrid Cloud Engineer" is a technical role, not a
  // hybrid work arrangement.
  const ONSITE_HYBRID = ['hybrid', 'in-office', 'in office', 'on-site', 'onsite', 'office-based', 'office based'];
  if (ONSITE_HYBRID.some(k => containsWholeWord(locLower, k))) {
    return false;
  }

  // Outside Ghana: remote can be stated in the title, location, or description.
  // Previously the description was ignored, which silently dropped jobs whose
  // location was a city but whose body said "fully remote".
  const REMOTE_LOCATION_TOKENS = [
    'remote', 'worldwide', 'anywhere', 'work from home', 'wfh',
    'global', 'telecommute', 'home based', 'distributed', 'virtual', 'emea',
    'apac', 'americas', 'remote-first', 'remote first', 'work from anywhere',
  ];
  const REMOTE_TITLE_TOKENS = [
    'remote', 'worldwide', 'anywhere', 'work from home', 'wfh',
    'telecommute', 'remote-first', 'remote first', 'work from anywhere',
  ];
  const REMOTE_DESCRIPTION_PHRASES = [
    '100% remote', 'fully remote', 'remote position', 'remote role',
    'remote job', 'remote opportunity', 'remote work', 'work remotely',
    'work from home', 'work from anywhere', 'remote-first', 'remote first',
    'all-remote', 'all remote', 'remote eligible',
  ];

  if (
    REMOTE_LOCATION_TOKENS.some(k => containsWholeWord(locLower, k)) ||
    REMOTE_TITLE_TOKENS.some(k => containsWholeWord(titleLower, k))
  ) {
    return true;
  }
  const DESCRIPTION_REMOTE_NEGATIONS = [
    'not remote', 'no remote', 'non-remote', 'not a remote',
    'remote work is not', 'remote is not', 'not fully remote',
    'not 100% remote', 'not eligible for remote',
  ];
  const descriptionSaysNotRemote = DESCRIPTION_REMOTE_NEGATIONS.some(phrase => descLower.includes(phrase));
  if (!descriptionSaysNotRemote && descLower && REMOTE_DESCRIPTION_PHRASES.some(phrase => descLower.includes(phrase))) {
    return true;
  }

  // Unknown location (empty) is not evidence of an on-site role — keep it and
  // let the scoring step decide instead of dropping it at the connector.
  return locLower === '';
}

