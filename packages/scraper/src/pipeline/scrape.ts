import type { SupabaseClient } from '@job-me/shared';
import type { Source, NormalizedJob, Settings } from '@job-me/shared';
import { getOrInitSettings, scoreJob, optionsFromSettings, MATCH_PROMOTION_THRESHOLD } from '@job-me/shared';
import type { JobStatus } from '@job-me/shared';
import { RssConnector } from '../connectors/rss.js';
import { ApiConnector } from '../connectors/api.js';
import { ArbeitnowConnector } from '../connectors/arbeitnow.js';
import { JobicyConnector } from '../connectors/jobicy.js';
import { LinkedInConnector } from '../connectors/linkedin.js';
import { IndeedConnector } from '../connectors/indeed.js';
import { OttaConnector } from '../connectors/otta.js';
import { GlassdoorConnector } from '../connectors/glassdoor.js';
import { GenericWebConnector } from '../connectors/generic-web.js';
import { GreenhouseApiConnector } from '../connectors/greenhouse-api.js';
import { AshbyApiConnector } from '../connectors/ashby-api.js';
import { LeverApiConnector } from '../connectors/lever-api.js';
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
 *      from settings (works for all connector types).
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
    const jobs = await connector.fetch(enrichedSource, settings);

    console.log(`[scrape] ${sanitizeLog(source.name)}: fetched ${jobs.length} job(s).`);

    if (jobs.length > 0) {
      await upsertJobs(supabase, source.id, jobs, settings);
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

const URL_LOOKUP_CHUNK_SIZE = 50;
const WRITE_CHUNK_SIZE = 50;

/**
 * Batch upserts jobs keyed on URL.
 * Never resets a job that's already progressed past 'new' back to 'new' (§8.2).
 *
 * Chunked batch strategy (avoids PostgREST URL/body size limits):
 *   1. Fetch existing job URLs in chunks of 50.
 *   2. Batch INSERT new jobs in chunks of 50.
 *   3. Batch UPDATE description/posted_date for existing jobs in chunks of 50.
 *
 * Descriptions can be several KB each, so smaller write chunks keep requests
 * comfortably below the API gateway body limit.
 */
async function upsertJobs(
  supabase: SupabaseClient,
  sourceId: string,
  jobs: NormalizedJob[],
  settings?: Settings
): Promise<void> {
  const validJobs = jobs.filter(j => j.url);
  if (validJobs.length === 0) return;

  const scoringOptions = settings ? optionsFromSettings(settings) : null;
  const urls = [...new Set(validJobs.map(j => j.url))];

  // 1. Fetch existing URLs in chunks. PostgREST puts `.in()` values in the URL,
  //    so a single query with hundreds of job URLs can exceed the request limit.
  //    Keep the existing values so a source that omits a field on a later scrape
  //    cannot erase a description, location, or posted date we already have.
  type ExistingJob = {
    url: string;
    title: string;
    company: string | null;
    description: string | null;
    posted_date: string | null;
    raw_location: string | null;
  };
  const existingByUrl = new Map<string, ExistingJob>();
  for (const chunk of chunkArray(urls, URL_LOOKUP_CHUNK_SIZE)) {
    const { data: existing, error } = await supabase
      .from('jobs')
      .select('url, title, company, description, posted_date, raw_location')
      .in('url', chunk);

    if (error) {
      throw new Error(`[scrape] Failed to look up existing jobs: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
    }
    for (const row of (existing ?? []) as ExistingJob[]) {
      existingByUrl.set(row.url, row);
    }
  }

  const toInsertRaw = validJobs.filter(j => !existingByUrl.has(j.url));
  const toUpdateRaw = validJobs.filter(j => existingByUrl.has(j.url));

  // Deduplicate new jobs by URL to prevent batch insert key conflicts
  const seenInsert = new Set<string>();
  const toInsert = toInsertRaw.filter(j => {
    if (seenInsert.has(j.url)) return false;
    seenInsert.add(j.url);
    return true;
  });

  // 2. Batch insert new jobs with immediate scoring
  if (toInsert.length > 0) {
    const rows = toInsert.map(job => {
      let score: number | null = null;
      let breakdown: any = null;
      let matchedKeywords: string[] = [];
      let initialStatus: JobStatus = 'new';

      if (scoringOptions) {
        const scored = scoreJob(job, scoringOptions);
        score = scored.score;
        breakdown = scored.breakdown;
        matchedKeywords = [
          ...scored.breakdown.title_match.matched_keywords,
          ...scored.breakdown.skills_overlap.matched_skills,
        ];
        const isMatched = score >= MATCH_PROMOTION_THRESHOLD && scored.breakdown.location.accepted;
        const isLowScore = score < 0.25;
        if (scored.breakdown.negative_keyword_hit || !scored.breakdown.location.accepted || isLowScore) {
          initialStatus = 'closed';
        } else if (isMatched) {
          initialStatus = 'matched';
        }
      }

      return {
        source_id: sourceId,
        title: job.title,
        company: job.company,
        url: job.url,
        posted_date: job.posted_date,
        description: job.description,
        raw_location: job.raw_location,
        status: initialStatus,
        match_score: score,
        match_breakdown: breakdown,
        matched_keywords: matchedKeywords,
      };
    });

    let insertedCount = 0;
    for (const chunk of chunkArray(rows, WRITE_CHUNK_SIZE)) {
      const { error } = await supabase.from('jobs').insert(chunk);
      if (error) {
        console.error(`[scrape] Batch insert error: ${String(error.message).replace(/[\r\n]/g, ' ')}`);
        break;
      }
      insertedCount += chunk.length;
    }
    if (insertedCount > 0) {
      console.log(`[scrape] Inserted and scored ${insertedCount} new job(s).`);
    }
  }

  // 3. Batch update existing jobs — include title, company, source_id, raw_location so Postgres
  //    upsert constraint doesn't throw NOT NULL violations on title.
  if (toUpdateRaw.length > 0) {
    const seenUpdate = new Set<string>();
    const rows = toUpdateRaw
      .filter(u => {
        if (seenUpdate.has(u.url)) return false;
        seenUpdate.add(u.url);
        return true;
      })
      .map(u => {
        const prev = existingByUrl.get(u.url);
        return {
          url: u.url,
          title: u.title?.trim() ? u.title : prev?.title ?? u.title,
          company: u.company?.trim() ? u.company : prev?.company ?? null,
          source_id: sourceId,
          raw_location: u.raw_location?.trim() ? u.raw_location : prev?.raw_location ?? null,
          description: u.description?.trim() ? u.description : prev?.description ?? null,
          posted_date: u.posted_date?.trim() ? u.posted_date : prev?.posted_date ?? null,
        };
      });

    let updatedCount = 0;
    for (const chunk of chunkArray(rows, WRITE_CHUNK_SIZE)) {
      const { error: upsertErr } = await supabase.from('jobs').upsert(chunk, { onConflict: 'url' });
      if (upsertErr) {
        console.error(`[scrape] Batch update error: ${String(upsertErr.message).replace(/[\r\n]/g, ' ')}`);
        break;
      }
      updatedCount += chunk.length;
    }
    if (updatedCount > 0) {
      console.log(`[scrape] Updated ${updatedCount} existing job(s).`);
    }
  }
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Parses a source URL hostname without throwing on malformed configuration. */
function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function getConnector(source: Source): Connector {
  const host = sourceHostname(source.base_url);
  if (source.type === 'greenhouse' || hostMatchesDomain(host, 'greenhouse.io')) return new GreenhouseApiConnector();
  if (source.type === 'ashby' || hostMatchesDomain(host, 'ashbyhq.com')) return new AshbyApiConnector();
  if (source.type === 'lever' || hostMatchesDomain(host, 'lever.co')) return new LeverApiConnector();
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

