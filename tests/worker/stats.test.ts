import { digest, report, summarize, type StatRow } from '../../worker/src/stats'
import { handle, type Store } from '../../worker/src/index'
import { emptyStats, withCounts } from '../../worker/src/summary'

const board = (run: string, round: number, extra: Record<string, unknown> = {}) => JSON.stringify({ run, seq: 0, app: '9832893', source: 'live', trigger: 'board', round, phase: 'potion', refreshes: 3, shelley: 6, corrected: [], tanks: [], hand: [], instruments: [], ...extra })
const row = (received: string, client: string, body: string): StatRow => ({ received, client, body })

describe('boards shared with unsure fields', () => {
  const t = { archetype: 'pest', rarity: 'magic', activity: 500, quantity: 1000 }
  const rows = [
    row('2026-10-19T09:00:00Z', 'a', board('g1', 13, { phase: 'protocol', tanks: [t, null, null, null, null, null] })),
    row('2026-10-19T09:00:00Z', 'b', board('g2', 13, { phase: 'protocol', tanks: [t, t, null, null, null, null], unsure: ['tank1.quantity'] })),
    row('2026-10-19T09:00:00Z', 'c', board('g3', 4, { unsure: ['hand0'] })),
  ]
  const s = summarize(rows, new Date('2026-10-19T12:00:00Z'))
  it('count as games played', () => {
    expect(s.totals.games).toBe(3)
  })
  it('the share of boards with something the reader wasn’t sure of', () => {
    expect(s.unsure).toBeCloseTo(2 / 3)
  })
  it('a final board with an unsure number isn’t counted as a finished game’s score', () => {
    expect(s.finished.finals).toEqual([500_000])
    expect(s.days[0].finished).toBe(1)
  })
})

describe('games that never got past the first instrument offer', () => {
  // a reroll and a recheck at the first offer each used to start a new game ID
  const first = { phase: 'instrument' }
  const rows = [
    row('2026-10-19T09:00:00Z', 'a', board('r1', 1, first)),
    row('2026-10-19T09:01:00Z', 'a', board('r2', 1, first)),
    row('2026-10-19T09:02:00Z', 'a', board('r3', 1, first)),
    row('2026-10-19T09:03:00Z', 'a', board('r3', 1, { instruments: ['Incubation Sac'] })),
    row('2026-10-19T09:30:00Z', 'a', board('r3', 13, { phase: 'protocol', instruments: ['Incubation Sac'] })),
  ]
  const s = summarize(rows, new Date('2026-10-19T12:00:00Z'))
  it('aren’t counted as games, nor as games stopping at round 1', () => {
    expect(s.totals.games).toBe(1)
    expect(s.days[0].games).toBe(1)
    expect(s.rounds).toEqual({ 13: 1 })
  })
  it('their boards still count', () => {
    expect(s.totals.boards).toBe(5)
  })
})

describe('how far a game got', () => {
  it('counts only rounds read for sure: an unread round falls back to 1, so a game with none read is its own row (0)', () => {
    const rows = [
      row('2026-10-19T09:00:00Z', 'a', board('g1', 1, { instruments: ['Incubation Sac'], unsure: ['round'] })),
      row('2026-10-19T09:10:00Z', 'a', board('g1', 1, { instruments: ['Incubation Sac'], unsure: ['round'] })),
      row('2026-10-19T09:00:00Z', 'b', board('g2', 1, { instruments: ['Incubation Sac'] })),
      row('2026-10-19T09:10:00Z', 'b', board('g2', 9, { instruments: ['Incubation Sac'] })),
      row('2026-10-19T09:20:00Z', 'b', board('g2', 1, { instruments: ['Incubation Sac'], unsure: ['round'] })),
    ]
    expect(summarize(rows, new Date('2026-10-19T12:00:00Z')).rounds).toEqual({ 0: 1, 9: 1 })
  })
})

