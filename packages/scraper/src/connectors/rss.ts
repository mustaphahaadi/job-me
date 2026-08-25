import Parser from 'rss-parser';
import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';

type RssItem = {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  content?: string;
  'dc:date'?: string;
  categories?: string[];
  [key: string]: unknown;
};

const parser = new Parser<Record<string, unknown>, RssItem>({
  customFields: {
    item: ['dc:date', 'categories'],
  },
});

/**
 * Generic RSS/Atom connector.
 * Constructs the feed URL by appending query_params to the source's base_url.
 *
 * Example source config:
 *   base_url: "https://www.reed.co.uk/rss/jobs-in-devops"
 *   query_params: {}
 */
export class RssConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const url = buildUrl(source.base_url, source.query_params as Record<string, string>);
    const feed = await parser.parseURL(url);

    return (feed.items ?? []).map((item): NormalizedJob => {
      const rawDate =
        item.isoDate ??
        item.pubDate ??
        (item['dc:date'] as string | undefined) ??
        null;

      return {
        title: item.title?.trim() ?? 'Untitled',
        company: extractCompany(item),
        url: item.link?.trim() ?? '',
        posted_date: rawDate ? toIsoDate(rawDate) : null,
        description: item.contentSnippet ?? item.content ?? null,
        raw_location: extractLocation(item),
        raw_tags: item.categories ?? [],
      };
    }).filter(j => j.url);
  }
}

function buildUrl(base: string, params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return base;
  const qs = new URLSearchParams(entries).toString();
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`;
}

function toIsoDate(raw: string): string {
  try {
    return new Date(raw).toISOString().slice(0, 10);
  } catch {
    return raw.slice(0, 10);
  }
}

// Some RSS feeds embed company name in specific fields — extend as needed per source
function extractCompany(item: RssItem): string | null {
  const raw = item['dc:publisher'] ?? item['author'] ?? null;
  return typeof raw === 'string' ? raw.trim() : null;
}

function extractLocation(item: RssItem): string | null {
  const raw = item['location'] ?? item['geo:lat'] ?? null;
  return typeof raw === 'string' ? raw.trim() : null;
}
