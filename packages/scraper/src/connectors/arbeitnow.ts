import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { parseTitleAndCompany } from './rss.js';
import { toIsoDate, extractLocationFromText } from './utils.js';

/**
 * Arbeitnow connector — https://www.arbeitnow.com/api/job-board-api
 *
 * Arbeitnow is a free job board API (no key required) with good European/remote coverage.
 * query_params supported:
 *   search  — keyword search (e.g. "devops engineer")
 *   remote  — "true" to filter remote-only jobs (we enforce this)
 *   page    — page number (default 1)
 *
 * This connector enforces remote=true and strips non-remote results that slip through.
 */
export class ArbeitnowConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const params = source.query_params as Record<string, string>;
    const search = params['search'] ?? '';
    const page = params['page'] ?? '1';

    const url = new URL('https://www.arbeitnow.com/api/job-board-api');
    if (search) url.searchParams.set('search', search);
    url.searchParams.set('remote', 'true');
    url.searchParams.set('page', page);

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json', 'User-Agent': 'job-me-scraper/1.0' },
    });

    if (!res.ok) throw new Error(`Arbeitnow API failed: ${res.status} ${res.statusText}`);

    const data = await res.json() as { data?: unknown[] };
    const items = Array.isArray(data.data) ? data.data : [];

    return items
      .filter((item): item is Record<string, unknown> => {
        if (typeof item !== 'object' || item === null) return false;
        const i = item as Record<string, unknown>;
        // Enforce remote:true — Arbeitnow sometimes returns non-remote with search
        return i['remote'] === true;
      })
      .map(item => this.normalize(item));
  }

  private normalize(item: Record<string, unknown>): NormalizedJob {
    const rawTitle = String(item['title'] ?? '');
    const rawCompany = String(item['company_name'] ?? '');
    const { title, company } = parseTitleAndCompany(rawTitle, rawCompany || null);

    const description = String(item['description'] ?? '');
    const rawLoc = String(item['location'] ?? '');
    const raw_location = rawLoc || extractLocationFromText(description) || 'Remote';

    const rawDate = item['created_at'] ?? null;

    return {
      title: title || 'Untitled Job',
      company,
      url: String(item['url'] ?? ''),
      posted_date: rawDate ? toIsoDate(String(rawDate)) : null,
      description,
      raw_location,
      raw_tags: Array.isArray(item['tags']) ? item['tags'].map(String) : [],
    };
  }
}
