import { chromium } from 'playwright';
import type { Job, CvVersion } from '@job-me/shared';
import type { AutoApplyConnector } from './base.js';

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
 * This connector handles the common pattern. Extend or fork for variations.
 *
 * CAUTION: Playwright must be installed before running this connector:
 *   npx playwright install --with-deps chromium
 */
export class GreenhouseConnector implements AutoApplyConnector {
  async apply(job: Job, cv: CvVersion | null, coverLetter?: string | null): Promise<void> {
    const FIRST_NAME = process.env['APPLICANT_FIRST_NAME'];
    const LAST_NAME  = process.env['APPLICANT_LAST_NAME'];
    const EMAIL      = process.env['APPLICANT_EMAIL'];
    const PHONE      = process.env['APPLICANT_PHONE'] ?? '';
    const CV_PATH    = process.env['CV_FILE_PATH']; // local path to CV file for upload

    if (!FIRST_NAME || !LAST_NAME || !EMAIL) {
      throw new Error(
        'Missing applicant credentials. Set APPLICANT_FIRST_NAME, APPLICANT_LAST_NAME, and APPLICANT_EMAIL.'
      );
    }

    if (!CV_PATH) {
      throw new Error('CV_FILE_PATH not set — cannot upload CV to Greenhouse form.');
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // ── Step 1: Fill basic fields ───────────────────────────────
      const firstNameSelector = 'input[name="first_name"], input[id*="first_name"]';
      const lastNameSelector  = 'input[name="last_name"],  input[id*="last_name"]';
      const emailSelector     = 'input[name="email"],       input[type="email"]';
      const phoneSelector     = 'input[name="phone"],       input[type="tel"]';

      await page.waitForSelector(firstNameSelector, { timeout: 10_000 });

      await page.fill(firstNameSelector, FIRST_NAME);
      await page.fill(lastNameSelector,  LAST_NAME);
      await page.fill(emailSelector,     EMAIL);

      const phoneInput = await page.$(phoneSelector);
      if (phoneInput && PHONE) await page.fill(phoneSelector, PHONE);

      // ── Step 2: Upload CV ───────────────────────────────────────
      const fileInput = await page.$('input[type="file"]');
      if (!fileInput) throw new Error('No file input found on Greenhouse form — form structure may have changed.');
      await fileInput.setInputFiles(CV_PATH);
      await page.waitForTimeout(1500);

      // ── Step 3: Cover letter (fill if field exists) ─────────────
      if (coverLetter) {
        const clField = await page.$('textarea[name="cover_letter"], textarea[id*="cover_letter" i], textarea[placeholder*="cover letter" i]');
        if (clField) await clField.fill(coverLetter);
      }

      // ── Step 4: Submit ──────────────────────────────────────────
      const submitSelector = 'input[type="submit"], button[type="submit"]';
      const submitBtn = await page.$(submitSelector);
      if (!submitBtn) throw new Error('Submit button not found — form structure may have changed.');

      await submitBtn.click();

      // ── Step 4: Confirm submission ──────────────────────────────
      // Wait for a confirmation indicator — Greenhouse typically shows "Application submitted"
      try {
        await page.waitForSelector(
          'text=Application submitted, text=Thank you, text=application has been received',
          { timeout: 15_000 }
        );
      } catch {
        // If no confirmation text found, check URL didn't stay on the same form
        const finalUrl = page.url();
        if (finalUrl === job.url || finalUrl.includes('/apply')) {
          throw new Error('Application may not have submitted — no confirmation text found and URL did not change.');
        }
      }

    } finally {
      await browser.close();
    }
  }
}
