import { chromium } from 'playwright';
import type { Job, CvVersion } from '@job-me/shared';
import type { AutoApplyConnector } from './base.js';
import { detectCaptcha, captchaError, getApplicant, isHeadless } from './base.js';
import { findAtsConnector, getHostname } from './ats.js';

const BLOCKED_DOMAINS = [
  'producthunt.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'github.com',
  'gitlab.com',
  'google.com',
  'apple.com',
  'slack.com',
  'discord.com',
  'discord.gg',
  'medium.com',
  'substack.com',
  'reddit.com',
  'play.google.com',
  'apps.apple.com',
];

const BLOCKED_PATH_PATTERNS = [
  /\/privacy/i,
  /\/legal/i,
  /\/terms/i,
  /\/cookie/i,
  /\/security/i,
  /\/compliance/i,
  /\/notice/i,
  /\/policy/i,
  /\/help\./i,
  /\/support\./i,
  /\/pricing/i,
  /\/blog/i,
  /\/about/i,
  /\/contact/i,
  /\/press/i,
  /\/status/i,
  /\/login/i,
  /\/signin/i,
  /\/signup/i,
  /\/register/i,
  /\/rss/i,
  /\/feed/i,
  /\/api/i,
];

function isValidApplyUrl(urlStr: string, jobHostname: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;

    const host = u.hostname.toLowerCase();
    if (!host) return false;
    const pathAndQuery = (u.pathname + u.search).toLowerCase();

    if (BLOCKED_DOMAINS.some(d => host === d || host.endsWith('.' + d))) {
      return false;
    }
    if (BLOCKED_PATH_PATTERNS.some(p => p.test(pathAndQuery))) {
      return false;
    }
    if (host === jobHostname.toLowerCase()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Selectors for the "Apply" / "Apply for this job" link or button on job boards.
 * More specific selectors first.
 */
const APPLY_SELECTORS = [
  // WeWorkRemotely
  '#job-cta-alt',
  'a[href][class*="job-action-apply"]',
  'a.wfj-apply-link',
  'a[data-testid*="apply"]',
  // Remotive
  'a.apply-link',
  // RemoteOK
  'a.button.action-apply',
  'a[href^="/l/"]',
  '.job_apply > a',
  // Generic high-confidence apply links with text
  'a:has-text("Apply for this Job")',
  'a:has-text("Apply for this position")',
  'a:has-text("Apply Now")',
  'a:has-text("Apply to this job")',
  'button:has-text("Apply for this Job")',
  'button:has-text("Apply Now")',
];

/**
 * Job-board resolver connector.
 *
 * For job-board listing URLs (WeWorkRemotely, Remotive, RemoteOK, Jobicy, etc.)
 * this connector:
 *   1. Navigates to the listing page in a headless browser
 *   2. Extracts the real company / ATS "Apply" URL (checks known ATS links first)
 *   3. If the ATS URL matches Greenhouse/Lever/Workday → delegates to that connector
 *   4. Otherwise → fills basic info on whatever simple apply form appears
 *
 * Throws on CAPTCHA or when no valid company apply link can be found.
 */
export class JobBoardResolverConnector implements AutoApplyConnector {
  async apply(job: Job, cv: CvVersion | null, coverLetter: string | null | undefined, cvFilePath: string): Promise<void> {
    const applicant = getApplicant();

    if (!cvFilePath) {
      throw new Error('No CV file — upload a CV on the /cv page or set CV_FILE_PATH in env.');
    }

    const browser = await chromium.launch({ headless: isHeadless() });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      // ── Step 1: Load the job board listing page ─────────────────────────────
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2000);

      const jobHostname = getHostname(job.url);
      if (!jobHostname) {
        throw new Error(`Invalid job URL: ${job.url}`);
      }
      let applyUrl: string | null = null;

      // Check 1: Scan for a known ATS link whose visible text actually says
      // "apply". A bare ATS link could be a footer/"powered by" link pointing
      // at a different job — submitting through it would apply to the wrong
      // posting.
      const allPageLinks = await page.$$eval('a[href]', anchors =>
        anchors.map(a => ({
          href: (a as HTMLAnchorElement).href,
          text: (a.textContent ?? '').trim().toLowerCase(),
          label: (a.getAttribute('aria-label') ?? '').trim().toLowerCase(),
        }))
      ).catch(() => []);

      const directAtsLink = allPageLinks.find(link =>
        (link.text.includes('apply') || link.text.includes('application') || link.label.includes('apply')) &&
        findAtsConnector(link.href) !== null &&
        isValidApplyUrl(link.href, jobHostname)
      )?.href;
      if (directAtsLink) {
        applyUrl = directAtsLink;
      }

      // Check 2: Try specific apply buttons / links
      if (!applyUrl) {
        for (const sel of APPLY_SELECTORS) {
          try {
            const el = await page.$(sel);
            if (!el) continue;

            const href = await el.getAttribute('href');
            if (href) {
              const fullHref = href.startsWith('http') ? href : new URL(href, job.url).href;
              if (isValidApplyUrl(fullHref, jobHostname)) {
                applyUrl = fullHref;
                break;
              }
            }

            // If relative internal redirect (e.g. /l/123 on RemoteOK) or button, click and see if it navigates or opens popup
            const [popup] = await Promise.all([
              page.waitForEvent('popup', { timeout: 6000 }).catch(() => null),
              el.click().catch(() => null),
            ]);

            if (popup) {
              await popup.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => null);
              const popupUrl = popup.url();
              if (isValidApplyUrl(popupUrl, jobHostname)) {
                applyUrl = popupUrl;
                await popup.close().catch(() => null);
                break;
              }
              await popup.close().catch(() => null);
            } else {
              await page.waitForTimeout(3000);
              const currentUrl = page.url();
              if (currentUrl !== job.url && isValidApplyUrl(currentUrl, jobHostname)) {
                applyUrl = currentUrl;
                break;
              }
            }
          } catch {
            // try next selector
          }
        }
      }

      // Check 3: Text-based fallback search (only links whose TEXT says "apply" or "application")
      if (!applyUrl) {
        const candidateLinks = await page.$$eval('a[href]', anchors =>
          anchors.map(a => ({
            href: (a as HTMLAnchorElement).href,
            text: (a.textContent ?? '').trim().toLowerCase(),
          }))
        ).catch(() => []);

        const candidate = candidateLinks.find(l =>
          (l.text.includes('apply') || l.text.includes('application')) &&
          isValidApplyUrl(l.href, jobHostname)
        );
        if (candidate) {
          applyUrl = candidate.href;
        }
      }

      if (!applyUrl || !isValidApplyUrl(applyUrl, jobHostname)) {
        throw new Error(`No valid external apply page found on ${job.url} — moved to manual queue.`);
      }

      console.log(`[auto-apply] Resolved apply URL: ${applyUrl.slice(0, 80)}`);

      // ── Step 3: Hand off to ATS connector if we recognise the ATS ──────────
      const atsConnector = findAtsConnector(applyUrl);
      if (atsConnector) {
        const jobWithAtsUrl = { ...job, url: applyUrl };
        await atsConnector.apply(jobWithAtsUrl as Job, cv, coverLetter, cvFilePath);
        return;
      }

      // ── Step 4: Generic apply — opt-in only ────────────────────────────────
      // Filling an unknown third-party form with the applicant's CV and PII is
      // unsafe by default: the resolved link could point anywhere. Require an
      // explicit opt-in; otherwise route the job to manual review.
      if (process.env['ALLOW_GENERIC_AUTO_APPLY'] !== 'true') {
        throw new Error(
          `Unrecognised apply page at ${applyUrl.slice(0, 120)} — manual review required. ` +
          'Set ALLOW_GENERIC_AUTO_APPLY=true to enable best-effort generic form filling.'
        );
      }

      await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2000);

      const captcha = await detectCaptcha(page);
      if (captcha) throw captchaError(captcha);

      const tryFill = async (selector: string, value: string) => {
        const el = await page.$(selector);
        if (el) { await el.fill(value); }
      };

      await tryFill('input[name="first_name"], input[id*="first"][type="text"], input[placeholder*="First" i]', applicant.firstName);
      await tryFill('input[name="last_name"], input[id*="last"][type="text"], input[placeholder*="Last" i]', applicant.lastName);
      await tryFill('input[name="email"], input[type="email"]', applicant.email);
      if (applicant.phone) await tryFill('input[name="phone"], input[type="tel"]', applicant.phone);

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

      // Require an explicit confirmation. A URL change alone is not proof:
      // validation errors and login redirects also change the URL. If we cannot
      // confirm, route the job to manual review rather than claiming success.
      try {
        await Promise.any([
          page.waitForSelector('text=/thank you for applying|thanks for applying/i', { timeout: 10_000 }),
          page.waitForSelector('text=/application (has been )?submitted/i', { timeout: 10_000 }),
          page.waitForSelector('text=/application (has been )?received/i', { timeout: 10_000 }),
          page.waitForSelector('text=/successfully submitted/i', { timeout: 10_000 }),
        ]);
      } catch {
        throw new Error(
          `No confirmation page detected at ${applyUrl.slice(0, 120)} — submission may not have completed. ` +
          'Manual review required.'
        );
      }

    } finally {
      await browser.close();
    }
  }
}
