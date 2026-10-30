import { existsSync, readdirSync, readFileSync } from 'node:fs'

// Nothing runs on the PC since 2026-10-29: the smarter player's training and the daily check stopped, and the live
// data moved from scripts/nightly.sh to GitHub (live-data.yml)
const live = readFileSync('.github/workflows/live-data.yml', 'utf8')
const runs = live.split('\n').filter(l => /^\s*(- )?run: /.test(l)).map(l => l.replace(/^\s*(- )?run: /, ''))
const step = (name: string) => live.slice(live.indexOf(`- name: ${name}`), live.indexOf('\n      - ', live.indexOf(`- name: ${name}`) + 1))

it('the live data pulls, adds to the digest, sends the summary, tests, commits, then empties the collector’s uploads', () => {
  const order = ['scripts/live/pull.ts', 'scripts/live/digest.ts', 'scripts/live/summary.ts', 'npm test', 'git push', '/v1/export/rotate']
  let at = -1
  for (const s of order) {
    const i = live.indexOf(s)
    expect(i, s).toBeGreaterThan(at)
    at = i
  }
})

it('commits only the data, rebasing onto main first, and never the odds or the reader', () => {
  expect(live).toContain('git add data/live\n')
  expect(live).not.toMatch(/learnIcons|newCards|learnedIcons\.json|deploy\.yml/)
  expect(live).toContain('git pull -q --rebase && git push -q')
  expect(live).not.toMatch(/weights\.ts|checkRules\.ts|valueFit|gh pr create/)
})

it('empties the collector only after a push', () => {
  expect(step('Empty the collector')).toContain("if: steps.push.outputs.pushed == '1'")
})

it('runs once a day, when the collector starts it: no schedule of its own to commit a second time', () => {
  expect(live).not.toMatch(/^\s*schedule:/m)
  expect(live).toContain('workflow_dispatch:')
})

it('hashes the install numbers wherever the digest is worked out', () => {
  expect(step('Add the boards to the digest')).toContain('DIGEST_SALT: ${{ secrets.DIGEST_SALT }}')
  expect(step('Send the dashboard its numbers')).toContain('DIGEST_SALT: ${{ secrets.DIGEST_SALT }}')
  expect(readFileSync('.github/workflows/dashboard.yml', 'utf8')).toContain('DIGEST_SALT: ${{ secrets.DIGEST_SALT }}')
})

it('keeps the collector’s token out of the tests', () => {
  const test = live.slice(live.indexOf('- run: npm test') - 200, live.indexOf('- run: npm test'))
  expect(test).not.toContain('LIVE_DATA_TOKEN')
  expect(live.match(/^ {4}env:\n {6}LIVE_DATA_URL/m)).not.toBeNull()
  expect(runs).toContain('npm test')
})

it('pulls only the boards: no named icons or unknown cards', () => {
  expect(readFileSync('scripts/live/pull.ts', 'utf8')).not.toMatch(/pullIcons|pullCards/)
  for (const f of ['scripts/live/learnIcons.ts', 'scripts/live/newCards.ts', 'data/live/icons.jsonl', 'data/live/cards.jsonl', 'data/live/new-cards']) expect(existsSync(f), f).toBe(false)
})

it('GitHub runs these loops, and no training', () => {
  expect(readdirSync('.github/workflows').sort()).toEqual(['dashboard.yml', 'deploy.yml', 'desktop.yml', 'issue-fixer.yml', 'live-data.yml'])
})

it('every 2 hours on GitHub, the dashboard gets its numbers from the new boards, and nothing is committed', () => {
  const w = readFileSync('.github/workflows/dashboard.yml', 'utf8')
  expect(w).toContain("cron: '17 */2 * * *'")
  const runs = w.split('\n').filter(l => /^\s*(- )?run: /.test(l)).map(l => l.replace(/^\s*(- )?run: /, ''))
  expect(runs).toEqual(['npm ci --no-audit --no-fund', 'npx vite-node scripts/live/pull.ts', 'npx vite-node scripts/live/summary.ts'])
  expect(w).toContain('contents: read')
  expect(w).not.toMatch(/git (commit|push)|weights\.ts|npm test/)
})

it('nothing runs on the PC: no nightly script, nothing to schedule it', () => {
  for (const f of ['scripts/nightly.sh', 'scripts/local/schedule.ps1', 'scripts/local/toast.ps1']) expect(existsSync(f), f).toBe(false)
})
