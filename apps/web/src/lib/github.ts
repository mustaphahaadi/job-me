import { supabase } from './supabase';

/**
 * Triggers a pipeline run via the `trigger-pipeline` Supabase Edge Function
 * (supabase/functions/trigger-pipeline), which dispatches the scrape.yml
 * GitHub Actions workflow server-side.
 *
 * The GitHub PAT lives only in the edge function's secrets (GH_TOKEN,
 * GITHUB_REPO, GITHUB_BRANCH) — never in the frontend bundle. The function
 * requires the caller's authenticated session, so only a signed-in owner can
 * trigger runs. This is what the "Run now" button on /sources calls.
 */
export async function triggerScrapeNow(): Promise<void> {
  const { error } = await supabase.functions.invoke('trigger-pipeline', { body: {} });

  if (error) {
    console.error('trigger-pipeline failed:', error.message);
    alert(
      'Failed to trigger the pipeline.\n\n' +
      `Reason: ${error.message}\n\n` +
      'If the function is not deployed yet, run:\n' +
      '  supabase functions deploy trigger-pipeline\n' +
      'and set the GH_TOKEN / GITHUB_REPO secrets (see README).'
    );
  }
}
