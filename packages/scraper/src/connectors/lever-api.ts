import type { Source, NormalizedJob, Settings } from '@job-me/shared';
import type { Connector } from './base.js';
import { buildUrl, isJobRelevantToProfile } from './utils.js';

type LeverPosting = {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  categories?: {
    location?: string;
    team?: string;
    department?: string;
  };
  workplaceType?: string;
  createdAt?: number;
};

/**
 * Lever public postings API connector.
 * Endpoint format: https://api.lever.co/v0/postings/{company}?mode=json
 *
 * Automatically filters by user profile settings to prevent flooding the database.
 */
export class LeverApiConnector implements Connector {
  async fetch(source: Source, settings?: Settings): Promise<NormalizedJob[]> {
    const url = buildUrl(source.base_url, source.query_params as Record<string, string>);

    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Lever API request failed: ${res.status} ${res.statusText} — ${url}`);
    }

    const postings = (await res.json()) as LeverPosting[];
    const companyName = extractCompanyFromLeverUrl(source.base_url);

    return postings
      .filter(p => {
        const title = p.text ?? '';
        const urlToUse = p.applyUrl ?? p.hostedUrl;
        if (!urlToUse || !title) return false;
        const loc = p.workplaceType === 'remote'
          ? `Remote - ${p.categories?.location ?? ''}`
          : (p.categories?.location ?? '');
        return isJobRelevantToProfile(title, loc, settings);
      })
      .map((p): NormalizedJob => ({
        title: (p.text ?? '').trim() || 'Untitled Job',
        company: companyName,
        url: p.applyUrl ?? p.hostedUrl!,
        posted_date: p.createdAt ? new Date(p.createdAt).toISOString().split('T')[0]! : null,
        description: null,
        raw_location: p.workplaceType === 'remote' ? 'Remote' : (p.categories?.location ?? 'Remote'),
        raw_tags: [p.categories?.team, p.categories?.department].filter(Boolean) as string[],
      }));
  }
}

function extractCompanyFromLeverUrl(baseUrl: string): string {
  const match = baseUrl.match(/\/postings\/([^/?#]+)/i);
  if (!match) return 'Company';
  const slug = match[1]!;
  const OVERRIDES: Record<string, string> = {
    spotify: 'Spotify',
    postman: 'Postman',
    automattic: 'Automattic',
  };
  return OVERRIDES[slug.toLowerCase()] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}
