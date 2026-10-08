import { chromium } from 'playwright';
import type { Source, NormalizedJob } from '@job-me/shared';
import type { Connector } from './base.js';
import { toIsoDate, extractLocationFromText } from './utils.js';

/**
 * Generic Web Page Connector — Playwright-based scraper.
 *
 * Scrapes any public web page or job board URL by loading the page in headless
 * Chromium, rendering client-side JavaScript, and using heuristic selector matching
 * to discover job cards, titles, company names, and application URLs.
 *
 * query_params supported (optional):
 *   card_selector    — custom CSS selector for job item containers (e.g. ".job-item", "li.job")
 *   title_selector   — custom selector for job title
 *   company_selector — custom selector for company name
 *   link_selector    — custom selector for job URL
 */
export class GenericWebConnector implements Connector {
  async fetch(source: Source): Promise<NormalizedJob[]> {
    const params = source.query_params as Record<string, string>;
    const targetUrl = source.base_url;

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    const page = await context.newPage();

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35_000 });
      await page.waitForTimeout(3000); // Allow dynamic JavaScript to render job lists

      // Auto-scroll down to trigger lazy-loaded cards on SPA job boards like Work at a Startup
      await page.evaluate(() => window.scrollBy(0, 800));
      await page.waitForTimeout(1500);

      const cardSelector = params['card_selector'] ||
        'a[href*="/job"], a[href*="/jobs/"], a[href*="/companies/"], a[href*="/company/"], a[href*="/careers/"], .job-card, .job-item, article, tr, li';

      const rawJobs = await page.evaluate(({ cardSel, customTitleSel, customCompanySel, customLinkSel }) => {
        const elements = Array.from(document.querySelectorAll(cardSel));
        const results: Array<{
          title: string;
          company: string | null;
          url: string;
          location: string | null;
          snippet: string | null;
        }> = [];

        for (const el of elements) {
          // If the element itself is a link to a job, use it
          let linkEl: HTMLAnchorElement | null = null;
          if (el.tagName === 'A' && (el as HTMLAnchorElement).href) {
            linkEl = el as HTMLAnchorElement;
          } else {
            linkEl = el.querySelector(customLinkSel || 'a[href*="/job"], a[href*="/jobs/"], a[href*="/companies/"], a[href*="/careers/"], a[href*="/view/"], a') as HTMLAnchorElement | null;
          }

          if (!linkEl || !linkEl.href) continue;
          const href = linkEl.href;

          // Extract title
          let title = '';
          if (customTitleSel) {
            title = el.querySelector(customTitleSel)?.textContent?.trim() || '';
          }
          if (!title) {
            const hEl = el.querySelector('h1, h2, h3, h4, .title, [class*="title" i], [class*="name" i]');
            title = hEl?.textContent?.trim() || linkEl.textContent?.trim() || '';
          }

          // Filter out short non-job link texts & SEO category headers (e.g. "Frontend Developer Jobs in San Francisco")
          if (
            !title ||
            title.length < 4 ||
            /^(apply|view|click|more|home|jobs|login|sign up|about|privacy|terms)$/i.test(title) ||
            /jobs in /i.test(title) ||
            /^(browse|find|all|top|popular|latest) /i.test(title)
          ) {
            continue;
          }

          // Extract company
          let company: string | null = null;
          if (customCompanySel) {
            company = el.querySelector(customCompanySel)?.textContent?.trim() || null;
          }
          if (!company) {
            const companyEl = el.querySelector('.company, [class*="company" i], [class*="employer" i], .subtitle');
            company = companyEl?.textContent?.trim() || null;
          }

          // Extract location
          const locEl = el.querySelector('.location, [class*="location" i], [class*="city" i], [class*="region" i]');
          const location = locEl?.textContent?.trim() || null;

          const snippet = el.textContent?.slice(0, 300) ?? null;

          results.push({ title, company, url: href, location, snippet });
        }

        return results;
      }, {
        cardSel: cardSelector,
        customTitleSel: params['title_selector'],
        customCompanySel: params['company_selector'],
        customLinkSel: params['link_selector'],
      });

      // Deduplicate by URL
      const seen = new Set<string>();
      return rawJobs
        .filter(j => {
          if (!j.url || seen.has(j.url)) return false;
          seen.add(j.url);
          return true;
        })
        .map(j => ({
          title: j.title.replace(/\s+/g, ' ').trim(),
          company: j.company ? j.company.replace(/\s+/g, ' ').trim() : null,
          url: j.url.split('?')[0] ?? j.url,
          posted_date: toIsoDate(new Date().toISOString()),
          description: j.snippet,
          raw_location: j.location ?? extractLocationFromText(j.title) ?? extractLocationFromText(j.snippet ?? '') ?? null,
          raw_tags: [],
        }));

    } finally {
      await browser.close();
    }
  }
}
