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

export function toIsoDate(raw: string): string {
  // Handle Unix epoch integers (e.g. Arbeitnow created_at: 1788865797)
  const asNum = Number(raw);
  if (!isNaN(asNum) && asNum > 1_000_000_000 && asNum < 9_999_999_999) {
    return new Date(asNum * 1000).toISOString().slice(0, 10);
  }
  try { return new Date(raw).toISOString().slice(0, 10); }
  catch { return raw.slice(0, 10); }
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

  // Explicit remote/worldwide signals
  if (/\b(remote|worldwide|anywhere|fully remote|100% remote|work from home|wfh|global)\b/.test(lower)) {
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
  settings?: import('@job-me/shared').Settings
): boolean {
  const titleLower = title.toLowerCase().trim();
  const locLower = (rawLocation ?? '').toLowerCase().trim();

  // 1. Role / Technical Domain Filter
  const targetRoles = (settings?.target_roles ?? []).map(r => r.toLowerCase().trim());
  const defaultDomainKeywords = [
    'cloud', 'devops', 'sre', 'site reliability', 'platform',
    'infrastructure', 'infra', 'systems', 'aws', 'linux', 'kubernetes',
    'k8s', 'terraform', 'reliability', 'trainer', 'instructor',
    'solutions architect', 'software engineer, infrastructure', 'software engineer, platform',
    'backend', 'systems engineer'
  ];

  const hasRoleMatch = targetRoles.some(role => {
    const words = role.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return words.some(w => titleLower.includes(w) && w.length > 3);
    }
    return titleLower.includes(role);
  }) || defaultDomainKeywords.some(kw => titleLower.includes(kw));

  if (!hasRoleMatch) return false;

  // Hard exclusions: sales, marketing, hr, legal, recruiter, finance, etc.
  const EXCLUDED_TITLE_TOKENS = [
    'account executive', 'sales', 'marketing', 'recruiter', 'recruiting',
    'talent acquisition', 'legal', 'counsel', 'finance', 'payroll', 'accounting',
    'office manager', 'customer success', 'customer support', 'business development',
    'graphic designer', 'copywriter', 'content creator', 'internship', 'intern',
    'paralegal', 'administrative', 'workforce management', 'workplace operations'
  ];
  if (EXCLUDED_TITLE_TOKENS.some(token => titleLower.includes(token))) {
    return false;
  }

  // Check negative keywords from settings
  if (settings?.negative_keywords && settings.negative_keywords.length > 0) {
    if (settings.negative_keywords.some(neg => titleLower.includes(neg.toLowerCase().trim()))) {
      return false;
    }
  }

  // 2. Strict Location Policy:
  // - Ghana: on-site & remote allowed
  // - Outside Ghana: strictly remote!
  const isGhana = ['ghana', 'accra', 'kumasi', 'tema'].some(k =>
    locLower.includes(k) || titleLower.includes(k)
  );

  if (isGhana) return true;

  // Outside Ghana: reject if explicitly hybrid or in-office
  const ONSITE_HYBRID = ['hybrid', 'in-office', 'in office', 'on-site', 'onsite', 'office-based'];
  if (ONSITE_HYBRID.some(k => locLower.includes(k) || titleLower.includes(k))) {
    return false;
  }

  // Outside Ghana: MUST be remote / worldwide / anywhere / work from home
  const REMOTE_TOKENS = [
    'remote', 'worldwide', 'anywhere', 'work from home', 'wfh',
    'global', 'telecommute', 'home based', 'distributed', 'virtual', 'emea'
  ];
  return REMOTE_TOKENS.some(k => locLower.includes(k) || titleLower.includes(k));
}

