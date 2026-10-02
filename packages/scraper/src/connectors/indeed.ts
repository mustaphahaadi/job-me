import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { toIsoDate, extractLocationFromText } from './utils.js';
import { parseTitleAndCompany } from './rss.js';
import Parser from 'rss-parser';

/**
 * Indeed connector.
 *
 * Indeed exposes a public RSS feed at:
 *   https://www.indeed.com/rss?q=devops+engineer&l=Remote&sort=date
 *
 * query_params supported:
 *   q     — job title / keyword search (e.g. "devops engineer")
 *   l     — location (e.g. "Remote", "London", "United Kingdom")
 *   sort  — "date" (newest first) or "relevance"
 *   fromage — max days old (e.g. "7" for last 7 days)
 *   radius  — search radius in miles
 *
 * No API key required for RSS access.
 */

type RssItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  content?: string;
  'indeed:company'?: string;
  'indeed:city'?: string;
  'indeed:state'?: string;
  'indeed:country'?: string;
  'indeed:jobtype'?: string;
  [key: string]: unknown;
};

const parser = new Parser<Record<string, unknown>, RssItem>({
  customFields: {
    item: [
      'indeed:company',
      'indeed:city',
      'indeed:state',
      'indeed:country',
      'indeed:jobtype',
    ],
  },
});

export class IndeedConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const params = source.query_params as Record<string, string>;
    const url = new URL('https://www.indeed.com/rss');

    if (params['q']) url.searchParams.set('q', params['q']);
    url.searchParams.set('l', params['l'] ?? 'Remote');
    url.searchParams.set('sort', params['sort'] ?? 'date');
    if (params['fromage']) url.searchParams.set('fromage', params['fromage']);
    if (params['radius']) url.searchParams.set('radius', params['radius']);

    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'Mozilla/5.0 (compatible; job-me-scraper/1.0)',
      },
    });

    if (!res.ok) throw new Error(`Indeed fetch failed: ${res.status} ${res.statusText}`);

    const xml = await res.text();
    const feed = await parser.parseString(xml);

    return (feed.items ?? []).map((item): NormalizedJob => {
      // Indeed RSS titles are typically "Job Title - Company Name - Location"
      const rawCompany = typeof item['indeed:company'] === 'string' ? item['indeed:company'] : null;
      const { title, company } = parseTitleAndCompany(item.title, rawCompany);

      // Build location from Indeed-specific fields
      const city = typeof item['indeed:city'] === 'string' ? item['indeed:city'] : '';
      const state = typeof item['indeed:state'] === 'string' ? item['indeed:state'] : '';
      const country = typeof item['indeed:country'] === 'string' ? item['indeed:country'] : '';
      const rawLocation =
        [city, state, country].filter(Boolean).join(', ') ||
        extractLocationFromText(item.title ?? '') ||
        extractLocationFromText(item.contentSnippet ?? '') ||
        params['l'] ||
        null;

      return {
        title: title || 'Untitled Job',
        company,
        url: item.link?.trim() ?? '',
        posted_date: item.isoDate ? toIsoDate(item.isoDate) : item.pubDate ? toIsoDate(item.pubDate) : null,
        description: item.contentSnippet ?? item.content ?? null,
        raw_location: rawLocation,
        raw_tags: [],
      };
    }).filter(j => j.url);
  }
}
