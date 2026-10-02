import { createSupabaseClient } from '@job-me/shared';

/**
 * CLI script to clear jobs and applications data from the database.
 * Run via: pnpm db:clear
 */
async function clearDb(): Promise<void> {
  const url = process.env['SUPABASE_URL'] || process.env['VITE_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['VITE_SUPABASE_ANON_KEY'] || process.env['SUPABASE_ANON_KEY'];

  if (!url || !key) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY) must be set.');
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
