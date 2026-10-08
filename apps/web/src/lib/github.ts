/**
 * Triggers a GitHub Actions workflow_dispatch event for the
 * scrape.yml workflow — the default trigger mechanism.
 *
 * Uses a GitHub PAT from the frontend environment (VITE_GITHUB_PAT,
 * VITE_GITHUB_REPO, VITE_GITHUB_BRANCH). The PAT must have
 * `repo` + `workflow` scopes (or Actions: Read and write on a
 * fine-grained token). This is what the "Run now" button on
 * /sources calls.
 *
 * Returns true when the workflow was accepted by GitHub.
 *
 * More secure alternative (optional, for technical setups): the
 * `trigger-pipeline` Supabase Edge Function keeps the PAT
 * server-side — see README "Step 2.1". Both write the same
 * workflow_dispatch event; the button works with either.
 */
export async function triggerScrapeNow(): Promise<boolean> {
  const pat = import.meta.env['VITE_GITHUB_PAT'] as string | undefined;
  const repo = import.meta.env['VITE_GITHUB_REPO'] as string | undefined; // format: owner/repo

  if (!pat || !repo) {
    alert(
      'Run now is not configured. Set VITE_GITHUB_PAT and VITE_GITHUB_REPO in your environment to enable this.'
    );
    return false;
  }

  const [owner, repoName] = repo.split('/');
  const branch = (import.meta.env['VITE_GITHUB_BRANCH'] as string | undefined) ?? 'main';
  const url = `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/scrape.yml/dispatches`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: branch }),
  });

  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    const safeText = text.replace(/[\r\n]/g, ' ').slice(0, 200);
    console.error('GitHub dispatch failed:', res.status, safeText);
    alert(`Failed to trigger scrape: ${res.status} ${res.statusText}. Check the browser console.`);
    return false;
  }

  return true;
}
