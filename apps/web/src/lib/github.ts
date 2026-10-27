import { supabase } from './supabase';

/**
 * Triggers the scrape.yml GitHub Actions workflow via the `trigger-pipeline`
 * Supabase Edge Function.
 *
 * The GitHub PAT lives only in the Edge Function's secrets (GH_TOKEN,
 * GITHUB_REPO, GITHUB_BRANCH). It must never be exposed through a VITE_*
 * variable: Vite inlines those into the public browser bundle, which would
 * hand anyone who loads the dashboard a repo-scoped token.
 *
 * Deploy the function once:
 *   supabase functions deploy trigger-pipeline --no-verify-jwt
 *   supabase secrets set GH_TOKEN=... GITHUB_REPO=owner/repo GITHUB_BRANCH=main
 *
 * Returns true when the function accepted the dispatch.
 */
export async function triggerScrapeNow(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('trigger-pipeline', {
    method: 'POST',
  });

  if (error) {
    console.error('Pipeline trigger failed:', error.message);
    alert(
      `Failed to trigger scrape: ${error.message}. ` +
      'Check that the trigger-pipeline Edge Function is deployed and GH_TOKEN/GITHUB_REPO are set.'
    );
    return false;
  }

  if (data && typeof data === 'object' && 'error' in data) {
    const message = String((data as { error?: unknown }).error ?? 'Unknown error');
    console.error('Pipeline trigger rejected:', message);
    alert(`Failed to trigger scrape: ${message}`);
    return false;
  }

  return true;
}
