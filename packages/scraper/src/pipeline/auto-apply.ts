import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SupabaseClient, Job, CvVersion } from '@job-me/shared';
import { getOrInitSettings, selectCvForTitle, generateCoverLetter } from '@job-me/shared';
import { sanitizeLog } from '../connectors/utils.js';
import type { AutoApplyConnector } from '../auto-apply-connectors/base.js';
import { getApplicant, type Applicant } from '../auto-apply-connectors/base.js';
import { findAtsConnector, getHostname, hostMatchesDomain } from '../auto-apply-connectors/ats.js';
import { JobBoardResolverConnector } from '../auto-apply-connectors/jobboard-resolver.js';

// ─── Connector registry ───────────────────────────────────────────────────────
// Job-board listing pages: the resolver visits the page and extracts the real
// apply URL, then delegates to a direct ATS connector when possible.
// Direct ATS domains live in auto-apply-connectors/ats.ts and are matched on
// the parsed hostname, not on the full URL string.
const JOB_BOARD_DOMAINS = [
  'weworkremotely.com', 'remoteok.com', 'remoteok.io', 'remotive.com',
  'remotive.io', 'jobicy.com', 'wellfound.com', 'angel.co', 'otta.com',
  'arbeitnow.com', 'nodesk.co', 'linkedin.com', 'dev.to',
];

const jobBoardResolver = new JobBoardResolverConnector();

function findConnector(jobUrl: string): AutoApplyConnector | null {
  const atsConnector = findAtsConnector(jobUrl);
  if (atsConnector) return atsConnector;

  const host = getHostname(jobUrl);
  if (host && JOB_BOARD_DOMAINS.some(domain => hostMatchesDomain(host, domain))) {
    return jobBoardResolver;
  }
  return null;
}

/**
 * Downloads a CV version's file from Supabase Storage to a tmp file, cached by
 * CV id so multiple jobs matching the same CV re-use one download.
 */
async function ensureCvFile(supabase: SupabaseClient, cv: CvVersion, cache: Map<string, string>): Promise<string | null> {
  const cached = cache.get(cv.id);
  if (cached && fs.existsSync(cached)) return cached;
  if (!cv.file_path) return null;

  try {
    const { data: blob, error } = await supabase.storage.from('cv-files').download(cv.file_path);
    if (error || !blob) {
      console.warn(`[auto-apply] Could not download CV "${cv.label}" from storage: ${String(error?.message ?? 'empty blob').replace(/[\r\n]/g, ' ')}`);
      return null;
    }
    // Preserve the real extension: some legacy CV rows may be .doc/.docx even
    // though the upload UI now restricts PDFs. Connectors must receive a file
    // whose extension matches its bytes or ATS uploads can be rejected.
    const extension = path.extname(cv.file_path).toLowerCase();
    const safeExtension = ['.pdf', '.doc', '.docx'].includes(extension) ? extension : '.pdf';
    const tmpPath = path.join(os.tmpdir(), `cv-${cv.id}${safeExtension}`);
    fs.writeFileSync(tmpPath, Buffer.from(await blob.arrayBuffer()));
    cache.set(cv.id, tmpPath);
    return tmpPath;
  } catch (dlException) {
    console.warn('[auto-apply] Could not download CV from Supabase Storage:', dlException);
    return null;
  }
}

/**
 * Auto-apply pipeline step — §8.4.
 * Processes eligible matched jobs in order.
 *
 * Rate cap: attempts against a recognized connector count toward MAX_PER_RUN
 * (successes AND failures) — a single run can never submit more than the cap
 * to a site, no matter how many eligible jobs fail.
 *
 * CV selection: each job uploads the file of its role-matched CV (by CV id),
 * not whatever CV_FILE_PATH happens to point at. CV_FILE_PATH / the most
 * recently uploaded CV is only the fallback when a job matches no CV row.
 *
 * Jobs without a recognized ATS connector are moved to manual_queue (not an
 * attempt). On failure: moves to manual_queue with error detail — never
 * silently retries.
 */
