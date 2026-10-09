import fs from 'node:fs';
import path from 'node:path';
import { createSupabaseClient } from '@job-me/shared';
import { runScrape } from './pipeline/scrape.js';
import { runEnrich } from './pipeline/enrich.js';
import { runMatch } from './pipeline/match.js';
import { runAutoApply } from './pipeline/auto-apply.js';

/**
 * Loads environment variables from local .env files if not already set.
 * Checks packages/scraper/.env, .env (root), and apps/web/.env.local.
 */
function loadEnv(): void {
  let curr = process.cwd();
  let root = curr;
  while (curr !== path.parse(curr).root) {
    if (fs.existsSync(path.join(curr, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(curr, 'package.json'))) {
      root = curr;
      if (fs.existsSync(path.join(curr, 'pnpm-workspace.yaml'))) break;
    }
    curr = path.dirname(curr);
  }

  const envPaths = [
    path.join(root, '.env.local'),
    path.join(root, '.env'),
    path.resolve(process.cwd(), 'packages/scraper/.env'),
    path.resolve(process.cwd(), 'apps/web/.env.local'),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }

  // Key aliases resolution for seamless single-file root configuration
  if (!process.env['SUPABASE_URL'] && process.env['VITE_SUPABASE_URL']) {
    process.env['SUPABASE_URL'] = process.env['VITE_SUPABASE_URL'];
  }
  if (!process.env['SUPABASE_SERVICE_ROLE_KEY']) {
    process.env['SUPABASE_SERVICE_ROLE_KEY'] =
      process.env['SUPABASE_SECRET_KEY'] ||
      process.env['VITE_SUPABASE_ANON_KEY'] ||
      process.env['SUPABASE_ANON_KEY'];
  }
}

/**
 * Main pipeline entry point.
 * Runs: scrape → enrich (AI) → match → auto-apply in sequence.
 * Exits non-zero on unhandled errors (visible in GitHub Actions tab).
 */
async function main(): Promise<void> {
  loadEnv();

  const url = process.env['SUPABASE_URL'] || process.env['VITE_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['VITE_SUPABASE_ANON_KEY'] || process.env['SUPABASE_ANON_KEY'];

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) must be set in packages/scraper/.env or apps/web/.env.local.'
    );
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
  console.error('[job-me] Unhandled pipeline error:', String(err).replace(/[\r\n]/g, ' '));
  process.exit(1);
});
