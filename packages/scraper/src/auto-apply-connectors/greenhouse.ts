import { chromium } from 'playwright';
import type { Job, CvVersion } from '@job-me/shared';
import type { AutoApplyConnector } from './base.js';
import { detectCaptcha, captchaError, getApplicant, isHeadless } from './base.js';

/**
 * Greenhouse ATS auto-apply connector.
 *
 * Greenhouse application pages follow a consistent structure:
 *   - First name / Last name / Email (always present)
 *   - Phone (sometimes required)
 *   - Resume upload (file input)
 *   - Cover letter (sometimes present)
 *   - Submit button
 *
 * CAUTION: Playwright Chromium must be installed before running:
 *   npx playwright install --with-deps chromium
 */
export class GreenhouseConnector implements AutoApplyConnector {
  async apply(job: Job, cv: CvVersion | null, coverLetter: string | null | undefined, cvFilePath: string): Promise<void> {
    const applicant = getApplicant();
    const CV_PATH    = cvFilePath || process.env['CV_FILE_PATH'];

    if (!CV_PATH) {
      throw new Error('CV_FILE_PATH not set — upload a CV on the /cv page or set CV_FILE_PATH in env.');
    }

    const browser = await chromium.launch({ headless: isHeadless() });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      await page.goto(job.url, { waitUntil: 'networkidle', timeout: 30_000 });

      // ── Step 1: Fill basic fields ───────────────────────────────
      const firstNameSelector = 'input[name="first_name"], input[id*="first_name"]';
      const lastNameSelector  = 'input[name="last_name"], input[id*="last_name"]';
      const emailSelector     = 'input[name="email"], input[type="email"]';
      const phoneSelector     = 'input[name="phone"], input[type="tel"]';

      await page.waitForSelector(firstNameSelector, { timeout: 15_000 });

      await page.fill(firstNameSelector, applicant.firstName);
      await page.fill(lastNameSelector,  applicant.lastName);
      await page.fill(emailSelector,     applicant.email);

      const phoneInput = await page.$(phoneSelector);
      if (phoneInput && applicant.phone) await page.fill(phoneSelector, applicant.phone);

      // ── Step 2: Upload CV ───────────────────────────────────────
      const fileInput = await page.$('input[type="file"]');
      if (!fileInput) throw new Error('No file input found on Greenhouse form — form structure may have changed.');
      await fileInput.setInputFiles(CV_PATH);
      // Wait for upload processing
      await page.waitForTimeout(2000);

      // ── Step 3: Cover letter (fill if field exists) ─────────────
      if (coverLetter) {
        const clField = await page.$(
          'textarea[name="cover_letter"], textarea[id*="cover_letter" i], textarea[placeholder*="cover letter" i]'
        );
        if (clField) {
          await clField.fill(coverLetter);
        }
      }

      // ── Step 4: Submit ──────────────────────────────────────────
      // Fail fast on CAPTCHA walls instead of submitting into them.
      const captcha = await detectCaptcha(page);
      if (captcha) throw captchaError(captcha);

      const submitSelector = 'input[type="submit"][value*="Submit" i], button[type="submit"]';
      const submitBtn = await page.$(submitSelector);
      if (!submitBtn) throw new Error('Submit button not found — form structure may have changed.');
      await submitBtn.click();

      // ── Step 5: Confirm submission ──────────────────────────────
      // Require an explicit confirmation. A URL change alone is not proof:
      // validation errors and login redirects also change the URL.
      const confirmed = await Promise.any([
        page.waitForSelector('text=/application (has been )?submitted/i', { timeout: 15_000 }).then(() => true),
        page.waitForSelector('text=/application (has been )?received/i', { timeout: 15_000 }).then(() => true),
        page.waitForSelector('text=/thank you for applying/i', { timeout: 15_000 }).then(() => true),
      ]).catch(() => false);

      if (!confirmed) {
        throw new Error('Application may not have submitted — no confirmation text found.');
      }

    } finally {
      await browser.close();
    }
  }
}
