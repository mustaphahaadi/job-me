import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { toIsoDate, extractLocationFromText } from './utils.js';
import { parseTitleAndCompany } from './rss.js';
import Parser from 'rss-parser';

/**
 * Glassdoor connector.
 *
 * Glassdoor exposes public job RSS feeds at:
 *   https://www.glassdoor.com/Job/jobs.htm?sc.keyword=...&locT=C&locId=...&jobType=all&fromAge=7&minSalary=0&includeNoSalaryJobs=true&radius=100&cityId=-1&minRating=0.0&industryId=-1&sgocId=-1&seniorityType=all&applicationType=0&remoteWorkType=1&rss=1
 *
 * query_params supported:
 *   keyword     — job title / keyword search (e.g. "devops engineer")
 *   fromAge     — max days old (e.g. "7")
 *   remoteWorkType — 1 = remote only
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
  [key: string]: unknown;
};

const parser = new Parser<Record<string, unknown>, RssItem>();

export class GlassdoorConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const params = source.query_params as Record<string, string>;
    const url = new URL('https://www.glassdoor.com/Job/jobs.htm');

    url.searchParams.set('sc.keyword', params['keyword'] ?? '');
    url.searchParams.set('fromAge', params['fromAge'] ?? '7');
    url.searchParams.set('remoteWorkType', params['remoteWorkType'] ?? '1');
    url.searchParams.set('jobType', 'all');
    url.searchParams.set('minSalary', '0');
    url.searchParams.set('includeNoSalaryJobs', 'true');
    url.searchParams.set('radius', '100');
    url.searchParams.set('cityId', '-1');
    url.searchParams.set('minRating', '0.0');
    url.searchParams.set('industryId', '-1');
    url.searchParams.set('applicationType', '0');
    url.searchParams.set('rss', '1');

    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/rss+xml, application/xml, text/xml',
        'User-Agent': 'Mozilla/5.0 (compatible; job-me-scraper/1.0)',
      },
    });

    if (!res.ok) throw new Error(`Glassdoor fetch failed: ${res.status} ${res.statusText}`);

    const xml = await res.text();
    const feed = await parser.parseString(xml);

    return (feed.items ?? []).map((item): NormalizedJob => {
      const { title, company } = parseTitleAndCompany(item.title, null);
      const description = item.contentSnippet ?? item.content ?? null;
      const rawLocation =
        extractLocationFromText(item.title ?? '') ??
        extractLocationFromText(description ?? '') ??
        (params['remoteWorkType'] === '1' ? 'Remote' : null);

      return {
        title: title || 'Untitled Job',
        company,
        url: item.link?.trim() ?? '',
        posted_date: item.isoDate ? toIsoDate(item.isoDate) : item.pubDate ? toIsoDate(item.pubDate) : null,
        description,
        raw_location: rawLocation,
        raw_tags: [],
      };
    }).filter(j => j.url);
  }
}
