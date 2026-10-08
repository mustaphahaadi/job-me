import type { SupabaseClient } from '@job-me/shared';
import type { Source, NormalizedJob, Settings } from '@job-me/shared';
import { getOrInitSettings } from '@job-me/shared';
import { RssConnector } from '../connectors/rss.js';
import { ApiConnector } from '../connectors/api.js';
import { ArbeitnowConnector } from '../connectors/arbeitnow.js';
import { JobicyConnector } from '../connectors/jobicy.js';
import { LinkedInConnector } from '../connectors/linkedin.js';
import { IndeedConnector } from '../connectors/indeed.js';
import { OttaConnector } from '../connectors/otta.js';
import { GlassdoorConnector } from '../connectors/glassdoor.js';
import { GenericWebConnector } from '../connectors/generic-web.js';
import { applySettingsToSource, sanitizeLog } from '../connectors/utils.js';
import type { Connector } from '../connectors/base.js';

/**
 * Scrape pipeline step — §8.2.
 * Fetches all active sources, calls the right connector, upserts to jobs.
 * Per-source failure isolation: one broken source never stops the rest.
 *
 * Every source is scraped with the /settings configuration applied:
 *   1. {roles} / {role} / {locations} / {location} / {days}
 *      placeholders in base_url and query_params are substituted
 *      from settings (works for all 9 connector types).
 *   2. Sources with no query_params at all get settings-derived
 *      defaults (first target role, first accepted location,
 *      days_posted_default recency window).
 */
export async function runScrape(supabase: SupabaseClient): Promise<void> {
  const settings = await getOrInitSettings(supabase);
  const { data: sources, error } = await supabase
    .from('sources')
    .select('*')
    .eq('active', true);

  if (error) throw new Error(`Failed to fetch sources: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
  if (!sources || sources.length === 0) {
    console.log('[scrape] No active sources found in database. Add job sources on the /sources page or insert rows into the sources table.');
    return;
  }

  console.log(`[scrape] Running ${sources.length} source(s).`);

  for (const source of sources as Source[]) {
    await scrapeSource(supabase, source, settings);
  }

  console.log('[scrape] Done.');
}

async function scrapeSource(supabase: SupabaseClient, source: Source, settings: Settings): Promise<void> {
  const scrapedAt = new Date().toISOString();

  // 1. Apply /settings — substitute placeholders in base_url and
  //    query_params so the source follows the Settings page.
  let enrichedSource = applySettingsToSource(source, settings);

  // 2. Still no query_params? Derive defaults from settings.
  const params = { ...(enrichedSource.query_params as Record<string, unknown>) };
  if (Object.keys(params).length === 0) {
    Object.assign(params, settingsDerivedParams(source.type, settings));
  }
  enrichedSource = { ...enrichedSource, query_params: params };

  try {
    const connector = getConnector(enrichedSource);
    const jobs = await connector.fetch(enrichedSource);

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
 * Settings-derived default query params for sources with no
 * configuration of their own. Uses the first target role and
 * first accepted location so unconfigured sources still track
 * the Settings page.
 */
function settingsDerivedParams(type: Source['type'], settings: Settings): Record<string, string> {
  const role = settings.target_roles?.[0] ?? 'Software Engineer';
  const location = settings.accepted_locations?.[0] ?? '';
  const days = settings.days_posted_default ?? 14;
  const locations = (settings.accepted_locations ?? []).map(l => l.toLowerCase());
  const remoteAccepted = locations.length === 0 ||
    locations.some(l => ['remote', 'worldwide', 'anywhere', 'global'].includes(l));

  switch (type) {
    case 'jobicy':
      return { tag: role.toLowerCase().split(/\s+/)[0] ?? role, count: '50' };
    case 'arbeitnow':
      return { search: role };
    case 'linkedin': {
      // f_TPR recency window follows days_posted_default:
      // ≤1 day → 24h, ≤7 days → 7d, otherwise 30d.
      const f_TPR = days <= 1 ? 'r86400' : days <= 7 ? 'r604800' : 'r2592000';
      return { keywords: role, location: location || 'Worldwide', f_WT: '2', f_TPR };
    }
    case 'indeed':
      return { q: role, l: location || 'Remote', sort: 'date', fromage: String(days) };
    case 'glassdoor':
      return { keyword: role, location: location || 'Remote' };
    case 'api':
      // Generic REST — 'search' is understood by Remotive and
      // ignored harmlessly by APIs that don't support it.
      return { search: role };
    case 'otta':
      return { remote: remoteAccepted ? 'true' : 'false', limit: '50' };
    default:
      // rss / generic_web: feeds and pages have fixed URLs — use
      // {role}/{location} placeholders in base_url instead.
      return {};
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
    if (error) console.error(`[scrape] Batch insert error: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
    else console.log(`[scrape] Inserted ${toInsert.length} new job(s).`);
  }

  // 3. Batch update existing jobs — description and posted_date only; never touch status.
  //    One upsert on the unique `url` key instead of N per-row UPDATEs; Postgres only
  //    SETs columns present in the payload, so status/score columns are untouched.
  if (toUpdate.length > 0) {
    const seen = new Set<string>();
    const rows = toUpdate
      .filter(u => {
        if (seen.has(u.url)) return false;
        seen.add(u.url);
        return true;
      })
      .map(u => ({ url: u.url, description: u.description, posted_date: u.posted_date }));

    const { error: upsertErr } = await supabase.from('jobs').upsert(rows, { onConflict: 'url' });
    if (upsertErr) {
      console.error(`[scrape] Batch update error: ${String(upsertErr.message).replace(/[\r\n]/g, ' ')}`);
    } else {
      console.log(`[scrape] Updated ${rows.length} existing job(s).`);
    }
  }
}

function getConnector(source: Source): Connector {
  if (source.type === 'rss') return new RssConnector();
  if (source.type === 'api') return new ApiConnector();
  if (source.type === 'arbeitnow') return new ArbeitnowConnector();
  if (source.type === 'jobicy') return new JobicyConnector();
  if (source.type === 'linkedin') return new LinkedInConnector();
  if (source.type === 'indeed') return new IndeedConnector();
  if (source.type === 'otta') return new OttaConnector();
  if (source.type === 'glassdoor') return new GlassdoorConnector();
  if (source.type === 'generic_web') return new GenericWebConnector();
  throw new Error(`Unknown source type: ${source.type}`);
}

