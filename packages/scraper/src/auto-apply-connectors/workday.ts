import { chromium } from 'playwright';
import type { Job, CvVersion } from '@job-me/shared';
import type { AutoApplyConnector } from './base.js';

/**
 * Workday ATS auto-apply connector.
 *
 * Workday application pages (myworkdayjobs.com / wd3.myworkday.com) follow a
 * multi-step wizard structure:
 *   Step 1: My Information (name, email, phone, address)
 *   Step 2: My Experience (resume upload, work history)
 *   Step 3: Application Questions (custom per-company)
 *   Step 4: Self Identify (optional EEO)
 *   Step 5: Review & Submit
 *
 * This connector handles steps 1–2 and submit. Step 3 custom questions are
 * skipped (left blank) — extend per-company if needed.
 */
export class WorkdayConnector implements AutoApplyConnector {
  async apply(job: Job, cv: CvVersion | null, coverLetter?: string | null): Promise<void> {
    const FIRST_NAME = process.env['APPLICANT_FIRST_NAME'];
    const LAST_NAME  = process.env['APPLICANT_LAST_NAME'];
    const EMAIL      = process.env['APPLICANT_EMAIL'];
    const PHONE      = process.env['APPLICANT_PHONE'] ?? '';
    const CV_PATH    = process.env['CV_FILE_PATH'];

    if (!FIRST_NAME || !LAST_NAME || !EMAIL) {
      throw new Error('Missing applicant credentials. Set APPLICANT_FIRST_NAME, APPLICANT_LAST_NAME, APPLICANT_EMAIL.');
    }
    if (!CV_PATH) {
      throw new Error('CV_FILE_PATH not set — cannot upload CV to Workday form.');
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // ── Find and click the Apply button ────────────────────────
      const applyBtn = await page.$('a[href*="apply"], button:has-text("Apply"), a:has-text("Apply Now")');
      if (applyBtn) {
        await applyBtn.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
      }

      // ── Step 1: My Information ──────────────────────────────────
      // Workday uses data-automation-id attributes for reliable selection
      const firstNameSel = '[data-automation-id="legalNameSection_firstName"], input[name*="firstName" i], input[placeholder*="first name" i]';
      const lastNameSel  = '[data-automation-id="legalNameSection_lastName"],  input[name*="lastName" i],  input[placeholder*="last name" i]';
      const emailSel     = '[data-automation-id="email"], input[type="email"]';
      const phoneSel     = '[data-automation-id="phone-number"], input[type="tel"]';

      await page.waitForSelector(firstNameSel, { timeout: 15_000 });

      await page.fill(firstNameSel, FIRST_NAME);
      await page.fill(lastNameSel,  LAST_NAME);
      await page.fill(emailSel,     EMAIL);

      const phoneInput = await page.$(phoneSel);
      if (phoneInput && PHONE) await page.fill(phoneSel, PHONE);

      // Click "Next" to advance to My Experience
      const nextBtn = await page.$('[data-automation-id="bottom-navigation-next-btn"], button:has-text("Next")');
      if (nextBtn) {
        await nextBtn.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
      }

      // ── Step 2: My Experience — Resume upload ───────────────────
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(CV_PATH);
        await page.waitForTimeout(2000);
      }

      // ── Cover letter (fill if field exists on current step) ───────
      if (coverLetter) {
        const clField = await page.$('textarea[data-automation-id*="coverLetter" i], textarea[placeholder*="cover letter" i]');
        if (clField) await clField.fill(coverLetter);
      }

      // Advance through remaining steps to Review
      for (let step = 0; step < 4; step++) {
        const next = await page.$('[data-automation-id="bottom-navigation-next-btn"], button:has-text("Next"), button:has-text("Continue")');
        if (!next) break;
        const isDisabled = await next.isDisabled();
        if (isDisabled) break;
        await next.click();
        await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
      }

      // ── Submit ──────────────────────────────────────────────────
      const submitBtn = await page.$('[data-automation-id="bottom-navigation-next-btn"]:has-text("Submit"), button[type="submit"], button:has-text("Submit")');
      if (!submitBtn) throw new Error('Submit button not found — Workday form structure may have changed.');
      await submitBtn.click();

      // ── Confirm ─────────────────────────────────────────────────
      try {
        await page.waitForSelector(
          'text=Thank you, text=application has been submitted, text=successfully submitted, text=Application Submitted',
          { timeout: 15_000 }
        );
      } catch {
        const finalUrl = page.url();
        if (finalUrl === job.url) {
          throw new Error('Application may not have submitted — no confirmation found and URL did not change.');
        }
      }

    } finally {
      await browser.close();
    }
  }
}
