import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { toIsoDate } from './utils.js';

/**
 * Jobicy connector — https://jobicy.com/api/v2/remote-jobs
 *
 * Free remote jobs API, no key required.
 * query_params supported:
 *   count    — number of results (max 50, default 20)
 *   tag      — job tag/skill (e.g. "devops", "aws", "terraform", "kubernetes", "sre", "infrastructure")
 *   industry — industry filter (e.g. "engineering")
 *
 * Schema fields: jobTitle, companyName, jobGeo, jobLevel, jobDescription, pubDate, url, tags
 */
export class JobicyConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const params = source.query_params as Record<string, string>;
    const url = new URL('https://jobicy.com/api/v2/remote-jobs');

    url.searchParams.set('count', params['count'] ?? '50');
    if (params['tag']) url.searchParams.set('tag', params['tag']);
    if (params['industry']) url.searchParams.set('industry', params['industry']);
    // geo=anywhere restricts to jobs open worldwide — critical for African applicants
    url.searchParams.set('geo', params['geo'] ?? 'anywhere');

    const res = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; job-me-scraper/1.0)' },
    });

    if (!res.ok) throw new Error(`Jobicy API failed: ${res.status} ${res.statusText}`);

    const data = await res.json() as { jobs?: unknown[] };
    const items = Array.isArray(data.jobs) ? data.jobs : [];

    return items
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map(item => ({
        title: String(item['jobTitle'] ?? '').trim() || 'Untitled Job',
        company: String(item['companyName'] ?? '').trim() || null,
        url: String(item['url'] ?? ''),
        posted_date: item['pubDate'] ? toIsoDate(String(item['pubDate'])) : null,
        description: String(item['jobDescription'] ?? item['jobExcerpt'] ?? ''),
        raw_location: String(item['jobGeo'] ?? '').trim() || 'Remote',
        raw_tags: Array.isArray(item['tags']) ? item['tags'].map(String) : [],
      }))
      .filter(j => j.url);
  }
}
