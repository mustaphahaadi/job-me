import type { Job, CvVersion } from '@job-me/shared';
import type { Page } from 'playwright';

export interface AutoApplyConnector {
  /**
   * Attempts to auto-apply to the job using the given CV and optional cover letter.
   * `cvFilePath` is the local path of the role-matched CV file for this job —
   * connectors must use it rather than re-reading CV_FILE_PATH from env.
   * Must throw if the application could not be completed.
   * Must NOT catch errors silently or retry in a loop.
   */
  apply(job: Job, cv: CvVersion | null, coverLetter: string | null | undefined, cvFilePath: string): Promise<void>;
}

export interface Applicant {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/**
 * Reads and validates applicant details from the environment.
 *
 * Auto-apply must never submit a form with placeholder data ("Applicant User",
 * "applicant@example.com"). Missing required values fail fast so the caller can
 * skip the whole step instead of filling dozens of applications incorrectly.
 */
export function getApplicant(): Applicant {
  const firstName = process.env['APPLICANT_FIRST_NAME']?.trim() ?? '';
  const lastName = process.env['APPLICANT_LAST_NAME']?.trim() ?? '';
  const email = process.env['APPLICANT_EMAIL']?.trim() ?? '';
  const phone = process.env['APPLICANT_PHONE']?.trim() ?? '';

  const missing: string[] = [];
  if (!firstName) missing.push('APPLICANT_FIRST_NAME');
  if (!lastName) missing.push('APPLICANT_LAST_NAME');
  if (!email) missing.push('APPLICANT_EMAIL');

  if (missing.length > 0) {
    throw new Error(`Missing applicant details: ${missing.join(', ')}. Set them in .env.local or GitHub Actions secrets.`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('APPLICANT_EMAIL is not a valid email address.');
  }

  return { firstName, lastName, email, phone };
}

/** Playwright visibility — set PLAYWRIGHT_HEADLESS=false to watch a run locally. */
export function isHeadless(): boolean {
  return process.env['PLAYWRIGHT_HEADLESS'] !== 'false';
}

/**
 * Detects reCAPTCHA / hCaptcha / Turnstile widgets on the current page.
 * Returns the CAPTCHA kind found, or null. Used to fail fast with a clear
 * error instead of submitting a form that will silently bounce to a CAPTCHA wall.
 */
export async function detectCaptcha(page: Page): Promise<string | null> {
  const recaptcha = await page.$('iframe[src*="recaptcha"], .g-recaptcha, #recaptcha-container, iframe[title*="reCAPTCHA" i]');
  if (recaptcha) return 'reCAPTCHA';
  const hcaptcha = await page.$('iframe[src*="hcaptcha"], .h-captcha, iframe[title*="hCaptcha" i]');
  if (hcaptcha) return 'hCaptcha';
  const turnstile = await page.$('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, iframe[title*="Turnstile" i]');
  if (turnstile) return 'Cloudflare Turnstile';
  return null;
}

/** Standard error for a CAPTCHA-blocked application (moved to manual queue by the caller). */
export function captchaError(kind: string): Error {
  return new Error(`captcha_detected: ${kind} found on the application form — manual review required.`);
}
