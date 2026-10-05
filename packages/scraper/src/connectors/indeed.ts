import { chromium } from 'playwright';
import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { toIsoDate, extractLocationFromText } from './utils.js';

/**
 * Indeed connector — Playwright-based scraper.
 *
 * Indeed blocks basic direct fetch requests with Cloudflare 403 Forbidden.
 * This connector uses Playwright headless Chromium to load Indeed search results,
 * parse job cards, titles, companies, locations, and application URLs.
 *
 * query_params supported:
 *   q       — job title / keyword search (e.g. "devops engineer")
 *   l       — location (e.g. "Remote", "Ghana", "Lagos")
 *   sort    — "date" or "relevance"
 *   fromage — max days old (e.g. "7")
 */
export class IndeedConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const params = source.query_params as Record<string, string>;
    const url = new URL('https://www.indeed.com/jobs');

    if (params['q']) url.searchParams.set('q', params['q']);
    url.searchParams.set('l', params['l'] ?? 'Remote');
    url.searchParams.set('sort', params['sort'] ?? 'date');
    if (params['fromage']) url.searchParams.set('fromage', params['fromage']);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    const page = await context.newPage();

    try {
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 35_000 });
      await page.waitForSelector('.jobsearch-ResultsList, .job_seen_beacon, [data-jk]', { timeout: 15_000 }).catch(() => null);

      const jobs = await page.evaluate((): Array<{
        title: string;
        company: string | null;
        url: string;
        location: string | null;
      }> => {
        const cards = Array.from(document.querySelectorAll('.job_seen_beacon, [data-jk], .result'));

        return cards.map(card => {
          const titleEl = card.querySelector('h2.jobTitle span, a[data-jk], .jobTitle');
          const companyEl = card.querySelector('[data-testid="company-name"], .companyName');
          const linkEl = card.querySelector('a[data-jk], a[id^="job_"]') as HTMLAnchorElement | null;
          const locEl = card.querySelector('[data-testid="text-location"], .companyLocation');

          const jk = card.getAttribute('data-jk') || linkEl?.getAttribute('data-jk');
          const fullUrl = jk ? `https://www.indeed.com/viewjob?jk=${jk}` : (linkEl?.href ?? '');

          return {
            title: titleEl?.textContent?.trim() ?? '',
            company: companyEl?.textContent?.trim() ?? null,
            url: fullUrl,
            location: locEl?.textContent?.trim() ?? null,
          };
        }).filter(j => j.title && j.url);
      });

      return jobs.map(j => ({
        title: j.title,
        company: j.company,
        url: j.url.split('&')[0] ?? j.url,
        posted_date: toIsoDate(new Date().toISOString()),
        description: null,
        raw_location: j.location ?? extractLocationFromText(j.title) ?? params['l'] ?? null,
        raw_tags: [],
      })).filter(j => j.url);

    } finally {
      await browser.close();
    }
  }
}
