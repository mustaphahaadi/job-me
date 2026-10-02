import type { SupabaseClient, Job, NormalizedJob } from '@job-me/shared';
import { scoreJob, optionsFromSettings, getOrInitSettings } from '@job-me/shared';
import { sanitizeLog } from '../connectors/utils.js';

/**
 * Match pipeline step — §8.3.
 * Fetches all 'new' jobs, runs multi-signal scoring, updates status → 'matched' or leaves 'new'.
 */
export async function runMatch(supabase: SupabaseClient): Promise<void> {
  // Load settings for scoring options safely
  const settings = await getOrInitSettings(supabase);

  // optionsFromSettings maps all settings fields automatically
  const scoringOptions = optionsFromSettings(settings);

  // Fetch all 'new' jobs
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'new');

  if (error) throw new Error(`[match] Failed to fetch new jobs: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
  if (!jobs || jobs.length === 0) {
    console.log('[match] No new jobs to score.');
    return;
  }

  console.log(`[match] Scoring ${jobs.length} job(s).`); // jobs.length is a number, safe to log
  let matched = 0;

  for (const job of jobs as Job[]) {
    const normalized: NormalizedJob = {
      title: job.title,
      company: job.company,
      url: job.url,
      posted_date: job.posted_date,
      description: job.description,
      raw_location: job.raw_location,   // was always null before — now reads the stored value
      raw_tags: [],
    };

    const { score, breakdown } = scoreJob(normalized, scoringOptions);

    const newStatus = score >= 0.50 ? 'matched' : 'new'; // 0.50 = minimum to enter the active pipeline
    if (newStatus === 'matched') matched++;

    // Clamp to 'closed' if negative keyword hit
    const finalStatus = breakdown.negative_keyword_hit ? 'closed' : newStatus;

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

  console.log(`[match] Done. ${matched}/${jobs.length} job(s) matched.`); // numeric values, safe to log
}
