import { createSupabaseClient } from '@job-me/shared';
import { runScrape } from './pipeline/scrape.js';
import { runEnrich } from './pipeline/enrich.js';
import { runMatch } from './pipeline/match.js';
import { runAutoApply } from './pipeline/auto-apply.js';

/**
 * Main pipeline entry point.
 * Runs: scrape → enrich (AI) → match → auto-apply in sequence.
 * Exits non-zero on unhandled errors (visible in GitHub Actions tab).
 */
async function main(): Promise<void> {
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }

  const supabase = createSupabaseClient(url, key);

  console.log('=== [job-me] Pipeline started ===');
  const start = Date.now();

  await runScrape(supabase);
  await runEnrich(supabase);   // AI: spam filter + remote detection (skipped if no GEMINI_API_KEY)
  await runMatch(supabase);
  await runAutoApply(supabase);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`=== [job-me] Pipeline complete (${elapsed}s) ===`);
}

main().catch(err => {
  console.error('[job-me] Unhandled pipeline error:', err);
  process.exit(1);
});
