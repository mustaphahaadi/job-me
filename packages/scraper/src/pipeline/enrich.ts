import type { SupabaseClient, Job } from '@job-me/shared';
import { enrichJobDescription } from '@job-me/shared';
import { sanitizeLog } from '../connectors/utils.js';

/**
 * Enrich pipeline step — runs between scrape and match.
 *
 * For each 'new' job with a description, calls Gemini to:
 *   1. Detect spam / fake postings → immediately close them
 *   2. Confirm remote status → update raw_location if AI says remote
 *   3. Extract seniority signal → stored in description for the scorer to pick up
 *
 * Gracefully skips if GEMINI_API_KEY is not set — pipeline continues unaffected.
 * Rate-limited to avoid hitting Gemini free tier limits (15 req/min).
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
    .limit(60); // stay within 15 req/min over ~4 min window

  if (error) throw new Error(`[enrich] Failed to fetch jobs: ${error.message}`);
  if (!jobs || jobs.length === 0) {
    console.log('[enrich] No new jobs to enrich.');
    return;
  }

  console.log(`[enrich] Enriching ${jobs.length} job(s) via Gemini.`);

  let enriched = 0;
  let spamClosed = 0;

  for (const job of jobs as Pick<Job, 'id' | 'title' | 'description' | 'raw_location'>[]) {
    // Rate limit: 1 request every 4 seconds (4000ms) to stay strictly within Gemini free tier limit (15 req/min)
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

    const updates: Record<string, unknown> = {};

    // If AI confirms remote and current location is empty/unknown, set it
    if (result.isRemote && (!job.raw_location || job.raw_location.trim() === '')) {
      updates['raw_location'] = 'Remote';
    }

    // Prepend clean summary to description so the scorer sees richer text
    if (result.cleanSummary) {
      updates['description'] = `${result.cleanSummary}\n\n${job.description ?? ''}`;
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('jobs').update(updates).eq('id', job.id);
    }

    enriched++;
  }

  console.log(`[enrich] Done. ${enriched} enriched, ${spamClosed} spam closed.`);
}
