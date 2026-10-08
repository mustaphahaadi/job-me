import { supabase } from './supabase';

/**
 * Triggers a pipeline run via the `trigger-pipeline` Supabase Edge Function
 * (supabase/functions/trigger-pipeline), which dispatches the scrape.yml
 * GitHub Actions workflow server-side.
 *
 * The GitHub PAT lives only in the edge function's secrets (GH_TOKEN,
 * GITHUB_REPO, GITHUB_BRANCH) — never in the frontend bundle. The app
 * has no login flow, so the function must be deployed with
 * --no-verify-jwt (see README "Step 2.1"). This is what the
 * "Run now" button on /sources calls.
 */
export async function triggerScrapeNow(): Promise<void> {
  const { error } = await supabase.functions.invoke('trigger-pipeline', { body: {} });

  if (error) {
    console.error('trigger-pipeline failed:', error.message);
    alert(
      'Failed to trigger the pipeline.\n\n' +
      `Reason: ${error.message}\n\n` +
      'The trigger-pipeline edge function must be deployed without JWT\n' +
      'verification (the app has no login flow):\n' +
      '  supabase functions deploy trigger-pipeline --no-verify-jwt\n' +
      '  supabase secrets set GH_TOKEN=... GITHUB_REPO=owner/repo\n' +
      '(see README, Step 2.1)'
    );
  }
}