describe('the dashboard summary', () => {
  const rows = [
    row('2026-10-18T10:00:00Z', 'a', board('g1', 1)),
    row('2026-10-18T10:05:00Z', 'a', board('g1', 7, { corrected: ['tank1.activity'] })),
    row('2026-10-18T11:00:00Z', 'b', board('g2', 3, { app: '9832893-overlay' })),
    row('2026-10-19T09:00:00Z', 'a2', board('g3', 13, { instruments: ['Incubation Sac'] })),
  ]
  const s = summarize(rows, new Date('2026-10-19T12:00:00Z'))

  it('counts boards, games and players (different devices) per day', () => {
    expect(s.days).toEqual([
      { day: '2026-10-18', boards: 3, games: 2, players: 2, website: 1, app: 1, finished: 0, averageFinal: null, medianFinal: null },
      { day: '2026-10-19', boards: 1, games: 1, players: 1, website: 1, app: 0, finished: 0, averageFinal: null, medianFinal: null },
    ])
    expect(s.totals).toMatchObject({ boards: 4, games: 3 })
  })
  it('how far games got: the highest round each reached', () => {
    expect(s.rounds).toEqual({ 3: 1, 7: 1, 13: 1 })
  })
  it('the share of boards a player had to correct', () => {
    expect(s.corrected).toBe(0.25)
  })
  it('the latest games, newest first, without anything about who played', () => {
    expect(s.recent[0]).toEqual({ start: '2026-10-19T09:00:00Z', boards: 1, round: 13, app: false, score: 0, finished: false })
    expect(JSON.stringify(s)).not.toMatch(/"a2"|"client"/)
  })
})

describe('real results', () => {
  const tank = (activity: number, quantity: number) => ({ archetype: 'aemberon', rarity: 'boss', activity, quantity })
  const rows = [
    // a finished game: its last board is the round-13 Surgical Protocol, whose total is the final score
    row('2026-10-18T10:00:00Z', 'a', board('g1', 5, { advice: { move: 'Play X', activity: 840000, reached: 0.6 } })),
    row('2026-10-18T10:10:00Z', 'a', board('g1', 13, { phase: 'protocol', tanks: [tank(1000, 1000), null, null, null, null, null] })),
    // another, short of 840k
    row('2026-10-18T11:00:00Z', 'b', board('g2', 5, { advice: { move: 'Play Y', activity: 400000, reached: 0.1 } })),
    row('2026-10-18T11:10:00Z', 'b', board('g2', 13, { phase: 'protocol', tanks: [tank(500, 500), null, null, null, null, null] })),
    // unfinished
    row('2026-10-18T12:00:00Z', 'c', board('g3', 4)),
  ]
  const s = summarize(rows, new Date('2026-10-19T00:00:00Z'))
  it('the average final score per day, to see games getting better', () => {
    expect(s.days.map(d => [d.day, d.finished, d.averageFinal])).toEqual([['2026-10-18', 2, 625_000]])
  })
  it('the final score of every finished game, how many reached 840,000, the average, the median and the average counted to 840,000', () => {
    expect(s.finished).toEqual({ games: 2, reached: 1, finals: [1_000_000, 250_000], average: 625_000, median: 1_000_000, capped: 545_000 })
  })
  it('each recent game shows its score: final when finished, else at its last board', () => {
    const byStart = Object.fromEntries(s.recent.map(g => [g.start, g]))
    expect(byStart['2026-10-18T10:00:00Z']).toMatchObject({ score: 1_000_000, finished: true })
    expect(byStart['2026-10-18T12:00:00Z']).toMatchObject({ score: 0, finished: false, round: 4 })
  })
  it('predicted against real: the advice’s chance of 840,000, in bands, against how those games ended', () => {
    expect(s.calibration).toEqual([
      { band: '0–20%', predicted: 0.1, games: 1, reached: 0 },
      { band: '60–80%', predicted: 0.6, games: 1, reached: 1 },
    ])
  })
})

