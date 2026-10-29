// @vitest-environment node
import { onSchedule, SCHEDULE } from '../../worker/src/schedule'

const API = 'https://api.github.com/repos/tidewarden/vorax-solver'

describe('the collector starts the repo’s loops on time (GitHub’s own scheduler proved unreliable)', () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(null, { status: 204 })))
  beforeEach(() => (calls.length = 0))

  it('the issue fixer and the live data nightly, the dashboard’s numbers every 2 hours (nothing runs on the PC since 2026-10-29)', () => {
    expect(SCHEDULE).toEqual({ '33 4 * * *': ['issue-fixer.yml', 'live-data.yml'], '17 */2 * * *': ['dashboard.yml'] })
  })
  it('every cron the schedule uses is one Cloudflare fires (wrangler.jsonc)', async () => {
    const { readFileSync } = await import('node:fs')
    const crons = JSON.parse(readFileSync('worker/wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '')).triggers.crons
    expect([...crons].sort()).toEqual(Object.keys(SCHEDULE).sort())
  })

  it('asks GitHub to start each workflow due, on main, with the dispatch token', async () => {
    await onSchedule('33 4 * * *', { GITHUB_DISPATCH_TOKEN: 'tok' }, fetch as never)
    expect(calls.map(c => c.url)).toEqual([`${API}/actions/workflows/issue-fixer.yml/dispatches`, `${API}/actions/workflows/live-data.yml/dispatches`])
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ ref: 'main' })
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('does nothing without the token, or for a time with nothing due', async () => {
    await onSchedule('33 4 * * *', {}, fetch as never)
    await onSchedule('59 * * * *', { GITHUB_DISPATCH_TOKEN: 'tok' }, fetch as never)
    expect(calls).toHaveLength(0)
  })
})

describe('Run now, from the dashboard', () => {
  const env = { EXPORT_TOKEN: 'x', IP_SALT: 's', COLLECTING: 'on', DASHBOARD_TOKEN: 'pw', GITHUB_DISPATCH_TOKEN: 'tok', LIMIT: { limit: async () => ({ success: true }) } }
  const run = (file: string, pw = 'pw') => new Request(`https://w.dev/v1/run/${file}`, { method: 'POST', headers: { authorization: `Bearer ${pw}` } })

  it('starts a loop’s workflow, with the dashboard password', async () => {
    const { handle } = await import('../../worker/src/index')
    const calls: string[] = []
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (calls.push(String(url)), new Response(null, { status: 204 })))
    try {
      const res = await handle(run('deploy.yml'), env, {} as never)
      expect(res.status).toBe(200)
      expect(calls).toEqual([`${API}/actions/workflows/deploy.yml/dispatches`])
    } finally {
      fetcher.mockRestore()
    }
  })
  it('refuses without the password, and any workflow that isn’t a loop (a release needs its tag)', async () => {
    const { handle } = await import('../../worker/src/index')
    expect((await handle(run('deploy.yml', 'nope'), env, {} as never)).status).toBe(401)
    expect((await handle(run('desktop.yml'), env, {} as never)).status).toBe(404)
    expect((await handle(run('smarter.yml'), env, {} as never)).status).toBe(404)
  })
  it('says why when GitHub refuses (a missing or wrong token)', async () => {
    const { handle } = await import('../../worker/src/index')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad credentials', { status: 401 }))
    try {
      const res = await handle(run('issue-fixer.yml'), env, {} as never)
      expect(res.status).toBe(502)
      expect((await res.json()).error).toMatch(/401.*Bad credentials/)
    } finally {
      fetcher.mockRestore()
    }
  })
})

describe('the dashboard’s reads of the private repo', () => {
  const env = { EXPORT_TOKEN: 'x', IP_SALT: 's', COLLECTING: 'on', DASHBOARD_TOKEN: 'pw', GITHUB_DISPATCH_TOKEN: 'tok', LIMIT: { limit: async () => ({ success: true }) } }
  const get = (path: string, pw = 'pw') => new Request(`https://w.dev${path}`, { headers: { authorization: `Bearer ${pw}` } })

  it('a named file from main, raw, with the token', async () => {
    const { handle } = await import('../../worker/src/index')
    const calls: { url: string; init?: RequestInit }[] = []
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => (calls.push({ url: String(url), init }), new Response('{"a":1}\n')))
    try {
      const res = await handle(get('/v1/repo/nightly'), env, {} as never)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('{"a":1}\n')
      expect(calls[0].url).toBe(`${API}/contents/data/live/nightly.jsonl?ref=main`)
      expect((calls[0].init!.headers as Record<string, string>).authorization).toBe('Bearer tok')
      expect((calls[0].init!.headers as Record<string, string>).accept).toBe('application/vnd.github.raw')
    } finally {
      fetcher.mockRestore()
    }
  })
  it('a file not there yet reads as empty', async () => {
    const { handle } = await import('../../worker/src/index')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }))
    try {
      const res = await handle(get('/v1/repo/nightly'), env, {} as never)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('')
    } finally {
      fetcher.mockRestore()
    }
  })
  it('a listed workflow’s runs', async () => {
    const { handle } = await import('../../worker/src/index')
    const calls: string[] = []
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (calls.push(String(url)), Response.json({ workflow_runs: [] })))
    try {
      const res = await handle(get('/v1/runs/issue-fixer.yml'), env, {} as never)
      expect(await res.json()).toEqual({ workflow_runs: [] })
      expect(calls).toEqual([`${API}/actions/workflows/issue-fixer.yml/runs?per_page=20`])
    } finally {
      fetcher.mockRestore()
    }
  })
  it('only with the password, and only the named files and listed workflows', async () => {
    const { handle } = await import('../../worker/src/index')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x'))
    try {
      expect((await handle(get('/v1/repo/history', 'nope'), env, {} as never)).status).toBe(401)
      expect((await handle(get('/v1/repo/package'), env, {} as never)).status).toBe(404)
      expect((await handle(get('/v1/runs/secret.yml'), env, {} as never)).status).toBe(404)
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      fetcher.mockRestore()
    }
  })
})
