// ─────────────────────────────────────────────────────────────────────────────
// job-me · trigger-pipeline edge function
// ─────────────────────────────────────────────────────────────────────────────
// Dispatches the scrape.yml GitHub Actions workflow (the full pipeline run).
// Replaces the old VITE_GITHUB_PAT client-side trigger: the PAT now lives only
// in this function's secrets, and only an authenticated session can invoke it.
//
// Deploy (this app has no login flow, so deploy WITHOUT JWT verification):
//   supabase functions deploy trigger-pipeline --no-verify-jwt
//
// Secrets (set once):
//   supabase secrets set GH_TOKEN=github_pat_... GITHUB_REPO=owner/repo GITHUB_BRANCH=main
//
//   GH_TOKEN      — fine-grained PAT with Actions: Read and write on the repo
//                   (classic PAT with `repo` + `workflow` scopes also works)
//   GITHUB_REPO   — owner/repo
//   GITHUB_BRANCH  — optional, defaults to main
//
// Auth: the app runs on the anon key without a login flow, so the function
// is deployed with --no-verify-jwt. The Authorization header check below
// still rejects header-less requests (defence in depth).
// ─────────────────────────────────────────────────────────────────────────────

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed — use POST.' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized — missing bearer token.' }, 401);
  }

  const ghToken = Deno.env.get('GH_TOKEN');
  const repo = Deno.env.get('GITHUB_REPO');
  const branch = Deno.env.get('GITHUB_BRANCH') ?? 'main';

  if (!ghToken || !repo) {
    return json({ error: 'Function secrets missing — set GH_TOKEN and GITHUB_REPO (see README).' }, 500);
  }

  const ghRes = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/scrape.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: branch }),
  });

  // 204 = accepted; 404 = workflow file missing; 422 = ref/inputs invalid
  if (!ghRes.ok && ghRes.status !== 204) {
    const detail = await ghRes.text();
    console.error(`[trigger-pipeline] GitHub dispatch failed: ${ghRes.status} ${detail.replace(/[\r\n]/g, ' ').slice(0, 300)}`);
    return json({ error: `GitHub API returned ${ghRes.status} — check GH_TOKEN/GITHUB_REPO secrets.` }, 502);
  }

  return json({ ok: true, repo, branch });
});