describe('the dashboard routes', () => {
  const store = { summary: async () => summarize([row('2026-10-18T10:00:00Z', '', board('g1', 2))]), dayCounts: async () => [{ day: '2026-10-18', players: 1 }] } as unknown as Store
  const env = { EXPORT_TOKEN: 'x', IP_SALT: 's', DASHBOARD_TOKEN: 'open-sesame', LIMIT: { limit: async () => ({ success: true }) } }
  it('the numbers need the dashboard password', async () => {
    expect((await handle(new Request('https://w.dev/v1/stats'), env, store)).status).toBe(401)
    expect((await handle(new Request('https://w.dev/v1/stats', { headers: { authorization: 'Bearer x' } }), env, store)).status).toBe(401)
    const ok = await handle(new Request('https://w.dev/v1/stats', { headers: { authorization: 'Bearer open-sesame' } }), env, store)
    expect(ok.status).toBe(200)
    expect((await ok.json()).totals.games).toBe(1)
  })
  it('the page’s script is valid JavaScript (one stray quote would leave it stuck at the password box)', async () => {
    const { DASHBOARD_HTML } = await import('../../worker/src/dashboard')
    const script = DASHBOARD_HTML.split('<script>')[1].split('</script>')[0]
    expect(() => new Function(script)).not.toThrow()
  })
  it('the page itself holds no data: it asks for the password', async () => {
    const res = await handle(new Request('https://w.dev/dashboard'), env, store)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    const html = await res.text()
    expect(html).toMatch(/password/i)
    expect(html).not.toMatch(/open-sesame/)
    // the automated loops' health: GitHub's run lists, read through the collector; the PC's nightly jobs stopped
    for (const f of ['issue-fixer.yml', 'deploy.yml', 'desktop.yml', "/v1/repo/", "/v1/runs/"]) expect(html).toContain(f)
    for (const f of ["job: 'live-data'", "job: 'daily-check'", "job: 'smarter-player'"]) expect(html).not.toContain(f)
    // nothing read from GitHub straight from the browser: the repo is private
    expect(html).not.toMatch(/raw\.githubusercontent|api\.github\.com/)
    // players counted across days, beside today's
    expect(html).toContain('Players ever')
  })
})

