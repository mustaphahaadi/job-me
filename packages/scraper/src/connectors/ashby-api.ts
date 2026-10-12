import type { Source, NormalizedJob, Settings } from '@job-me/shared';
import type { Connector } from './base.js';
import { buildUrl, isJobRelevantToProfile } from './utils.js';

type AshbyJob = {
  id?: string;
  title?: string;
  location?: string;
  isRemote?: boolean;
  workplaceType?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  department?: string;
};

/**
 * Ashby job board API connector.
 * Endpoint format: https://api.ashbyhq.com/posting-api/job-board/{company}
 *
 * Used by modern tech companies (Linear, Replit, Cursor, Ramp, etc.).
 * Returns rich job structures including direct applyUrl and isRemote flags.
 * Filters against user profile settings to avoid flooding the database.
 */
export class AshbyApiConnector implements Connector {
  async fetch(source: Source, settings?: Settings): Promise<NormalizedJob[]> {
    const url = buildUrl(source.base_url, source.query_params as Record<string, string>);

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Ashby API request failed: ${res.status} ${res.statusText} — ${url}`);
    }

    const data = (await res.json()) as { jobs?: AshbyJob[] };
    const jobs: AshbyJob[] = data.jobs ?? [];

    const companyName = extractCompanyFromAshbyUrl(source.base_url);

    return jobs
      .filter(j => {
        const title = j.title ?? '';
        const urlToUse = j.jobUrl ?? j.applyUrl;
        if (!urlToUse || !title) return false;
        const loc = j.isRemote || j.workplaceType === 'Remote' ? `Remote - ${j.location ?? ''}` : (j.location ?? '');
        return isJobRelevantToProfile(title, loc, settings);
      })
      .map((j): NormalizedJob => ({
        title: (j.title ?? '').trim() || 'Untitled Job',
        company: companyName,
        url: j.jobUrl ?? j.applyUrl!,
        posted_date: j.publishedAt ? j.publishedAt.split('T')[0]! : null,
        description: null,
        raw_location: j.isRemote || j.workplaceType === 'Remote' ? 'Remote' : (j.location ?? 'Remote'),
        raw_tags: j.department ? [j.department] : [],
      }));
  }
}

function extractCompanyFromAshbyUrl(baseUrl: string): string {
  const match = baseUrl.match(/\/job-board\/([^/?#]+)/i);
  if (!match) return 'Company';
  const slug = match[1]!;
  const OVERRIDES: Record<string, string> = {
    linear: 'Linear',
    replit: 'Replit',
    cursor: 'Cursor',
    ramp: 'Ramp',
    openai: 'OpenAI',
  };
  return OVERRIDES[slug.toLowerCase()] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}
