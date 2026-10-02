import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { toIsoDate, extractLocationFromText } from './utils.js';

/**
 * Otta connector (otta.com — now part of Workable).
 *
 * Otta exposes a public jobs API at:
 *   https://api.otta.com/jobs
 *
 * query_params supported:
 *   function_slug  — job function (e.g. "engineering", "devops", "data")
 *   remote         — "true" to filter remote-only
 *   limit          — number of results (default 50)
 *
 * No API key required for public access.
 */

interface OttaJob {
  id?: string;
  title?: string;
  slug?: string;
  company?: { name?: string; url_token?: string };
  locations?: Array<{ name?: string }>;
  remote?: boolean;
  functions?: Array<{ name?: string }>;
  skills?: Array<{ name?: string }>;
  created_at?: string;
  posted_at?: string;
  short_description?: string;
  description?: string;
  url?: string;
}

export class OttaConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const params = source.query_params as Record<string, string>;
    const url = new URL('https://api.otta.com/jobs');

    if (params['function_slug']) url.searchParams.set('function_slug', params['function_slug']);
    url.searchParams.set('remote', params['remote'] ?? 'true');
    url.searchParams.set('limit', params['limit'] ?? '50');

    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; job-me-scraper/1.0)',
      },
    });

    if (!res.ok) throw new Error(`Otta API failed: ${res.status} ${res.statusText}`);

    const data = await res.json() as { jobs?: OttaJob[] } | OttaJob[];
    const items: OttaJob[] = Array.isArray(data)
      ? data
      : (Array.isArray((data as { jobs?: OttaJob[] }).jobs) ? (data as { jobs: OttaJob[] }).jobs : []);

    return items
      .filter(item => item.title)
      .map((item): NormalizedJob => {
        const company = item.company?.name ?? null;
        const companySlug = item.company?.url_token ?? '';
        const jobSlug = item.slug ?? item.id ?? '';
        const jobUrl = item.url ?? (companySlug && jobSlug
          ? `https://app.otta.com/jobs/${companySlug}/${jobSlug}`
          : '');

        const locationNames = (item.locations ?? []).map(l => l.name).filter(Boolean).join(', ');
        const rawLocation = locationNames ||
          (item.remote ? 'Remote' : null) ||
          extractLocationFromText(item.short_description ?? '') ||
          null;

        const skills = (item.skills ?? []).map(s => s.name).filter(Boolean) as string[];
        const description = item.description ?? item.short_description ?? null;

        const rawDate = item.posted_at ?? item.created_at ?? null;

        return {
          title: item.title ?? 'Untitled Job',
          company,
          url: jobUrl,
          posted_date: rawDate ? toIsoDate(rawDate) : null,
          description,
          raw_location: rawLocation,
          raw_tags: skills,
        };
      })
      .filter(j => j.url);
  }
}