describe('problems by setup: which screens, windows, HDR or browsers misread', () => {
  const dbg = (frame: [number, number], extra: Record<string, unknown> = {}) => ({ frame, dpr: 1, hdr: false, browser: 'Chrome 131', off: 0, corrected: false, tanks: [], scores: {}, ...extra })
  const rows = [
    row('2026-10-19T09:00:00Z', 'a', board('g1', 2, { debug: dbg([1920, 1080]) })),
    row('2026-10-19T09:00:00Z', 'a', board('g1', 3, { debug: dbg([1920, 1080]), unsure: ['hand0'] })),
    row('2026-10-19T09:00:00Z', 'b', board('g2', 2, { debug: dbg([1920, 1200], { hdr: true, browser: 'Electron 33', window: { outer: [1936, 1239], client: [1920, 1200], scale: 1 } }), unsure: ['tank1.activity'] })),
    row('2026-10-19T09:00:00Z', 'c', board('g3', 2, { debug: dbg([3440, 1440], { browser: 'Electron 33', window: { outer: [3440, 1440], client: [3440, 1440], scale: 1 } }) })),
    row('2026-10-19T09:00:00Z', 'd', board('g4', 2)),
  ]
  const p = summarize(rows, new Date('2026-10-19T12:00:00Z')).problems
  const find = (by: string, group: string) => p.find(x => x.by === by && x.group === group)
  it('by screen shape', () => {
    expect(find('screen', '16:9')).toEqual({ by: 'screen', group: '16:9', boards: 2, unsure: 0.5, numbers: 0 })
    expect(find('screen', '16:10')).toEqual({ by: 'screen', group: '16:10', boards: 1, unsure: 1, numbers: 1 })
    expect(find('screen', '21:9')).toMatchObject({ boards: 1, unsure: 0 })
  })
  it('by window: the app says whether the game is windowed (its title bar and borders) or borderless', () => {
    expect(find('window', 'windowed')).toMatchObject({ boards: 1, numbers: 1 })
    expect(find('window', 'borderless or fullscreen')).toMatchObject({ boards: 1 })
    expect(find('window', 'website')).toMatchObject({ boards: 2 })
  })
  it('by HDR and by browser, without its version', () => {
    expect(find('HDR', 'on')).toMatchObject({ boards: 1 })
    expect(find('HDR', 'off')).toMatchObject({ boards: 3 })
    expect(find('browser', 'Electron (app)')).toMatchObject({ boards: 2 })
    expect(find('browser', 'Chrome')).toMatchObject({ boards: 2 })
  })
  it('a picture that wasn’t the game screen counts as a board read with nothing sure', () => {
    const q = summarize([row('2026-10-19T09:00:00Z', 'e', board('g9', 1, { debug: dbg([1866, 1080], { browser: 'Electron 44', window: { outer: [1936, 1119], client: [1920, 1080], scale: 1 } }), unreadable: true }))], new Date('2026-10-19T12:00:00Z')).problems
    expect(q.find(x => x.by === 'window' && x.group === 'windowed')).toMatchObject({ boards: 1, unsure: 1, numbers: 1 })
  })
  it('boards from before the setup was shared aren’t counted', () => {
    expect(p.filter(x => x.by === 'screen').reduce((s, x) => s + x.boards, 0)).toBe(4)
  })
})

describe('players ever', () => {
  const i1 = '11111111-1111-4111-8111-111111111111', i2 = '22222222-2222-4222-8222-222222222222'
  const rows = [
    // boards from before the install number: counted only as player-days
    row('2026-10-18T10:00:00Z', 'a', board('g1', 1)),
    row('2026-10-19T09:00:00Z', 'b', board('g2', 1, { install: i1 })),
    row('2026-10-20T09:00:00Z', 'c', board('g3', 1, { install: i1 })),
    row('2026-10-20T10:00:00Z', 'd', board('g4', 1, { install: i2 })),
  ]
  const s = summarize(rows, new Date('2026-10-20T12:00:00Z'))
  it('the same install on two days is one player', () => {
    expect(s.totals.playersEver).toBe(2)
    expect(s.totals.countedSince).toBe('2026-10-19')
  })
  it('player-days: every day’s players added up, for the days before installs were counted', () => {
    expect(s.totals.playerDays).toBe(4)
  })
})

describe('games and final scores, as they really are', () => {
  const pest = (activity: number, quantity: number) => ({ archetype: 'pest', rarity: 'magic', activity, quantity })
  const end = (run: string, tanks: unknown[], extra: Record<string, unknown> = {}) => board(run, 13, { phase: 'protocol', tanks, ...extra })
  it('a run that holds several games (the Solver left open between them) counts each: a new one starts when the round goes back', () => {
    const rows = [
      row('2026-10-18T10:00:00Z', 'a', board('r', 3)),
      row('2026-10-18T10:10:00Z', 'a', end('r', [pest(1000, 1000)])),
      row('2026-10-18T10:20:00Z', 'a', board('r', 1, { instruments: ['Incubation Sac'] })),
      row('2026-10-18T10:30:00Z', 'a', end('r', [pest(500, 500)])),
      // an unsure round reads as 1: it doesn't start a game
      row('2026-10-18T10:31:00Z', 'a', board('r', 1, { unsure: ['round'], phase: 'protocol' })),
    ]
    const s = summarize(rows, new Date('2026-10-19T00:00:00Z'))
    expect(s.totals.games).toBe(2)
    expect(s.finished.finals).toEqual([1_000_000, 250_000])
  })
  it('the final score includes round 13’s last instrument effects, which come after its board is read', () => {
    // Fouled Scraper: +20 Activity to monsters with Quantity above 275, once more at the end of round 13
    const rows = [row('2026-10-18T10:00:00Z', 'a', end('g', [pest(100, 300), null, null, null, null, null], { instruments: ['Fouled Scraper'] }))]
    expect(summarize(rows).finished.finals).toEqual([120 * 300])
  })
  it('a final above 10,000,000 is a misread number and isn’t counted', () => {
    const rows = [row('2026-10-18T10:00:00Z', 'a', end('g', [pest(9000, 9000)]))]
    expect(summarize(rows).finished.games).toBe(0)
  })
})

