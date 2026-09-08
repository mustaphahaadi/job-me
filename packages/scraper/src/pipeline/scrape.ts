import type { SupabaseClient } from '@job-me/shared';
import type { Source, NormalizedJob } from '@job-me/shared';
import { RssConnector } from '../connectors/rss.js';
import { ApiConnector } from '../connectors/api.js';
import { sanitizeLog } from '../connectors/utils.js';
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
    console.log('[scrape] No active sources found in database. Add job sources on the /sources page or insert rows into the sources table.');
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

    console.log(`[scrape] ${sanitizeLog(source.name)}: fetched ${jobs.length} job(s).`);

    if (jobs.length > 0) {
      await upsertJobs(supabase, source.id, jobs);
    }

    // Update source: success — reset consecutive fail count
    await supabase.from('sources').update({
      last_scraped_at: scrapedAt,
      last_scrape_status: 'success',
      last_scrape_error: null,
      consecutive_fail_count: 0,
    }).eq('id', source.id);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[scrape] ${sanitizeLog(source.name)}: FAILED — ${sanitizeLog(message)}`);

    // Update source: failure — increment consecutive fail count. Continue to next source.
    await supabase.from('sources').update({
      last_scraped_at: scrapedAt,
      last_scrape_status: 'failed',
      last_scrape_error: message,
      consecutive_fail_count: (source.consecutive_fail_count ?? 0) + 1,
    }).eq('id', source.id);
  }
}

/**
 * Batch upserts jobs keyed on URL.
 * Never resets a job that's already progressed past 'new' back to 'new' (§8.2).
 *
 * Strategy (3 queries instead of 2N):
 *   1. Fetch all existing job URLs for this source in one query.
 *   2. Batch INSERT new jobs.
 *   3. Batch UPDATE description/posted_date for existing jobs.
 */
async function upsertJobs(
  supabase: SupabaseClient,
  sourceId: string,
  jobs: NormalizedJob[]
): Promise<void> {
  const validJobs = jobs.filter(j => j.url);
  if (validJobs.length === 0) return;

  const urls = validJobs.map(j => j.url);

  // 1. Fetch existing URLs in one query
  const { data: existing } = await supabase
    .from('jobs')
    .select('id, url')
    .in('url', urls);

  const existingUrlSet = new Set((existing ?? []).map((r: { url: string }) => r.url));
  const existingById = Object.fromEntries(
    (existing ?? []).map((r: { id: string; url: string }) => [r.url, r.id])
  );

  const toInsert = validJobs.filter(j => !existingUrlSet.has(j.url));
  const toUpdate = validJobs.filter(j => existingUrlSet.has(j.url));

  // 2. Batch insert new jobs
  if (toInsert.length > 0) {
    const rows = toInsert.map(job => ({
      source_id: sourceId,
      title: job.title,
      company: job.company,
      url: job.url,
      posted_date: job.posted_date,
      description: job.description,
      raw_location: job.raw_location,
      status: 'new',
      matched_keywords: [],
    }));
    const { error } = await supabase.from('jobs').insert(rows);
    if (error) console.error(`[scrape] Batch insert error: ${error.message}`);
    else console.log(`[scrape] Inserted ${toInsert.length} new job(s).`);
  }

  // 3. Batch update existing jobs — description and posted_date only; never touch status
  if (toUpdate.length > 0) {
    const updates = toUpdate.map(job => ({
      id: existingById[job.url] as string,
      description: job.description,
      posted_date: job.posted_date,
    }));
    // Supabase JS doesn't support batch updates natively; use Promise.all with small batches
    // to avoid hitting query limits. Still far fewer calls than N+1.
    const BATCH = 20;
    for (let i = 0; i < updates.length; i += BATCH) {
      const slice = updates.slice(i, i + BATCH);
      await Promise.all(slice.map(u =>
        supabase.from('jobs').update({
          description: u.description,
          posted_date: u.posted_date,
        }).eq('id', u.id)
      ));
    }
    console.log(`[scrape] Updated ${toUpdate.length} existing job(s).`);
  }
}

function getConnector(source: Source): Connector {
  if (source.type === 'rss') return new RssConnector();
  if (source.type === 'api') return new ApiConnector();
  throw new Error(`Unknown source type: ${source.type}`);
}

