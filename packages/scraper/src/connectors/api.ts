import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';

/**
 * Generic REST API connector skeleton.
 * Fetches from base_url with query_params as URL search params.
 * The response shape is source-specific — override the `parse` method per site.
 *
 * Example source config:
 *   base_url: "https://api.adzuna.com/v1/api/jobs/gb/search/1"
 *   query_params: { app_id: "...", app_key: "...", what: "DevOps Engineer", content-type: "application/json" }
 */
export class ApiConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const params = source.query_params as Record<string, string>;
    const url = buildUrl(source.base_url, params);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'User-Agent': 'job-me-scraper/1.0',
    };

    const res = await fetch(url, { headers });

    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${res.statusText} — ${url}`);
    }

    const data = await res.json() as unknown;
    return this.parse(data);
  }

  /**
   * Override this method in site-specific connectors.
   * Default implementation: expects an array of job objects at the top level
   * or in a `results`/`jobs` property.
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
    return {
      title: String(item['title'] ?? item['job_title'] ?? ''),
      company: typeof item['company'] === 'object'
        ? String((item['company'] as Record<string, unknown>)['display_name'] ?? '')
        : String(item['company'] ?? item['employer'] ?? ''),
      url: String(item['redirect_url'] ?? item['url'] ?? item['apply_url'] ?? ''),
      posted_date: item['created'] ? toIsoDate(String(item['created'])) : null,
      description: String(item['description'] ?? item['summary'] ?? ''),
      raw_location: typeof item['location'] === 'object'
        ? String((item['location'] as Record<string, unknown>)['display_name'] ?? '')
        : String(item['location'] ?? ''),
      raw_tags: [],
    };
  }
}

function buildUrl(base: string, params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return base;
  const qs = new URLSearchParams(entries).toString();
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
}

function toIsoDate(raw: string): string {
  try { return new Date(raw).toISOString().slice(0, 10); }
  catch { return raw.slice(0, 10); }
}
