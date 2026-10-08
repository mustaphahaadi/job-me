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

/**
 * Detects reCAPTCHA / hCaptcha widgets on the current page.
 * Returns the CAPTCHA kind found, or null. Used to fail fast with a clear
 * error instead of submitting a form that will silently bounce to a CAPTCHA wall.
 */
export async function detectCaptcha(page: Page): Promise<string | null> {
  const recaptcha = await page.$('iframe[src*="recaptcha"], .g-recaptcha, #recaptcha-container, iframe[title*="reCAPTCHA" i]');
  if (recaptcha) return 'reCAPTCHA';
  const hcaptcha = await page.$('iframe[src*="hcaptcha"], .h-captcha, iframe[title*="hCaptcha" i]');
  if (hcaptcha) return 'hCaptcha';
  return null;
}

/** Standard error for a CAPTCHA-blocked application (moved to manual queue by the caller). */
export function captchaError(kind: string): Error {
  return new Error(`captcha_detected: ${kind} found on the application form — manual review required.`);
}
