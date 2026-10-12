import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { buildUrl } from './utils.js';

type GreenhouseJob = {
  id?: number;
  title?: string;
  absolute_url?: string;
  location?: { name?: string };
  updated_at?: string;
  metadata?: unknown[];
  departments?: Array<{ name?: string }>;
};

/**
 * Greenhouse public job board API connector.
 *
 * Endpoint format: https://boards-api.greenhouse.io/v1/boards/{company}/jobs
 * Returns JSON: { jobs: [{ title, absolute_url, location, updated_at, ... }] }
 *
 * The `absolute_url` field already points directly to the Greenhouse application
 * page (boards.greenhouse.io or job-boards.greenhouse.io), so the auto-apply
 * Greenhouse connector can handle these jobs without any URL resolution.
 *
 * Usage in sources table:
 *   type: 'greenhouse'
 *   base_url: 'https://boards-api.greenhouse.io/v1/boards/{company-slug}/jobs'
 *   query_params: {} (or {"content": "true"} to include full description)
 */
export class GreenhouseApiConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const url = buildUrl(source.base_url, source.query_params as Record<string, string>);

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Greenhouse API request failed: ${res.status} ${res.statusText} — ${url}`);
    }

    const data = (await res.json()) as { jobs?: GreenhouseJob[]; meta?: unknown };
    const jobs: GreenhouseJob[] = data.jobs ?? [];

    return jobs
      .filter(j => j.absolute_url && j.title)
      .map((j): NormalizedJob => ({
        title: (j.title ?? '').trim() || 'Untitled Job',
        company: extractCompanyFromUrl(source.base_url),
        url: j.absolute_url!,
        posted_date: j.updated_at ? j.updated_at.split('T')[0]! : null,
        description: null, // Full description requires ?content=true — costly, skip for now
        raw_location: j.location?.name ?? 'Remote',
        raw_tags: j.departments?.map(d => d.name ?? '').filter(Boolean) ?? [],
      }));
  }
}

/** Extracts company name from the Greenhouse board URL slug. */
function extractCompanyFromUrl(baseUrl: string): string | null {
  const match = baseUrl.match(/\/boards\/([^/]+)\/jobs/i);
  if (!match) return null;
  // Convert slug to title case (e.g. "pagerduty" → "PagerDuty")
  const slug = match[1]!;
  // Known overrides for proper capitalisation
  const OVERRIDES: Record<string, string> = {
    cloudflare: 'Cloudflare',
    datadog: 'Datadog',
    mongodb: 'MongoDB',
    twilio: 'Twilio',
    pagerduty: 'PagerDuty',
    stripe: 'Stripe',
    elastic: 'Elastic',
    okta: 'Okta',
    confluent: 'Confluent',
    snyk: 'Snyk',
    launchdarkly: 'LaunchDarkly',
    newrelic: 'New Relic',
    sumologicjobs: 'Sumo Logic',
  };
  return OVERRIDES[slug.toLowerCase()] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}
