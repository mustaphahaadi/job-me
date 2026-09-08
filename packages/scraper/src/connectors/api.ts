import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { parseTitleAndCompany } from './rss.js';
import { buildUrl, toIsoDate, extractLocationFromText } from './utils.js';

/**
 * Generic REST API connector skeleton.
 * Fetches from base_url with query_params as URL search params.
 * Supports standard REST endpoints including RemoteOK, Adzuna, Reed, etc.
 */
export class ApiConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const url = buildUrl(source.base_url, source.query_params as Record<string, string>);

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'job-me-scraper/1.0' },
    });

    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${res.statusText} — ${url}`);
    }

    return this.parse(await res.json() as unknown);
  }

  /**
   * Default implementation: expects an array of job objects at the top level
   * or in a `results`/`jobs`/`data` property.
   */
  protected parse(data: unknown): NormalizedJob[] {
    let items: unknown[] = [];

    if (Array.isArray(data)) {
      items = data;
    } else if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (Array.isArray(obj['results'])) items = obj['results'] as unknown[];
      else if (Array.isArray(obj['jobs'])) items = obj['jobs'] as unknown[];
      else if (Array.isArray(obj['data'])) items = obj['data'] as unknown[];
    }

    return items.map(item => this.normalizeItem(item as Record<string, unknown>));
  }

  protected normalizeItem(item: Record<string, unknown>): NormalizedJob {
    const rawTitle = String(
      item['jobTitle'] ?? item['position'] ?? item['title'] ?? item['job_title'] ?? item['role'] ?? item['name'] ?? ''
    );

    const rawCompany = typeof item['company'] === 'object' && item['company'] !== null
      ? String((item['company'] as Record<string, unknown>)['display_name'] ?? (item['company'] as Record<string, unknown>)['name'] ?? '')
      : String(item['companyName'] ?? item['company'] ?? item['company_name'] ?? item['employer'] ?? '');

    const { title, company } = parseTitleAndCompany(rawTitle, rawCompany || null);

    const rawUrl = String(item['url'] ?? item['redirect_url'] ?? item['apply_url'] ?? item['link'] ?? '');
    const fullUrl = rawUrl.startsWith('/') ? `https://remoteok.com${rawUrl}` : rawUrl;

    // Jobicy uses epoch in 'epoch', RemoteOK uses 'epoch' too; Arbeitnow uses 'created_at' (unix); Remotive uses 'publication_date'
    const rawDate = item['pubDate'] ?? item['publication_date'] ?? item['date'] ?? item['created'] ?? item['created_at'] ?? item['epoch'] ?? null;

    const description = String(
      item['jobDescription'] ?? item['description'] ?? item['summary'] ?? item['details'] ?? item['jobExcerpt'] ?? ''
    );

    // Jobicy uses 'jobGeo', Remotive uses 'candidate_required_location', Arbeitnow uses 'location', RemoteOK uses 'location'
    const rawLoc = String(
      item['jobGeo'] ??
      item['candidate_required_location'] ??
      (
        typeof item['location'] === 'object' && item['location'] !== null
          ? (item['location'] as Record<string, unknown>)['display_name'] ?? ''
          : item['location'] ?? item['region'] ?? ''
      ) ?? ''
    );

    const raw_location = rawLoc || extractLocationFromText(description) || '';

    return {
      title: title || 'Untitled Job',
      company,
      url: fullUrl,
      posted_date: rawDate ? toIsoDate(String(rawDate)) : null,
      description,
      raw_location,
      raw_tags: Array.isArray(item['tags']) ? item['tags'].map(String) : [],
    };
  }
}
