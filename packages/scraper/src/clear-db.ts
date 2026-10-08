import fs from 'node:fs';
import path from 'node:path';
import { createSupabaseClient } from '@job-me/shared';

function loadEnv(): void {
  const envPaths = [
    path.resolve(process.cwd(), 'packages/scraper/.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'apps/web/.env.local'),
    path.resolve(process.cwd(), '../web/.env.local'),
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
}

/**
 * CLI script to clear jobs and applications data from the database.
 * Run via: pnpm db:clear
 */
async function clearDb(): Promise<void> {
  loadEnv();

  const url = process.env['SUPABASE_URL'] || process.env['VITE_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['VITE_SUPABASE_ANON_KEY'] || process.env['SUPABASE_ANON_KEY'];

  if (!url || !key) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY) must be set in .env files.');
    process.exit(1);
  }

  const supabase = createSupabaseClient(url, key);
  console.log('=== Clearing Database (jobs & applications) ===');

  const { error: appErr } = await supabase
    .from('applications')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (appErr) {
    console.error('Failed to clear applications:', String(appErr.message).replace(/[\r\n]/g, ' '));
  } else {
    console.log('✓ Cleared applications table');
  }

  const { error: jobErr } = await supabase
    .from('jobs')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (jobErr) {
    console.error('Failed to clear jobs:', String(jobErr.message).replace(/[\r\n]/g, ' '));
  } else {
    console.log('✓ Cleared jobs table');
  }

  console.log('=== Database Clear Finished ===');
}

clearDb().catch(err => {
  console.error('[clearDb] Unhandled error:', String(err).replace(/[\r\n]/g, ' '));
  process.exit(1);
});