describe('the summary with the collector’s counts put in', () => {
  // the workflow has no daily player codes: its players per day are replaced by the collector's
  const rows = [
    row('2026-10-18T10:00:00Z', '', board('g1', 2)),
    row('2026-10-18T10:05:00Z', '', board('g1', 3)),
    row('2026-10-19T10:00:00Z', '', board('g2', 2)),
  ]
  const now = new Date('2026-10-20T12:00:00Z')
  const counts = [
    { day: '2026-10-18', players: 1 },
    { day: '2026-10-19', players: 1 },
    // players since the workflow's last pull
    { day: '2026-10-20', players: 2 },
  ]
  const s = withCounts(summarize(rows, now), counts, now)
  it('players per day come from the collector, boards and games from the summary', () => {
    expect(s.days.map(d => [d.day, d.boards, d.players, d.games])).toEqual([['2026-10-18', 2, 1, 1], ['2026-10-19', 1, 1, 1], ['2026-10-20', 0, 2, 0]])
  })
  it('the totals by daily player code too', () => {
    expect(s.totals).toMatchObject({ boards: 3, playersToday: 2, playerDays: 4, games: 2 })
  })
  it('before the first summary, the counts alone', () => {
    const e = withCounts(null, counts, now)
    expect(e.totals).toMatchObject({ boards: 0, playerDays: 4, games: 0 })
    expect(e.finished).toEqual(emptyStats(now).finished)
  })
})

describe('the digest, kept between pulls so the boards needn’t be', () => {
  const pest = (activity: number, quantity: number) => ({ archetype: 'pest', rarity: 'magic', activity, quantity })
  const dbg = { frame: [1920, 1080], dpr: 1, hdr: false, browser: 'Chrome 131', off: 0, corrected: false, tanks: [], scores: {} }
  const rows = [
    row('2026-10-18T10:00:00Z', 'a', board('r', 3, { install: '11111111-1111-4111-8111-111111111111', debug: dbg, advice: { move: 'x', activity: 1, reached: 0.7 } })),
    row('2026-10-18T10:10:00Z', 'a', board('r', 9, { unsure: ['hand0'], debug: dbg })),
    row('2026-10-18T23:50:00Z', 'a', board('r', 13, { phase: 'protocol', tanks: [pest(1000, 1000)] })),
    // the next game in the same run, over midnight
    row('2026-10-19T00:10:00Z', 'a', board('r', 2, { instruments: ['Incubation Sac'], corrected: ['hand1'] })),
    row('2026-10-19T00:20:00Z', 'b', board('q', 5)),
  ]
  const now = new Date('2026-10-19T12:00:00Z')
  it('boards added a pull at a time give the numbers all of them at once do', () => {
    for (let cut = 0; cut <= rows.length; cut++) {
      const twice = digest(rows.slice(cut), JSON.parse(JSON.stringify(digest(rows.slice(0, cut)))))
      expect(report(twice, now)).toEqual(summarize(rows, now))
    }
  })
  it('says how far it goes', () => {
    expect(digest(rows).upto).toBe('2026-10-19T00:20:00Z')
  })
  it('holds no cards and no daily player code beyond what the collector already counts', () => {
    expect(JSON.stringify(digest(rows))).not.toMatch(/Incubation Sac|pest/)
  })
})