export async function runAutoApply(supabase: SupabaseClient): Promise<void> {
  const settings = await getOrInitSettings(supabase);

  const { data: cvVersions } = await supabase.from('cv_versions').select('*').order('uploaded_at', { ascending: false });
  const cvs = (cvVersions ?? []) as CvVersion[];
  const cvFileCache = new Map<string, string>();

  // Fallback path — used only when a job's selected CV has no downloadable file.
  let fallbackCvPath = process.env['CV_FILE_PATH'] ?? null;

  if (!fallbackCvPath && cvs.length > 0 && cvs[0]?.file_path) {
    const defaultCv = cvs[0];
    console.log(`[auto-apply] CV_FILE_PATH not set in env — downloading most recent CV "${defaultCv.label}" from Supabase Storage...`);
    fallbackCvPath = await ensureCvFile(supabase, defaultCv, cvFileCache);
  }

  // A stale CV_FILE_PATH would make every application fail. Treat a missing
  // file the same as no CV so the run skips cleanly instead of burning the cap.
  if (fallbackCvPath && !fs.existsSync(fallbackCvPath)) {
    console.warn(`[auto-apply] CV_FILE_PATH does not exist: ${sanitizeLog(fallbackCvPath)} — ignoring it.`);
    fallbackCvPath = null;
  }

  // Guard: auto-apply requires a CV path. Skip step if missing.
  if (!fallbackCvPath) {
    console.log('[auto-apply] No CV file available (set CV_FILE_PATH in env or upload a CV on the /cv page) — skipping auto-apply step.');
    return;
  }

  // Guard: never submit placeholder applicant details. Fail before touching
  // any job so a misconfigured run does not move the whole queue to manual.
  let applicant: Applicant;
  try {
    applicant = getApplicant();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[auto-apply] ${message} — skipping auto-apply step.`);
    return;
  }

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

  const MAX_PER_RUN = settings.max_auto_apply_per_run ?? 5;
  let attempts = 0;
  let successful = 0;

  for (const job of jobs as Job[]) {
    if (attempts >= MAX_PER_RUN) {
      console.log(`[auto-apply] Attempt cap reached (${MAX_PER_RUN}). Stopping.`);
      break;
    }

    const connector = findConnector(job.url);
    if (!connector) {
      // No connector for this ATS — route to manual queue immediately.
      // Do not set auto_apply_result: no application was attempted.
      const { error: queueErr } = await supabase.from('jobs').update({
        status: 'manual_queue',
        auto_apply_error: 'No auto-apply connector is registered for this job URL.',
      }).eq('id', job.id);
      if (queueErr) {
        console.error(`[auto-apply] Failed to queue ${job.id} for manual review: ${sanitizeLog(queueErr.message)}`);
      }
      console.log(`[auto-apply] ${sanitizeLog(job.title)} → no connector, moved to manual queue.`);
      continue; // does NOT count toward rate cap
    }

    // Never submit twice. An application row can exist while the job is still
    // 'matched' if a previous success update failed after submission, or if a
    // manual mark partially failed. Route it to manual review instead.
    const { data: existingApplication, error: appLookupErr } = await supabase
      .from('applications')
      .select('id')
      .eq('job_id', job.id)
      .maybeSingle();
    if (appLookupErr) {
      console.error(`[auto-apply] Could not check application history for ${job.id}: ${sanitizeLog(appLookupErr.message)} — skipping this run.`);
      continue;
    }
    if (existingApplication) {
      await supabase.from('jobs').update({
        status: 'manual_queue',
        auto_apply_error: 'An application record already exists for this job — verify it before retrying.',
      }).eq('id', job.id);
      console.warn(`[auto-apply] ${sanitizeLog(job.title)} → application already recorded, moved to manual queue.`);
      continue;
    }

    const cv = selectCvForTitle(cvs, job.title);
    // Upload the role-matched CV's file; fall back to the default path only
    // when the selected CV's file cannot be downloaded.
    const jobCvPath: string = (cv ? await ensureCvFile(supabase, cv, cvFileCache) : null) ?? fallbackCvPath;
    if (cv && jobCvPath === fallbackCvPath && cvFileCache.get(cv.id) === undefined) {
      console.warn(`[auto-apply] CV "${cv.label}" file unavailable — using fallback CV file for ${sanitizeLog(job.title)}.`);
    }

    const now = new Date().toISOString();

    // Generate cover letter via OpenRouter (best-effort — null if key missing or API fails)
    let coverLetter: string | null = null;
    try {
      coverLetter = await generateCoverLetter({
        jobTitle: job.title,
        company: job.company,
        jobDescription: job.description,
        applicantName: `${applicant.firstName} ${applicant.lastName}`.trim(),
        applicantEmail: applicant.email,
        targetRoles: settings.target_roles,
        skillVocabulary: settings.skill_vocabulary ?? [],
      });
    } catch (clErr) {
      // Cover letter generation failure must not block the application
      const message = clErr instanceof Error ? clErr.message : String(clErr);
      console.warn(`[auto-apply] Cover letter generation failed for "${sanitizeLog(job.title)}" (${sanitizeLog(message)}) — continuing without it.`);
    }

    // Persist cover letter on the job record before attempting form submission
    if (coverLetter) {
      await supabase.from('jobs').update({ cover_letter_text: coverLetter }).eq('id', job.id);
    }

    attempts++;
    try {
      await connector.apply(job, cv, coverLetter, jobCvPath);

      // ── Success ─────────────────────────────────────────────────────────────
      const { error: successErr } = await supabase.from('jobs').update({
        status: 'auto_applied',
        auto_apply_attempted_at: now,
        auto_apply_result: 'success',
        auto_apply_error: null,
        cv_version_id: cv?.id ?? null,
      }).eq('id', job.id);
      if (successErr) {
        console.error(`[auto-apply] Submitted, but failed to update job ${job.id}: ${sanitizeLog(successErr.message)}`);
      }

      const { error: appErr } = await supabase.from('applications').upsert({
        job_id: job.id,
        method: 'auto',
        cv_version_id: cv?.id ?? null,
      }, { onConflict: 'job_id' });
      if (appErr) {
        console.error(`[auto-apply] Application submitted, but recording it failed: ${sanitizeLog(appErr.message)}`);
      }

      console.log(`[auto-apply] ${sanitizeLog(job.title)} at ${sanitizeLog(job.company)} → SUCCESS`);
      successful++;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[auto-apply] ${sanitizeLog(job.title)} → FAILED: ${sanitizeLog(message)}`);

      // Failure — move to manual_queue with error detail, never leave in limbo
      const { error: failErr } = await supabase.from('jobs').update({
        status: 'manual_queue',
        auto_apply_attempted_at: now,
        auto_apply_result: 'failed',
        auto_apply_error: message.slice(0, 500), // Guard against very long stack traces
      }).eq('id', job.id);
      if (failErr) {
        console.error(`[auto-apply] Failed to record failure for job ${job.id}: ${sanitizeLog(failErr.message)}`);
      }
      // The failed attempt still consumed rate-cap budget (§8.4).
    }
  }

  console.log(`[auto-apply] Done. ${successful}/${attempts} application(s) submitted (attempt cap ${MAX_PER_RUN}).`);
}
