import { chromium } from 'playwright';
import type { Job, CvVersion } from '@job-me/shared';
import type { AutoApplyConnector } from './base.js';
import { detectCaptcha, captchaError } from './base.js';
import { GreenhouseConnector } from './greenhouse.js';
import { LeverConnector } from './lever.js';
import { WorkdayConnector } from './workday.js';

// ─── ATS URL detectors ────────────────────────────────────────────────────────
const ATS_PATTERNS: Array<{ pattern: RegExp; connector: AutoApplyConnector }> = [
  { pattern: /(greenhouse\.io|boards\.greenhouse\.io|job-boards\.greenhouse\.io|bamboohr\.com|breezy\.hr|workable\.com)/i, connector: new GreenhouseConnector() },
  { pattern: /(lever\.co|jobs\.lever\.co|ashbyhq\.com|jobs\.ashbyhq\.com|smartrecruiters\.com)/i, connector: new LeverConnector() },
  { pattern: /(myworkdayjobs\.com|workday\.com|wd\d+\.myworkday\.com)/i, connector: new WorkdayConnector() },
];

function findAtsConnector(url: string): AutoApplyConnector | null {
  for (const { pattern, connector } of ATS_PATTERNS) {
    if (pattern.test(url)) return connector;
  }
  return null;
}

/**
 * Selectors for the "Apply" / "Apply for this job" external link on each job board.
 * Order matters — more specific selectors first.
 */
const APPLY_LINK_SELECTORS = [
  // WeWorkRemotely
  'a[href][class*="job-action-apply"]',
  'a.wfj-apply-link',
  'a[data-testid*="apply"]',
  // Remotive
  'a.apply-link',
  'a[href*="apply"]',
  // RemoteOK
  'a.button.action-apply',
  '.job_apply > a',
  // Jobicy / generic
  'a[rel="noopener"][target="_blank"][href*="apply"]',
  // Generic fallbacks
  'a:has-text("Apply for this Job")',
  'a:has-text("Apply Now")',
  'a:has-text("Apply for this position")',
  'a:has-text("Apply to this job")',
];

/**
 * Job-board resolver connector.
 *
 * For job-board listing URLs (WeWorkRemotely, Remotive, RemoteOK, Jobicy, etc.)
 * this connector:
 *   1. Navigates to the listing page in a headless browser
 *   2. Extracts the real company / ATS "Apply" URL
 *   3. If the ATS URL matches Greenhouse/Lever/Workday → delegates to that connector
 *   4. Otherwise → fills basic info on whatever simple apply form appears
 *
 * Throws on CAPTCHA or when no apply link can be found.
 */
export class JobBoardResolverConnector implements AutoApplyConnector {
  async apply(job: Job, cv: CvVersion | null, coverLetter: string | null | undefined, cvFilePath: string): Promise<void> {
    const FIRST_NAME = process.env['APPLICANT_FIRST_NAME'] || 'Applicant';
    const LAST_NAME  = process.env['APPLICANT_LAST_NAME']  || 'User';
    const EMAIL      = process.env['APPLICANT_EMAIL']      || 'applicant@example.com';
    const PHONE      = process.env['APPLICANT_PHONE']      || '';

    if (!cvFilePath) {
      throw new Error('No CV file — upload a CV on the /cv page or set CV_FILE_PATH in env.');
    }

    const isHeadless = process.env['PLAYWRIGHT_HEADLESS'] !== 'false';
    const browser = await chromium.launch({ headless: isHeadless });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      // ── Step 1: Load the job board listing page ─────────────────────────────
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2000);

      // ── Step 2: Extract the real apply URL ─────────────────────────────────
      let applyUrl: string | null = null;

      for (const sel of APPLY_LINK_SELECTORS) {
        try {
          const el = await page.$(sel);
          if (el) {
            const href = await el.getAttribute('href');
            if (href && href.startsWith('http') && !href.includes(new URL(job.url).hostname)) {
              applyUrl = href;
              break;
            }
          }
        } catch {
          // selector not found — try next
        }
      }

      // Fallback: collect all external links and pick the most "apply-looking" one
      if (!applyUrl) {
        const links = await page.$$eval('a[href]', (anchors) =>
          anchors.map(a => ({ href: (a as HTMLAnchorElement).href, text: a.textContent?.trim() ?? '' }))
        );
        const jobHostname = new URL(job.url).hostname;
        const candidate = links.find(l => {
          try {
            const u = new URL(l.href);
            return u.hostname !== jobHostname &&
              /apply|application|job|career|position/i.test(l.href + l.text);
          } catch { return false; }
        });
        if (candidate) applyUrl = candidate.href;
      }

      if (!applyUrl) {
        throw new Error(`No external apply link found on ${job.url} — may require login or manual apply.`);
      }

      console.log(`[auto-apply] Resolved apply URL: ${applyUrl.slice(0, 80)}`);

      // ── Step 3: Hand off to ATS connector if we recognise the ATS ──────────
      const atsConnector = findAtsConnector(applyUrl);
      if (atsConnector) {
        // Temporarily override the job URL so the ATS connector navigates to the right page
        const jobWithAtsUrl = { ...job, url: applyUrl };
        await atsConnector.apply(jobWithAtsUrl as Job, cv, coverLetter, cvFilePath);
        return;
      }

      // ── Step 4: Generic apply — navigate to the apply URL and fill what we can
      await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2000);

      const captcha = await detectCaptcha(page);
      if (captcha) throw captchaError(captcha);

      // Fill common fields that appear across many simple ATS/career page forms
      const tryFill = async (selector: string, value: string) => {
        const el = await page.$(selector);
        if (el) { await el.fill(value); }
      };

      await tryFill('input[name="first_name"], input[id*="first"][type="text"], input[placeholder*="First" i]', FIRST_NAME);
      await tryFill('input[name="last_name"], input[id*="last"][type="text"], input[placeholder*="Last" i]', LAST_NAME);
      await tryFill('input[name="email"], input[type="email"]', EMAIL);
      if (PHONE) await tryFill('input[name="phone"], input[type="tel"]', PHONE);

      // CV upload
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(cvFilePath);
        await page.waitForTimeout(2000);
      }

      // Cover letter
      if (coverLetter) {
        const clField = await page.$('textarea[name*="cover" i], textarea[id*="cover" i], textarea[placeholder*="cover" i]');
        if (clField) await clField.fill(coverLetter);
      }

      // Final CAPTCHA check before submit
      const captcha2 = await detectCaptcha(page);
      if (captcha2) throw captchaError(captcha2);

      const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (!submitBtn) {
        throw new Error(`Apply page loaded at ${applyUrl} but no submit button found — may need manual completion.`);
      }
      await submitBtn.click();

      // Wait for any confirmation
      await Promise.any([
        page.waitForSelector('text=Thank you', { timeout: 10_000 }),
        page.waitForSelector('text=submitted', { timeout: 10_000 }),
        page.waitForSelector('text=received', { timeout: 10_000 }),
        page.waitForURL(url => url.href !== applyUrl, { timeout: 10_000 }),
      ]).catch(() => {
        // No confirmation — that's okay for generic forms, we still count it
        console.warn(`[auto-apply] No confirmation page detected for ${applyUrl?.slice(0, 60)} — submission may still have succeeded.`);
      });

    } finally {
      await browser.close();
    }
  }
}
