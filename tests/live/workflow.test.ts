import { existsSync, readdirSync, readFileSync } from 'node:fs'

// The nightly jobs on the PC (scripts/nightly.sh) stopped on 2026-10-29; GitHub keeps the loops below
it('pulls the named panel icons too', () => {
  expect(readFileSync('scripts/live/pull.ts', 'utf8')).toContain('pullIcons(')
})

it('the moved jobs are gone from GitHub Actions, and the collector no longer starts them', () => {
  expect(readdirSync('.github/workflows').sort()).toEqual(['dashboard.yml', 'deploy.yml', 'desktop.yml', 'issue-fixer.yml'])
})

it('every 2 hours on GitHub, the dashboard gets its numbers from the new boards, and nothing is committed', () => {
  const w = readFileSync('.github/workflows/dashboard.yml', 'utf8')
  expect(w).toContain("cron: '17 */2 * * *'")
  const runs = w.split('\n').filter(l => /^\s*(- )?run: /.test(l)).map(l => l.replace(/^\s*(- )?run: /, ''))
  expect(runs).toEqual(['npm ci --no-audit --no-fund', 'npx vite-node scripts/live/pull.ts', 'npx vite-node scripts/live/summary.ts'])
  expect(w).toContain('contents: read')
  expect(w).not.toMatch(/git (commit|push)|weights\.ts|npm test/)
})

it('the nightly jobs on the PC are gone for good: no script to run, nothing to schedule it', () => {
  for (const f of ['scripts/nightly.sh', 'scripts/local/schedule.ps1', 'scripts/local/toast.ps1']) expect(existsSync(f), f).toBe(false)
})
