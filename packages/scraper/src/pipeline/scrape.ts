import type { SupabaseClient } from '@job-me/shared';
import type { Source, NormalizedJob } from '@job-me/shared';
import { RssConnector } from '../connectors/rss.js';
import { ApiConnector } from '../connectors/api.js';
import type { Connector } from '../connectors/base.js';

/**
 * Scrape pipeline step — §8.2.
 * Fetches all active sources, calls the right connector, upserts to jobs.
 * Per-source failure isolation: one broken source never stops the rest.
 */
export async function runScrape(supabase: SupabaseClient): Promise<void> {
  const { data: sources, error } = await supabase
    .from('sources')
    .select('*')
    .eq('active', true);

  if (error) throw new Error(`Failed to fetch sources: ${error.message}`);
  if (!sources || sources.length === 0) {
    console.log('[scrape] No active sources.');
    return;
  }

  console.log(`[scrape] Running ${sources.length} source(s).`);

  for (const source of sources as Source[]) {
    await scrapeSource(supabase, source);
  }

  console.log('[scrape] Done.');
}

async function scrapeSource(supabase: SupabaseClient, source: Source): Promise<void> {
  const scrapedAt = new Date().toISOString();

  try {
    const connector = getConnector(source);
    const jobs = await connector.fetch(source);

    console.log(`[scrape] ${source.name}: fetched ${jobs.length} job(s).`);

    if (jobs.length > 0) {
      await upsertJobs(supabase, source.id, jobs);
    }

    // Update source: success
    await supabase.from('sources').update({
      last_scraped_at: scrapedAt,
      last_scrape_status: 'success',
      last_scrape_error: null,
    }).eq('id', source.id);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scrape] ${source.name}: FAILED — ${message}`);

    // Update source: failure. Continue to next source.
    await supabase.from('sources').update({
      last_scraped_at: scrapedAt,
      last_scrape_status: 'failed',
      last_scrape_error: message,
    }).eq('id', source.id);
  }
}

/**
 * Upserts jobs keyed on URL.
 * Never resets a job that's already progressed past 'new' back to 'new' (§8.2).
 */
async function upsertJobs(
  supabase: SupabaseClient,
  sourceId: string,
  jobs: NormalizedJob[]
): Promise<void> {
  for (const job of jobs) {
    if (!job.url) continue;

    // Check if job already exists
    const { data: existing } = await supabase
      .from('jobs')
      .select('id, status')
      .eq('url', job.url)
      .maybeSingle();

    if (existing) {
      // Update description/posted_date only — do not reset status
      await supabase.from('jobs').update({
        description: job.description,
        posted_date: job.posted_date,
      }).eq('id', (existing as { id: string }).id);
    } else {
      // Insert new job
      await supabase.from('jobs').insert({
        source_id: sourceId,
        title: job.title,
        company: job.company,
        url: job.url,
        posted_date: job.posted_date,
        description: job.description,
        status: 'new',
        matched_keywords: [],
        raw_location: job.raw_location,
      });
    }
  }
}

function getConnector(source: Source): Connector {
  if (source.type === 'rss') return new RssConnector();
  if (source.type === 'api') return new ApiConnector();
  throw new Error(`Unknown source type: ${source.type}`);
}
