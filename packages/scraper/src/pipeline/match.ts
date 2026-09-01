import type { SupabaseClient, Job, Settings, NormalizedJob } from '@job-me/shared';
import { scoreJob, optionsFromSettings } from '@job-me/shared';

/**
 * Match pipeline step — §8.3.
 * Fetches all 'new' jobs, runs multi-signal scoring, updates status → 'matched' or leaves 'new'.
 */
export async function runMatch(supabase: SupabaseClient): Promise<void> {
  // Load settings for scoring options
  const { data: settingsData } = await supabase
    .from('settings')
    .select('*')
    .eq('id', 1)
    .single();

  if (!settingsData) throw new Error('[match] Settings row not found.');
  const settings = settingsData as Settings;

  // optionsFromSettings now maps all settings fields (target_seniority, accepted_locations,
  // negative_keywords) automatically — no manual extra spread needed.
  const scoringOptions = optionsFromSettings(settings);

  // Fetch all 'new' jobs
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'new');

  if (error) throw new Error(`[match] Failed to fetch new jobs: ${error.message}`);
  if (!jobs || jobs.length === 0) {
    console.log('[match] No new jobs to score.');
    return;
  }

  console.log(`[match] Scoring ${jobs.length} job(s).`);
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

    const newStatus = score > 0 ? 'matched' : 'new';
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

  console.log(`[match] Done. ${matched}/${jobs.length} job(s) matched.`);
}

