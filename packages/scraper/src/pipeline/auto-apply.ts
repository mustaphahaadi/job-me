import type { SupabaseClient, Job, CvVersion } from '@job-me/shared';
import { getOrInitSettings, selectCvForTitle, generateCoverLetter } from '@job-me/shared';
import { sanitizeLog } from '../connectors/utils.js';
import type { AutoApplyConnector } from '../auto-apply-connectors/base.js';
import { GreenhouseConnector } from '../auto-apply-connectors/greenhouse.js';
import { LeverConnector } from '../auto-apply-connectors/lever.js';
import { WorkdayConnector } from '../auto-apply-connectors/workday.js';

// ─── Connector registry ───────────────────────────────────────────────────────
// Add new ATS connectors here. Key = pattern to detect in the job URL.
const AUTO_APPLY_CONNECTORS: Array<{ pattern: RegExp; connector: AutoApplyConnector }> = [
  { pattern: /greenhouse\.io|boards\.greenhouse\.io/, connector: new GreenhouseConnector() },
  { pattern: /jobs\.lever\.co|lever\.co\//, connector: new LeverConnector() },
  { pattern: /myworkdayjobs\.com|wd3\.myworkday\.com|wd1\.myworkday\.com/, connector: new WorkdayConnector() },
];

function findConnector(jobUrl: string): AutoApplyConnector | null {
  for (const entry of AUTO_APPLY_CONNECTORS) {
    if (entry.pattern.test(jobUrl)) return entry.connector;
  }
  return null;
}

/**
 * Auto-apply pipeline step — §8.4.
 * Processes eligible matched jobs in order. Rate-capped per source.
 * On failure: moves to manual_queue with error detail — never silently retries.
 *
 * Rate cap: only successful applications count toward MAX_PER_RUN.
 * Jobs without a recognized ATS connector are moved to manual_queue (not counted).
 */
export async function runAutoApply(supabase: SupabaseClient): Promise<void> {
  const settings = await getOrInitSettings(supabase);

  // Guard: auto-apply requires a CV path. Skip entire step if missing.
  const CV_PATH = process.env['CV_FILE_PATH'];
  if (!CV_PATH) {
    console.log('[auto-apply] CV_FILE_PATH not set — skipping auto-apply step.');
    return;
  }

  const { data: cvVersions } = await supabase.from('cv_versions').select('*');
  const cvs = (cvVersions ?? []) as CvVersion[];

  // Use settings threshold (auto_apply_score_threshold) as the eligibility filter
  const scoreThreshold = settings.auto_apply_score_threshold ?? 0.75;

  // Fetch eligible jobs
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'matched')
    .gte('match_score', scoreThreshold)
    .order('match_score', { ascending: false }); // Best matches first

  if (error) throw new Error(`[auto-apply] Failed to fetch eligible jobs: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
  if (!jobs || jobs.length === 0) {
    console.log('[auto-apply] No eligible jobs.');
    return;
  }

  console.log(`[auto-apply] ${jobs.length} eligible job(s) above threshold ${scoreThreshold}.`);

  // Rate cap: applies to successful submissions only
  const MAX_PER_RUN = settings.max_auto_apply_per_run ?? 5;
  let successful = 0;

  for (const job of jobs as Job[]) {
    if (successful >= MAX_PER_RUN) {
      console.log(`[auto-apply] Success cap reached (${MAX_PER_RUN}). Stopping.`);
      break;
    }

    const connector = findConnector(job.url);
    if (!connector) {
      // No connector for this ATS — route to manual queue immediately
      await supabase.from('jobs').update({ status: 'manual_queue' }).eq('id', job.id);
      console.log(`[auto-apply] ${sanitizeLog(job.title)} → no connector, moved to manual queue.`);
      continue; // does NOT count toward rate cap
    }

    const cv = selectCvForTitle(cvs, job.title);
    const now = new Date().toISOString();

    // Generate cover letter via Gemini (best-effort — null if key missing or API fails)
    let coverLetter: string | null = null;
    try {
      coverLetter = await generateCoverLetter({
        jobTitle: job.title,
        company: job.company,
        jobDescription: job.description,
        applicantName: `${process.env['APPLICANT_FIRST_NAME'] ?? ''} ${process.env['APPLICANT_LAST_NAME'] ?? ''}`.trim(),
        applicantEmail: process.env['APPLICANT_EMAIL'] ?? '',
        targetRoles: settings.target_roles,
        skillVocabulary: settings.skill_vocabulary ?? [],
      });
    } catch (clErr) {
      // Cover letter generation failure must not block the application
      console.warn(`[auto-apply] Cover letter generation failed for "${sanitizeLog(job.title)}" — continuing without it.`);
    }

    // Persist cover letter on the job record before attempting form submission
    if (coverLetter) {
      await supabase.from('jobs').update({ cover_letter_text: coverLetter }).eq('id', job.id);
    }

    try {
      await connector.apply(job, cv, coverLetter);

      // ── Success ─────────────────────────────────────────────────────────────
      await supabase.from('jobs').update({
        status: 'auto_applied',
        auto_apply_attempted_at: now,
        auto_apply_result: 'success',
        cv_version_id: cv?.id ?? null,
      }).eq('id', job.id);

      await supabase.from('applications').insert({
        job_id: job.id,
        method: 'auto',
        cv_version_id: cv?.id ?? null,
      });

      console.log(`[auto-apply] ${sanitizeLog(job.title)} at ${sanitizeLog(job.company)} → SUCCESS`);
      successful++; // Only successes count toward the rate cap

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[auto-apply] ${sanitizeLog(job.title)} → FAILED: ${sanitizeLog(message)}`);

      // Failure — move to manual_queue with error detail, never leave in limbo
      await supabase.from('jobs').update({
        status: 'manual_queue',
        auto_apply_attempted_at: now,
        auto_apply_result: 'failed',
        auto_apply_error: message.slice(0, 500), // Guard against very long stack traces
      }).eq('id', job.id);

      // Failures do NOT count toward rate cap — allows good jobs to still be processed
    }
  }

  console.log(`[auto-apply] Done. ${successful} application(s) submitted.`);
}
