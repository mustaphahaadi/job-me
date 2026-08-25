import type { Job, CvVersion } from '@job-me/shared';

export interface AutoApplyConnector {
  /**
   * Attempts to auto-apply to the job using the given CV.
   * Must throw if the application could not be completed — include diagnostic detail in the error message.
   * Must NOT catch errors silently or retry in a loop.
   */
  apply(job: Job, cv: CvVersion | null): Promise<void>;
}
