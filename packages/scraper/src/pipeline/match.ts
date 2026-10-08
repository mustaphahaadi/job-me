import type { SupabaseClient, Job, NormalizedJob, JobStatus } from '@job-me/shared';
import { scoreJob, optionsFromSettings, getOrInitSettings, MATCH_PROMOTION_THRESHOLD } from '@job-me/shared';

/**
 * Match pipeline step — §8.3.
 *
 * Scores 'new' jobs and re-scores 'matched' + 'manual_queue' jobs against the
 * latest settings (so changed location/role rules take effect). Status
 * transitions are deliberately conservative to prevent flapping and endless
 * auto-apply retries:
 *
 *   - 'new'          → 'matched' when score >= MATCH_PROMOTION_THRESHOLD
 *                      and the location is accepted
 *   - 'matched'      → stays 'matched' unless closed (demote/re-promote across
 *                      runs caused status flapping)
 *   - 'manual_queue' → never auto-promoted — failed auto-apply jobs live here
 *                      and re-queueing is an explicit user action (Re-queue in
 *                      the drawer). Still re-scored; closed if rules reject it.
 *   - anything       → 'closed' on negative keyword / rejected location / low score
 */
export async function runMatch(supabase: SupabaseClient): Promise<void> {
  const settings = await getOrInitSettings(supabase);
  const scoringOptions = optionsFromSettings(settings);

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('*')
    .in('status', ['new', 'matched', 'manual_queue']);

  if (error) throw new Error(`[match] Failed to fetch jobs for scoring: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
  if (!jobs || jobs.length === 0) {
    console.log('[match] No jobs to score.');
    return;
  }

  console.log(`[match] Scoring ${jobs.length} job(s).`);
  let promoted = 0;
  let closed = 0;
  let unchanged = 0;

  for (const job of jobs as Job[]) {
    const normalized: NormalizedJob = {
      title: job.title,
      company: job.company,
      url: job.url,
      posted_date: job.posted_date,
      description: job.description,
      raw_location: job.raw_location,
      raw_tags: [],
    };

    const { score, breakdown } = scoreJob(normalized, scoringOptions);

    const isMatched = score >= MATCH_PROMOTION_THRESHOLD && breakdown.location.accepted;
    const isLowScore = score < 0.25;

    let finalStatus: JobStatus = job.status;

    // Close on negative keyword, rejected location, or low suitability score.
    if (breakdown.negative_keyword_hit || !breakdown.location.accepted || isLowScore) {
      finalStatus = 'closed';
    } else if (job.status === 'new' && isMatched) {
      finalStatus = 'matched';
    }

    if (finalStatus !== job.status) {
      if (finalStatus === 'matched') promoted++;
      if (finalStatus === 'closed') closed++;
    } else {
      unchanged++;
    }

    await supabase.from('jobs').update({
      match_score: score,
      match_breakdown: breakdown,
      matched_keywords: [
        ...breakdown.title_match.matched_keywords,
        ...breakdown.skills_overlap.matched_skills,
      ],
      status: finalStatus,
    }).eq('id', job.id);
  }

  console.log(`[match] Done. ${promoted} promoted to matched, ${closed} closed, ${unchanged} unchanged (${jobs.length} scored).`);
}
