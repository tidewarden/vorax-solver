// The repo's loops on GitHub, started on time by Cloudflare's cron triggers (wrangler.jsonc "triggers"): GitHub's
// own scheduler fired the hourly jobs about once every two hours, then stopped. Each trigger asks GitHub to start
// a workflow on main, with GITHUB_DISPATCH_TOKEN. The workflows keep their own schedules as a backup.
// The code is in a private repo (since 2026-10-22), so the dashboard's reads go through here too, with the same
// token: a fine-grained token for that repo only, with Actions: read and write and Contents: read.
// The live data, the daily check and the smarter player ran on the owner's PC (scripts/nightly.sh) until they
// stopped on 2026-10-29; only the dashboard's numbers are worked out here every 2 hours (dashboard.yml).

const REPO = 'tidewarden/vorax-solver'

/** The workflows each cron trigger starts. */
export const SCHEDULE: Record<string, string[]> = {
  '33 4 * * *': ['issue-fixer.yml'],
  '17 */2 * * *': ['dashboard.yml'],
}

/** The workflows the dashboard's Run now may start (not the app release: that needs its version tag). */
export const RUNNABLE = new Set(['issue-fixer.yml', 'dashboard.yml', 'deploy.yml'])

/** The workflows whose runs the dashboard lists. */
export const LISTED = new Set([...RUNNABLE, 'desktop.yml'])

/** The repo's files the dashboard reads, by name. */
export const FILES: Record<string, string> = {
  history: 'data/live/history.jsonl',
  smarter: 'data/sim/smarter-history.jsonl',
  nightly: 'data/live/nightly.jsonl',
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const headers = (token: string, accept = 'application/vnd.github+json') => ({
  authorization: `Bearer ${token}`, accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'vorax-live',
})

/** Asks GitHub to start a workflow on main; null when it did, else why not. */
export async function dispatch(file: string, token: string | undefined, fetcher: Fetch = fetch): Promise<string | null> {
  if (!token) return 'no GITHUB_DISPATCH_TOKEN'
  const res = await fetcher(`https://api.github.com/repos/${REPO}/actions/workflows/${file}/dispatches`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ ref: 'main' }),
  })
  return res.ok ? null : `GitHub answered ${res.status}: ${(await res.text()).slice(0, 200)}`
}

/** One of FILES on main, as GitHub answers it (the raw text when it's there). */
export async function repoFile(name: string, token: string | undefined, fetcher: Fetch = fetch): Promise<Response> {
  if (!token) return new Response('no GITHUB_DISPATCH_TOKEN', { status: 503 })
  return fetcher(`https://api.github.com/repos/${REPO}/contents/${FILES[name]}?ref=main`, { headers: headers(token, 'application/vnd.github.raw') })
}

/** A workflow's latest runs, as GitHub answers them. */
export async function repoRuns(file: string, token: string | undefined, fetcher: Fetch = fetch): Promise<Response> {
  if (!token) return new Response('no GITHUB_DISPATCH_TOKEN', { status: 503 })
  return fetcher(`https://api.github.com/repos/${REPO}/actions/workflows/${file}/runs?per_page=20`, { headers: headers(token) })
}

export async function onSchedule(cron: string, env: { GITHUB_DISPATCH_TOKEN?: string }, fetcher: Fetch = fetch): Promise<void> {
  if (!env.GITHUB_DISPATCH_TOKEN) return
  for (const file of SCHEDULE[cron] ?? []) {
    const why = await dispatch(file, env.GITHUB_DISPATCH_TOKEN, fetcher)
    if (why) console.log(`starting ${file} failed: ${why}`)
  }
}