describe('boards stored lean (since Oct 24): no tanks or instruments', () => {
  const lean = (run: string, round: number, extra: Record<string, unknown> = {}) => JSON.stringify({ run, seq: 0, app: 'abc1234', source: 'live', trigger: 'board', round, phase: 'potion', refreshes: 0, shelley: 6, corrected: [], score: 0, picks: 0, ...extra })
  const s = summarize([
    row('2026-10-24T10:00:00Z', 'a', lean('g1', 1, { phase: 'instrument' })),
    row('2026-10-24T10:01:00Z', 'a', lean('g1', 1, { picks: 1, score: 4000 })),
    row('2026-10-24T10:30:00Z', 'a', lean('g1', 13, { phase: 'protocol', picks: 3, score: 900_000, final: 950_000 })),
    // a final with an unsure number isn't one
    row('2026-10-24T11:00:00Z', 'b', lean('g2', 13, { phase: 'protocol', picks: 3, score: 9, final: 9, unsure: ['tank0.quantity'] })),
    // never past the first offer
    row('2026-10-24T12:00:00Z', 'c', lean('g3', 1, { phase: 'instrument' })),
  ], new Date('2026-10-24T13:00:00Z'))
  it('a game is played once it has an instrument; its final is the one stored', () => {
    expect(s.totals.games).toBe(2)
    expect(s.finished.finals).toEqual([950_000])
  })
  it('a game’s score at its last board is the stored total', () => {
    expect(s.recent.find(g => g.start === '2026-10-24T11:00:00Z')).toMatchObject({ score: 9, finished: false })
  })
})

describe('since each release', () => {
  // a finished game: its boards from round 2 to the round-13 Surgical Protocol, on site version app
  const finished = (run: string, at: string, app: string, final: number, extra: Record<string, unknown> = {}) => [
    row(at, 'a', board(run, 2, { app, instruments: ['Incubation Sac'], ...extra })),
    row(at.replace(/:00Z$/, ':30Z'), 'a', board(run, 13, { app, phase: 'protocol', instruments: ['Incubation Sac'], final, ...extra })),
  ]
  const at = (i: number) => new Date(Date.UTC(2026, 9, 25, 0, i)).toISOString().replace('.000Z', 'Z')

  it('the last 100 finished games, rolling; nothing before 100 have finished', () => {
    expect(summarize(Array.from({ length: 99 }, (_, i) => finished(`g${i}`, at(i), 'aaaaaaa', 900_000)).flat()).rolling).toEqual([])
    const rows = Array.from({ length: 150 }, (_, i) => finished(`g${i}`, at(i), i < 100 ? 'aaaaaaa' : 'bbbbbbb', i < 100 ? 900_000 : 500_000)).flat()
    const r = summarize(rows).rolling
    expect(r[0]).toMatchObject({ average: 900_000, reached: 1, version: 'aaaaaaa' })
    // the latest point: games 50–149, half from each release
    expect(r[r.length - 1]).toMatchObject({ average: 700_000, reached: 0.5, version: 'bbbbbbb' })
  })

  it('each release with 30 finished games, and the newest whatever its count, newest first', () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => finished(`a${i}`, at(i), 'aaaaaaa', i % 2 ? 1_000_000 : 600_000)).flat(),
      ...Array.from({ length: 5 }, (_, i) => finished(`b${i}`, at(40 + i), 'bbbbbbb', 800_000)).flat(),
      ...Array.from({ length: 3 }, (_, i) => finished(`c${i}`, at(50 + i), 'ccccccc', 700_000, { unsure: ['hand0'] })).flat(),
    ]
    const r = summarize(rows).releases
    expect(r.map(x => x.version)).toEqual(['ccccccc', 'aaaaaaa'])
    expect(r[1]).toMatchObject({ finished: 30, average: 800_000, reached: 0.5, first: at(0) })
    expect(r[1].margin).toBeGreaterThan(70_000)
    // every board of the newest release's games was read with something unsure
    expect(r[0]).toMatchObject({ finished: 3, boards: 6, unsure: 6, corrected: 0 })
  })
})

