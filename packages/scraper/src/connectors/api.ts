import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { parseTitleAndCompany } from './rss.js';

/**
 * Generic REST API connector skeleton.
 * Fetches from base_url with query_params as URL search params.
 * Supports standard REST endpoints including RemoteOK, Adzuna, Reed, etc.
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
      item['position'] ??
      item['title'] ??
      item['job_title'] ??
      item['role'] ??
      item['name'] ??
      ''
    );

    const rawCompany = typeof item['company'] === 'object' && item['company'] !== null
      ? String((item['company'] as Record<string, unknown>)['display_name'] ?? (item['company'] as Record<string, unknown>)['name'] ?? '')
      : String(item['company'] ?? item['company_name'] ?? item['employer'] ?? '');

    const { title, company } = parseTitleAndCompany(rawTitle, rawCompany || null);

    const rawUrl = String(item['url'] ?? item['redirect_url'] ?? item['apply_url'] ?? item['link'] ?? '');
    const fullUrl = rawUrl.startsWith('/') ? `https://remoteok.com${rawUrl}` : rawUrl;

    const rawDate = item['date'] ?? item['created'] ?? item['created_at'] ?? item['epoch'] ?? null;

    return {
      title: title || 'Untitled Job',
      company,
      url: fullUrl,
      posted_date: rawDate ? toIsoDate(String(rawDate)) : null,
      description: String(item['description'] ?? item['summary'] ?? item['details'] ?? ''),
      raw_location: typeof item['location'] === 'object' && item['location'] !== null
        ? String((item['location'] as Record<string, unknown>)['display_name'] ?? '')
        : String(item['location'] ?? item['region'] ?? ''),
      raw_tags: Array.isArray(item['tags']) ? item['tags'].map(String) : [],
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
