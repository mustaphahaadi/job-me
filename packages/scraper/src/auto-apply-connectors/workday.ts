import { chromium } from 'playwright';
import type { Job, CvVersion } from '@job-me/shared';
import type { AutoApplyConnector } from './base.js';
import { detectCaptcha, captchaError } from './base.js';

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
 * This connector handles steps 1–2 and drives through to submit.
 * Step 3 custom questions are left blank — extend per-company if needed.
 */
export class WorkdayConnector implements AutoApplyConnector {
  async apply(job: Job, cv: CvVersion | null, coverLetter: string | null | undefined, cvFilePath: string): Promise<void> {
    const FIRST_NAME = process.env['APPLICANT_FIRST_NAME'] || 'Applicant';
    const LAST_NAME  = process.env['APPLICANT_LAST_NAME']  || 'User';
    const EMAIL      = process.env['APPLICANT_EMAIL']      || 'applicant@example.com';
    const PHONE      = process.env['APPLICANT_PHONE']      || '+233201234567';
    const CV_PATH    = cvFilePath || process.env['CV_FILE_PATH'];

    if (!CV_PATH) {
      throw new Error('CV_FILE_PATH not set — upload a CV on the /cv page or set CV_FILE_PATH in env.');
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      await page.goto(job.url, { waitUntil: 'networkidle', timeout: 30_000 });

      // ── Click Apply button if on a job description page ──────────
      const applyBtn = await page.$(
        'a[href*="apply" i][class*="apply" i], button:has-text("Apply Now"), button:has-text("Apply"), a:has-text("Apply Now")'
      );
      if (applyBtn) {
        await applyBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 20_000 });
      }

      // ── Step 1: My Information ──────────────────────────────────
      // Workday uses data-automation-id attributes for reliable targeting
      const firstNameSel = '[data-automation-id="legalNameSection_firstName"], input[name*="firstName" i]';
      const lastNameSel  = '[data-automation-id="legalNameSection_lastName"], input[name*="lastName" i]';
      const emailSel     = '[data-automation-id="email"], [data-automation-id="emailAddress"], input[type="email"]';
      const phoneSel     = '[data-automation-id="phone-number"], [data-automation-id="phoneNumber"], input[type="tel"]';

      await page.waitForSelector(firstNameSel, { timeout: 20_000 });

      await page.fill(firstNameSel, FIRST_NAME);
      await page.fill(lastNameSel,  LAST_NAME);
      await page.fill(emailSel,     EMAIL);

      const phoneInput = await page.$(phoneSel);
      if (phoneInput && PHONE) await page.fill(phoneSel, PHONE);

      // Advance to My Experience
      await this._clickNext(page);

      // ── Step 2: My Experience — Resume upload ───────────────────
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(CV_PATH);
        await page.waitForTimeout(2500); // Wait for upload to process
      }

      // Cover letter field (may appear on experience step)
      if (coverLetter) {
        const clField = await page.$(
          '[data-automation-id*="coverLetter" i], textarea[placeholder*="cover letter" i]'
        );
        if (clField) await clField.fill(coverLetter);
      }

      // ── Drive through remaining steps (Application Questions → Self Identify → Review) ──
      // Fail fast on CAPTCHA walls instead of submitting into them.
      const captcha = await detectCaptcha(page);
      if (captcha) throw captchaError(captcha);

      for (let step = 0; step < 5; step++) {
        const advanced = await this._clickNext(page);
        if (!advanced) break;
        await page.waitForTimeout(1000);

        // Check if we've reached the Submit button
        const submitBtn = await page.$(
          '[data-automation-id="bottom-navigation-next-btn"][aria-label*="Submit" i], button[type="submit"]:has-text("Submit")'
        );
        if (submitBtn) {
          const isDisabled = await submitBtn.isDisabled();
          if (!isDisabled) {
            await submitBtn.click();
            break;
          }
        }
      }

      // ── Confirm submission ──────────────────────────────────────
      const confirmed = await Promise.any([
        page.waitForSelector('text=Thank you', { timeout: 20_000 }).then(() => true),
        page.waitForSelector('text=application has been submitted', { timeout: 20_000 }).then(() => true),
        page.waitForSelector('text=successfully submitted', { timeout: 20_000 }).then(() => true),
        page.waitForSelector('text=Application Submitted', { timeout: 20_000 }).then(() => true),
        page.waitForURL(url => !url.href.includes('apply') && !url.href.includes('step'), { timeout: 20_000 }).then(() => true),
      ]).catch(() => false);

      if (!confirmed) {
        const finalUrl = page.url();
        if (finalUrl === job.url) {
          throw new Error('Application may not have submitted — no confirmation found and URL did not change.');
        }
      }

    } finally {
      await browser.close();
    }
  }

  /** Clicks the Next/Continue button. Returns false if no clickable next button found. */
  private async _clickNext(page: import('playwright').Page): Promise<boolean> {
    const nextBtn = await page.$(
      '[data-automation-id="bottom-navigation-next-btn"], button:has-text("Next"), button:has-text("Continue")'
    );
    if (!nextBtn) return false;
    const isDisabled = await nextBtn.isDisabled();
    if (isDisabled) return false;
    await nextBtn.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
    return true;
  }
}
