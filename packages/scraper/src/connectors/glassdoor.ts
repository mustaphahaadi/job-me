import { chromium } from 'playwright';
import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { toIsoDate, extractLocationFromText } from './utils.js';

/**
 * Glassdoor connector — Playwright-based scraper.
 *
 * Glassdoor enforces strict Cloudflare challenges for direct fetch.
 * This connector uses Playwright headless Chromium to load search page results,
 * extract job items, titles, companies, locations, and links.
 *
 * query_params supported:
 *   keyword — search term (e.g. "devops engineer", "cloud engineer")
 *   location — location (e.g. "Remote", "Ghana", "Lagos")
 */
export class GlassdoorConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const params = source.query_params as Record<string, string>;
    const keyword = params['keyword'] ?? 'devops engineer';
    const searchUrl = `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeURIComponent(keyword)}&fromAge=14`;

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    const page = await context.newPage();

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35_000 });
      await page.waitForSelector('[class*="jobCard"], [data-test="jobTile"], .react-job-listing', { timeout: 15_000 }).catch(() => null);

      const jobs = await page.evaluate((): Array<{
        title: string;
        company: string | null;
        url: string;
        location: string | null;
      }> => {
        const cards = Array.from(document.querySelectorAll('[class*="jobCard"], [data-test="jobTile"], .react-job-listing, li[data-id]'));

        return cards.map(card => {
          const titleEl = card.querySelector('[class*="jobTitle"], [id^="job-title"], a.job-title');
          const companyEl = card.querySelector('[class*="employerName"], [class*="EmployerName"]');
          const linkEl = card.querySelector('a[href*="/partner/jobListing"], a[href*="/job-listing"]') as HTMLAnchorElement | null;
          const locEl = card.querySelector('[class*="location"], [data-test="emp-location"]');

          return {
            title: titleEl?.textContent?.trim() ?? '',
            company: companyEl?.textContent?.trim() ?? null,
            url: linkEl?.href ?? '',
            location: locEl?.textContent?.trim() ?? null,
          };
        }).filter(j => j.title && j.url);
      });

      return jobs.map(j => ({
        title: j.title,
        company: j.company,
        url: j.url.split('?')[0] ?? j.url,
        posted_date: toIsoDate(new Date().toISOString()),
        description: null,
        raw_location: j.location ?? extractLocationFromText(j.title) ?? params['location'] ?? null,
        raw_tags: [],
      })).filter(j => j.url);

    } finally {
      await browser.close();
    }
  }
}