describe('cards read unsure', () => {
  const rows = [
    row('2026-10-26T10:00:00Z', 'a', board('r1', 2, { cards: ['Xeno-Hormone', 'Mutagenic Powder'], unsureCards: ['Mutagenic Powder'], correctedCards: [] })),
    row('2026-10-26T10:01:00Z', 'a', board('r1', 3, { cards: ['Mutagenic Powder', 'Mutagenic Powder'], unsureCards: [], correctedCards: ['Mutagenic Powder'] })),
    row('2026-10-27T10:00:00Z', 'b', board('r2', 2, { cards: ['Xeno-Hormone'], unsureCards: [], correctedCards: [] })),
    // a board from before Oct 26 has no names
    row('2026-10-25T10:00:00Z', 'c', board('r3', 2, { unsure: ['hand0'] })),
  ]
  it('counts each card’s boards offered, unsure and corrected to it, the most trouble first', () => {
    expect(summarize(rows).cards).toEqual([
      { name: 'Mutagenic Powder', shown: 2, unsure: 1, corrected: 1 },
      { name: 'Xeno-Hormone', shown: 2, unsure: 0, corrected: 0 },
    ])
  })
  it('adds up across pulls', () => {
    expect(report(digest(rows.slice(2), digest(rows.slice(0, 2)))).cards).toEqual(summarize(rows).cards)
    expect(report(digest(rows.slice(2), digest(rows.slice(0, 2)))).cardReleases).toEqual(summarize(rows).cardReleases)
  })
  it('per release, the newest first: each release reads cards better than the last', () => {
    const newer = [
      ...rows,
      row('2026-10-28T10:00:00Z', 'b', board('r4', 2, { app: 'abc1234-overlay', cards: ['Mutagenic Powder'], unsureCards: [], correctedCards: [] })),
      row('2026-10-28T10:01:00Z', 'd', board('r5', 2, { app: 'abc1234', cards: ['Xeno-Hormone'], unsureCards: ['Xeno-Hormone'], correctedCards: [] })),
    ]
    const r = summarize(newer).cardReleases!
    expect(r.map(x => [x.version, x.boards])).toEqual([['abc1234', 2], ['9832893', 3]])
    expect(r[0].cards).toEqual([
      { name: 'Xeno-Hormone', shown: 1, unsure: 1, corrected: 0 },
      { name: 'Mutagenic Powder', shown: 1, unsure: 0, corrected: 0 },
    ])
    expect(r[1].cards).toEqual(summarize(rows).cards)
    // all releases together, as before
    expect(summarize(newer).cards.find(c => c.name === 'Xeno-Hormone')).toEqual({ name: 'Xeno-Hormone', shown: 3, unsure: 1, corrected: 0 })
  })
  it('leaves the Surgical Protocols out', () => {
    const s = summarize([...rows, row('2026-10-27T11:00:00Z', 'b', board('r2', 13, { phase: 'protocol', cards: ['Aseptic Isolation Protocol'], unsureCards: ['Aseptic Isolation Protocol'], correctedCards: [] }))])
    expect(s.cards).toEqual(summarize(rows).cards)
    expect(s.cardReleases![0].cards).toEqual(summarize(rows).cards)
  })
  it('days counted before the split by release still count in all releases', () => {
    const old = digest(rows)
    for (const d of old.days) {
      for (const c of d.cards ?? []) delete c.version
      delete d.cardBoards
    }
    const s = report(old)
    expect(s.cards).toEqual(summarize(rows).cards)
    expect(s.cardReleases).toEqual([])
  })
})
