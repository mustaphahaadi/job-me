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
 */
export async function runAutoApply(supabase: SupabaseClient): Promise<void> {
  const settings = await getOrInitSettings(supabase);

  const { data: cvVersions } = await supabase.from('cv_versions').select('*');
  const cvs = (cvVersions ?? []) as CvVersion[];

  // Fetch eligible jobs
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'matched')
    .gte('match_score', settings.auto_apply_score_threshold);

  if (error) throw new Error(`[auto-apply] Failed to fetch eligible jobs: ${error.message}`);
  if (!jobs || jobs.length === 0) {
    console.log('[auto-apply] No eligible jobs.');
    return;
  }

  console.log(`[auto-apply] ${jobs.length} eligible job(s).`);

  // Rate cap: read from settings, default 5
  const MAX_PER_RUN = settings.max_auto_apply_per_run ?? 5;
  let attempted = 0;

  for (const job of jobs as Job[]) {
    if (attempted >= MAX_PER_RUN) {
      console.log(`[auto-apply] Rate cap reached (${MAX_PER_RUN}). Stopping.`);
      break;
    }

    const connector = findConnector(job.url);
    if (!connector) {
      // No connector for this site — send to manual queue
      await supabase.from('jobs').update({ status: 'manual_queue' }).eq('id', job.id);
      console.log(`[auto-apply] ${sanitizeLog(job.title)} → no connector, moved to manual queue.`);
      continue;
    }

    const cv = selectCvForTitle(cvs, job.title);
    const now = new Date().toISOString();

    // Generate cover letter via Gemini before attempting form submission
    const coverLetter = await generateCoverLetter({
      jobTitle: job.title,
      company: job.company,
      jobDescription: job.description,
      applicantName: `${process.env['APPLICANT_FIRST_NAME'] ?? ''} ${process.env['APPLICANT_LAST_NAME'] ?? ''}`.trim(),
      applicantEmail: process.env['APPLICANT_EMAIL'] ?? '',
      targetRoles: settings.target_roles,
      skillVocabulary: settings.skill_vocabulary ?? [],
    });

    // Store cover letter on the job regardless of apply outcome
    if (coverLetter) {
      await supabase.from('jobs').update({ cover_letter_text: coverLetter }).eq('id', job.id);
    }

    try {
      await connector.apply(job, cv, coverLetter);

      // Success
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
      attempted++;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[auto-apply] ${sanitizeLog(job.title)} → FAILED: ${sanitizeLog(message)}`);

      // Failure — move to manual_queue, never leave in limbo
      await supabase.from('jobs').update({
        status: 'manual_queue',
        auto_apply_attempted_at: now,
        auto_apply_result: 'failed',
        auto_apply_error: message,
      }).eq('id', job.id);

      attempted++;
    }
  }

  console.log('[auto-apply] Done.');
}

