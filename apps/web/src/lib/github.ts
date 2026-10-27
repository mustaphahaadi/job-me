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
 * Manual triggering is optional. The Sources page asks the function whether
 * it is configured and hides the controls when it is not, so deployments that
 * only use the 6-hour schedule never show setup errors to end users.
 */

/** Returns true when the server-side manual trigger is deployed and configured. */
export async function getTriggerAvailability(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('trigger-pipeline', {
    method: 'GET',
  });

  if (error) return false;
  return Boolean(
    data &&
    typeof data === 'object' &&
    (data as { configured?: unknown }).configured === true
  );
}

/**
 * Returns true when the function accepted the dispatch. Detailed errors stay
 * in the console; the Sources page shows a plain-language fallback message.
 */
export async function triggerScrapeNow(): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('trigger-pipeline', {
    method: 'POST',
  });

  if (error) {
    console.error('Pipeline trigger failed:', error.message);
    return false;
  }

  if (data && typeof data === 'object' && 'error' in data) {
    console.error(
      'Pipeline trigger rejected:',
      String((data as { error?: unknown }).error ?? 'Unknown error')
    );
    return false;
  }

  return true;
}
