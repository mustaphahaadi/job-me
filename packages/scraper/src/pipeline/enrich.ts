import type { SupabaseClient, Job } from '@job-me/shared';
import { enrichJobDescription } from '@job-me/shared';
import { sanitizeLog } from '../connectors/utils.js';

/**
 * Enrich pipeline step — runs between scrape and match.
 *
 * For each un-enriched 'new' or 'matched' job with a description, calls the AI
 * (via OpenRouter) to:
 *   1. Detect spam / fake postings → immediately close them
 *   2. Confirm remote status → set raw_location to 'Remote' when empty
 *
 * 'matched' jobs are included because scrape pre-promotes high-scoring jobs;
 * scanning only 'new' meant those jobs never reached the spam filter. The
 * `enriched_at` marker prevents re-enriching the same job on every run.
 *
 * The description is intentionally never modified: prepending an AI summary on
 * every run stacked duplicate text and AI-generated wording inflated the skills
 * signal during scoring. The description stays exactly what the source published.
 *
 * Gracefully skips if OPENROUTER_API_KEY is not set — pipeline continues unaffected.
 * Rate-limited to stay within free-tier request budgets.
 */
export async function runEnrich(supabase: SupabaseClient): Promise<void> {
  if (!process.env['OPENROUTER_API_KEY']?.trim()) {
    console.log('[enrich] OPENROUTER_API_KEY not set — skipping AI enrichment.');
    return;
  }

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, title, description, raw_location')
    .in('status', ['new', 'matched'])
    .not('description', 'is', null)
    .neq('description', '')
    .is('enriched_at', null)
    // Newest first: a persistent AI failure on old jobs must not consume the
    // whole batch every run and starve freshly scraped postings.
    .order('scraped_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(60); // stay within free-tier rate limits over ~4 min window

  if (error) throw new Error(`[enrich] Failed to fetch jobs: ${error.message}`);
  if (!jobs || jobs.length === 0) {
    console.log('[enrich] No un-enriched jobs found.');
    return;
  }

  console.log(`[enrich] Enriching ${jobs.length} job(s) via OpenRouter.`);

  let enriched = 0;
  let spamClosed = 0;

  for (const job of jobs as Pick<Job, 'id' | 'title' | 'description' | 'raw_location'>[]) {
    if (!job.description?.trim()) {
      // Whitespace-only descriptions cannot be analysed; mark them so they do
      // not occupy a slot in every future enrich run.
      await supabase.from('jobs').update({ enriched_at: new Date().toISOString() }).eq('id', job.id);
      continue;
    }

    // Rate limit: 1 request every 4 seconds to stay strictly within free-tier limits
    await new Promise(r => setTimeout(r, 4000));

    const result = await enrichJobDescription({
      title: job.title,
      description: job.description ?? '',
    });

    if (!result) continue;

    const enrichedAt = new Date().toISOString();

    if (result.isSpam) {
      await supabase.from('jobs').update({ status: 'closed', enriched_at: enrichedAt }).eq('id', job.id);
      console.log(`[enrich] ${sanitizeLog(job.title)} → SPAM, closed.`);
      spamClosed++;
      continue;
    }

    // If AI confirms remote and the current location is empty or a placeholder,
    // set it to Remote so the location signal is unambiguous.
    const updates: Record<string, string> = { enriched_at: enrichedAt };
    const currentLocation = (job.raw_location ?? '').trim().toLowerCase();
    const unknownLocation = currentLocation === '' || [
      'unknown', 'n/a', 'na', '-', 'not specified', 'unspecified',
    ].includes(currentLocation);
    if (result.isRemote && unknownLocation) {
      updates['raw_location'] = 'Remote';
    }
    await supabase.from('jobs').update(updates).eq('id', job.id);

    enriched++;
  }

  console.log(`[enrich] Done. ${enriched} enriched, ${spamClosed} spam closed.`);
}
