import type { SupabaseClient, Job } from '@job-me/shared';
import { enrichJobDescription } from '@job-me/shared';
import { sanitizeLog } from '../connectors/utils.js';

/**
 * Enrich pipeline step — runs between scrape and match.
 *
 * For each 'new' job with a description, calls Gemini to:
 *   1. Detect spam / fake postings → immediately close them
 *   2. Confirm remote status → set raw_location to 'Remote' when empty
 *
 * The description is intentionally never modified: prepending an AI summary on
 * every run stacked duplicate text (jobs can sit in 'new' for days and were
 * re-enriched each run), and AI-generated wording inflated the skills signal
 * during scoring. The description stays exactly what the source published.
 *
 * Gracefully skips if GEMINI_API_KEY is not set — pipeline continues unaffected.
 * Rate-limited to avoid hitting Gemini free tier limits.
 */
export async function runEnrich(supabase: SupabaseClient): Promise<void> {
  if (!process.env['GEMINI_API_KEY']) {
    console.log('[enrich] GEMINI_API_KEY not set — skipping AI enrichment.');
    return;
  }

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, title, description, raw_location')
    .eq('status', 'new')
    .not('description', 'is', null)
    .limit(60); // stay within free-tier rate limits over ~4 min window

  if (error) throw new Error(`[enrich] Failed to fetch jobs: ${error.message}`);
  if (!jobs || jobs.length === 0) {
    console.log('[enrich] No new jobs to enrich.');
    return;
  }

  console.log(`[enrich] Enriching ${jobs.length} job(s) via Gemini.`);

  let enriched = 0;
  let spamClosed = 0;

  for (const job of jobs as Pick<Job, 'id' | 'title' | 'description' | 'raw_location'>[]) {
    // Rate limit: 1 request every 4 seconds to stay strictly within free-tier limits
    await new Promise(r => setTimeout(r, 4000));

    const result = await enrichJobDescription({
      title: job.title,
      description: job.description ?? '',
    });

    if (!result) continue;

    if (result.isSpam) {
      await supabase.from('jobs').update({ status: 'closed' }).eq('id', job.id);
      console.log(`[enrich] ${sanitizeLog(job.title)} → SPAM, closed.`);
      spamClosed++;
      continue;
    }

    // If AI confirms remote and current location is empty/unknown, set it.
    if (result.isRemote && (!job.raw_location || job.raw_location.trim() === '')) {
      await supabase.from('jobs').update({ raw_location: 'Remote' }).eq('id', job.id);
    }

    enriched++;
  }

  console.log(`[enrich] Done. ${enriched} enriched, ${spamClosed} spam closed.`);
}
