import { chromium } from 'playwright';
import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { toIsoDate, extractLocationFromText } from './utils.js';

/**
 * LinkedIn connector — Playwright-based scraper.
 *
 * LinkedIn removed public RSS feeds in 2023. This connector uses headless
 * Chromium to scrape the public job search results page (no login required
 * for the first ~25 results per search).
 *
 * query_params supported:
 *   keywords    — job title / keyword search (e.g. "devops engineer")
 *   location    — location string (e.g. "Worldwide", "United Kingdom")
 *   f_WT        — work type: 2 = Remote (default)
 *   f_TPR       — time posted: r86400=24h, r604800=7d (default), r2592000=30d
 *   start       — pagination offset (default 0)
 */
export class LinkedInConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const params = source.query_params as Record<string, string>;

    const url = new URL('https://www.linkedin.com/jobs/search/');
    if (params['keywords']) url.searchParams.set('keywords', params['keywords']);
    if (params['location']) url.searchParams.set('location', params['location']);
    url.searchParams.set('f_WT', params['f_WT'] ?? '2');
    url.searchParams.set('f_TPR', params['f_TPR'] ?? 'r604800');
    url.searchParams.set('start', params['start'] ?? '0');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    const page = await context.newPage();

    try {
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Wait for job cards to render
      await page.waitForSelector('.job-search-card, .base-card', { timeout: 15_000 }).catch(() => null);

      const jobs = await page.evaluate((): Array<{
        title: string;
        company: string | null;
        url: string;
        location: string | null;
        postedDate: string | null;
      }> => {
        const cards = Array.from(document.querySelectorAll(
          '.job-search-card, .base-card, [data-entity-urn]'
        ));

        return cards.map(card => {
          const titleEl = card.querySelector('.base-search-card__title, h3.base-card__full-link, .job-search-card__title');
          const companyEl = card.querySelector('.base-search-card__subtitle, .job-search-card__company-name');
          const linkEl = card.querySelector('a.base-card__full-link, a[href*="/jobs/view/"]') as HTMLAnchorElement | null;
          const locationEl = card.querySelector('.job-search-card__location, .base-search-card__metadata');
          const timeEl = card.querySelector('time');

          return {
            title: titleEl?.textContent?.trim() ?? '',
            company: companyEl?.textContent?.trim() ?? null,
            url: linkEl?.href ?? '',
            location: locationEl?.textContent?.trim() ?? null,
            postedDate: timeEl?.getAttribute('datetime') ?? null,
          };
        }).filter(j => j.title && j.url);
      });

      // Location policy is deliberately NOT enforced here. The connector-level
      // filter duplicated scoring with its own hardcoded Ghana/remote lists and
      // ignored settings.accepted_locations. Jobs are stored as-is; the match
      // step closes non-matching locations per user settings.
      return jobs.map(j => {
        const rawLoc = j.location ?? extractLocationFromText(j.title) ?? null;
        return {
          title: j.title,
          company: j.company,
          url: j.url.split('?')[0] ?? j.url, // strip tracking params
          posted_date: j.postedDate ? toIsoDate(j.postedDate) : null,
          description: null, // description requires clicking into each job — too slow for bulk scrape
          raw_location: rawLoc,
          raw_tags: [],
        };
      }).filter(j => Boolean(j.url));

    } finally {
      await browser.close();
    }
  }
}
