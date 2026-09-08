import Parser from 'rss-parser';
import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { buildUrl, toIsoDate, extractLocationFromText } from './utils.js';

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

      const rawCompany = extractCompany(item);
      const { title, company } = parseTitleAndCompany(item.title, rawCompany);

      const description = item.contentSnippet ?? item.content ?? null;
      const rawLocation = extractLocation(item)
        ?? extractLocationFromText(item.title ?? '')
        ?? extractLocationFromText(description ?? '');

      return {
        title: title || 'Untitled Job',
        company,
        url: item.link?.trim() ?? '',
        posted_date: rawDate ? toIsoDate(rawDate) : null,
        description,
        raw_location: rawLocation,
        raw_tags: item.categories ?? [],
      };
    }).filter(j => j.url);
  }
}

export function parseTitleAndCompany(rawTitle: string | undefined, existingCompany: string | null): { title: string; company: string | null } {
  if (!rawTitle || !rawTitle.trim()) {
    return { title: 'Untitled Job', company: existingCompany };
  }

  let title = rawTitle.trim();
  let company = existingCompany;

  // Pattern 1: "Company Name: Job Title" (e.g. "Lemon.io: Senior DevOps Engineer")
  if (title.includes(':')) {
    const parts = title.split(':');
    if (parts.length >= 2 && parts[0]!.trim().length > 0 && parts[1]!.trim().length > 0) {
      if (!company) company = parts[0]!.trim();
      title = parts.slice(1).join(':').trim();
    }
  }
  // Pattern 2: "Job Title at Company Name" or "Job Title @ Company Name"
  else if (/\s+(?:at|@)\s+/i.test(title)) {
    const parts = title.split(/\s+(?:at|@)\s+/i);
    if (parts.length >= 2 && parts[0]!.trim().length > 0 && parts[1]!.trim().length > 0) {
      title = parts[0]!.trim();
      if (!company) company = parts[1]!.trim();
    }
  }
  // Pattern 3: "Job Title - Company Name" or "Company Name - Job Title"
  else if (title.includes(' - ') || title.includes(' — ')) {
    const parts = title.split(/\s+[-—]\s+/);
    if (parts.length === 2 && parts[0]!.trim() && parts[1]!.trim()) {
      const p0 = parts[0]!.trim();
      const p1 = parts[1]!.trim();
      if (!company) {
        if (/engineer|developer|trainer|instructor|architect|admin|lead|specialist|sre|devops|cloud|platform/i.test(p0)) {
          title = p0;
          company = p1;
        } else {
          company = p0;
          title = p1;
        }
      }
    }
  }

  return { title, company };
}

// Some RSS feeds embed company name in specific fields — extend as needed per source
function extractCompany(item: RssItem): string | null {
  const raw = item['dc:publisher'] ?? item['author'] ?? null;
  return typeof raw === 'string' ? raw.trim() : null;
}

function extractLocation(item: RssItem): string | null {
  const raw = item['location'] ?? item['job:location'] ?? item['georss:point'] ?? null;
  return typeof raw === 'string' ? raw.trim() : null;
}
