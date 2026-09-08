import { chromium } from 'playwright';
import type { Job, CvVersion } from '@job-me/shared';
import type { AutoApplyConnector } from './base.js';

/**
 * Lever ATS auto-apply connector.
 *
 * Lever application pages (jobs.lever.co) follow a consistent structure:
 *   - Full name (single field, not split)
 *   - Email
 *   - Phone (optional)
 *   - Resume upload
 *   - LinkedIn / website (optional, skipped)
 *   - Submit button
 */
export class LeverConnector implements AutoApplyConnector {
  async apply(job: Job, cv: CvVersion | null): Promise<void> {
    const FIRST_NAME = process.env['APPLICANT_FIRST_NAME'];
    const LAST_NAME  = process.env['APPLICANT_LAST_NAME'];
    const EMAIL      = process.env['APPLICANT_EMAIL'];
    const PHONE      = process.env['APPLICANT_PHONE'] ?? '';
    const CV_PATH    = process.env['CV_FILE_PATH'];

    if (!FIRST_NAME || !LAST_NAME || !EMAIL) {
      throw new Error('Missing applicant credentials. Set APPLICANT_FIRST_NAME, APPLICANT_LAST_NAME, and APPLICANT_EMAIL.');
    }
    if (!CV_PATH) {
      throw new Error('CV_FILE_PATH not set — cannot upload CV to Lever form.');
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // ── Step 1: Fill basic fields ───────────────────────────────
      // Lever uses a single "Full name" field
      const fullNameSelector = 'input[name="name"], input[placeholder*="name" i], input[id*="name" i]';
      await page.waitForSelector(fullNameSelector, { timeout: 10_000 });
      await page.fill(fullNameSelector, `${FIRST_NAME} ${LAST_NAME}`);

      await page.fill('input[name="email"], input[type="email"]', EMAIL);

      const phoneInput = await page.$('input[name="phone"], input[type="tel"]');
      if (phoneInput && PHONE) await phoneInput.fill(PHONE);

      // ── Step 2: Upload CV ───────────────────────────────────────
      const fileInput = await page.$('input[type="file"]');
      if (!fileInput) throw new Error('No file input found on Lever form — form structure may have changed.');
      await fileInput.setInputFiles(CV_PATH);
      await page.waitForTimeout(1500);

      // ── Step 3: Submit ──────────────────────────────────────────
      const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
      if (!submitBtn) throw new Error('Submit button not found — form structure may have changed.');
      await submitBtn.click();

      // ── Step 4: Confirm ─────────────────────────────────────────
      try {
        await page.waitForSelector(
          'text=Application submitted, text=Thank you, text=successfully submitted, text=application received',
          { timeout: 15_000 }
        );
      } catch {
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
