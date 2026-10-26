// The dashboard's numbers, worked out from the stored boards. Only counts leave: the daily player code
// (a salted hash of the address that changes every day) is used to count players per day and never sent.

import { finalScore } from '../../src/engine/final'

export interface StatRow { received: string; client: string; body: string }

interface Tank { archetype: string; rarity: string; activity: number; quantity: number }
/** A board as stored: since Oct 24 without its cards and tanks (worker/src/validate.ts lean): score, its total; final,
 *  the round-13 board's final score; picks, how many instruments it showed. Boards from before have tanks and instruments. */
interface Board { run: string; install?: string; seq?: number; round: number; phase?: string; app: string; corrected?: string[]; unsure?: string[]; unreadable?: boolean; debug?: Debug; instruments?: string[]; tanks?: (Tank | null)[]; advice?: { reached: number | null }; score?: number; final?: number; picks?: number; cards?: string[]; unsureCards?: string[]; correctedCards?: string[] }

interface Debug { frame: [number, number]; hdr: boolean; browser: string; window?: { outer: [number, number]; client: [number, number] } }

/** The screen's shape by name, when it's within 3% of a common one. */
const SHAPES: [string, number][] = [['4:3', 4 / 3], ['16:10', 1.6], ['16:9', 16 / 9], ['21:9', 2.37], ['32:9', 32 / 9]]
export function shape([w, h]: [number, number]): string {
  const r = w / h
  return SHAPES.find(([, v]) => Math.abs(r - v) / v < 0.03)?.[0] ?? `${r.toFixed(2)}:1`
}

/** The groups a board's setup falls in, one per question. */
function setupOf(d: Debug): [string, string][] {
  const win = !d.window ? 'website' : d.window.outer[0] === d.window.client[0] && d.window.outer[1] === d.window.client[1] ? 'borderless or fullscreen' : 'windowed'
  const browser = d.browser.split(' ')[0]
  return [['screen', shape(d.frame)], ['window', win], ['HDR', d.hdr ? 'on' : 'off'], ['browser', browser === 'Electron' ? 'Electron (app)' : browser]]
}

/** The advice's goal (src/strategy/bot.ts TARGET): with the endgame battle bonus it reaches rainbow. */
const TARGET = 840_000
/** A final above this is a misread number (real games end below about 3.5M) and isn't counted. */
const MAX_FINAL = 10_000_000
const total = (b: Board) => (b.tanks ?? []).reduce((s, t) => s + (t ? t.activity * t.quantity : 0), 0)

export interface Stats {
  generated: string
  /** playersEver: different installs (a random number per browser or app) since countedSince, the first day one came;
   *  playerDays: every day's players (different devices that day) added up, which counts a player once per day played */
  totals: { boards: number; games: number; playersToday: number; playersEver: number; countedSince: string | null; playerDays: number }
  /** per day: boards, games, players (different devices that day), games played on the website / in the app,
   *  and the games finished that day with their average final score (null when none finished) */
  days: { day: string; boards: number; games: number; players: number; website: number; app: number; finished: number; averageFinal: number | null; medianFinal: number | null }[]
  /** games by the highest round they reached */
  rounds: Record<number, number>
  /** the share of boards a player corrected */
  corrected: number
  /** the share of boards shared with something the reader wasn't sure of (and the player didn't correct) */
  unsure: number
  /** games per site version */
  versions: Record<string, number>
  /** score: the final score when the game finished, else the total on its last shared board */
  recent: { start: string; boards: number; round: number; app: boolean; score: number; finished: boolean }[]
  /** games that reached the round-13 Surgical Protocol: the final score is its board after round 13's last
   *  instrument effects (src/engine/final.ts); average counts every point, capped stops counting at 840,000 */
  finished: { games: number; reached: number; finals: number[]; average: number; median: number; capped: number }
  /** for each setup (screen shape, windowed or not, HDR, browser): boards, and the shares read with something
   *  unsure and with a tank's numbers unsure */
  problems: { by: string; group: string; boards: number; unsure: number; numbers: number }[]
  /** the advice's predicted chance of 840,000 (in 20% bands) against how those finished games ended */
  calibration: { band: string; predicted: number; games: number; reached: number }[]
  /** the free plans' use, added by the workflow (scripts/live/usage.ts); absent before its tokens are set */
  usage?: Usage
  /** finished games in the order they started: the average final score and the share that reached 840k of the
   *  ROLLING games up to each point (a point every few games) */
  rolling: { start: string; version: string; average: number; reached: number }[]
  /** each site version (release) with RELEASE_MIN finished games or more, and the newest whatever its count: first,
   *  when its first game started; margin: the average's 95% margin; boards, unsure, corrected: its games' boards and
   *  how many were read with something unsure or corrected (from Oct 25) */
  releases: { version: string; first: string; finished: number; average: number; margin: number; reached: number; boards: number; unsure: number; corrected: number }[]
  /** each card on boards from Oct 26: the boards it was offered on, read unsure on and corrected to by hand (the
   *  card it really was), the most unsure first */
  cards: CardCount[]
  /** the same per release, newest first (CARD_RELEASES of them): first, when its first game started; boards, its
   *  boards that carried their hand's names. The Solver reads cards better with each release, so the newest says
   *  what still needs pictures. Absent from summaries made before Oct 26's version split. */
  cardReleases?: { version: string; first: string; boards: number; cards: CardCount[] }[]
}

/** The finished games a point of the rolling chart averages over. */
const ROLLING = 100
/** The most points the rolling chart gets. */
const ROLLING_POINTS = 200
/** A release is listed once this many of its games have finished; fewer say little. */
const RELEASE_MIN = 30
/** The releases listed, newest first. */
const RELEASES = 15
/** The releases the cards read unsure are listed for. */
const CARD_RELEASES = 8

/** The rolling average of the last ROLLING finished games, a point every few games, the latest always last. */
function rolling(finished: GameRecord[]): Stats['rolling'] {
  if (finished.length < ROLLING) return []
  const step = Math.max(1, Math.ceil((finished.length - ROLLING + 1) / ROLLING_POINTS))
  const out: Stats['rolling'] = []
  for (let end = finished.length; end >= ROLLING && out.length < ROLLING_POINTS; end -= step) {
    const games = finished.slice(end - ROLLING, end)
    const g = games[games.length - 1]
    out.push({ start: g.start, version: g.version, average: Math.round(games.reduce((s, x) => s + x.final!, 0) / ROLLING), reached: games.filter(x => x.final! >= TARGET).length / ROLLING })
  }
  return out.reverse()
}

/** Each release's games: how its finished games ended, and how well its boards were read. */
function releases(list: GameRecord[]): Stats['releases'] {
  const by = new Map<string, GameRecord[]>()
  for (const g of list) (by.get(g.version) ?? by.set(g.version, []).get(g.version)!).push(g)
  const all = [...by.entries()].map(([version, games]) => {
    const finals = games.flatMap(g => (g.final === null ? [] : [g.final]))
    const n = finals.length
    const average = n ? finals.reduce((s, f) => s + f, 0) / n : 0
    const sd = n > 1 ? Math.sqrt(finals.reduce((s, f) => s + (f - average) ** 2, 0) / (n - 1)) : 0
    const counted = games.filter(g => g.unsure !== undefined)
    return {
      version, first: games.reduce((a, g) => (g.start < a ? g.start : a), games[0].start), finished: n, average: Math.round(average),
      margin: n > 1 ? Math.round((1.96 * sd) / Math.sqrt(n)) : 0, reached: n ? finals.filter(f => f >= TARGET).length / n : 0,
      boards: counted.reduce((s, g) => s + g.boards, 0), unsure: counted.reduce((s, g) => s + (g.unsure ?? 0), 0), corrected: counted.reduce((s, g) => s + (g.corrected ?? 0), 0),
    }
  }).sort((a, b) => b.first.localeCompare(a.first))
  return all.filter((r, i) => i === 0 || r.finished >= RELEASE_MIN).slice(0, RELEASES)
}

/** The free plans' use and limits. A part is left out when its token isn't set or its API didn't answer. */
export interface Usage {
  checked: string
  /** what the dashboard measures against: per UTC day, but bytes for the database and minutes per month */
  limits: { rowsRead: number; rowsWritten: number; requests: number; bytes: number; minutes: number }
  /** per UTC day, oldest first: the D1 database's rows read and written, its size, and the Worker's requests */
  cloudflare?: { day: string; rowsRead: number; rowsWritten: number; requests: number; bytes: number }[]
  /** GitHub Actions this month in this repo: minutes as counted against the free minutes (Windows counts twice)
   *  and the minutes per runner; others: the account's other repos' minutes; charged: what GitHub charges
   *  beyond the free minutes, in dollars */
  github?: { month: string; minutes: number; runners: Record<string, number>; others?: number; charged: number }
}

const RECENT = 25

/** One game as far as the boards so far tell: a run (one Solver session) can hold several, numbered n. Kept between
 *  pulls in data/live/digest (scripts/live/collect.ts), so the boards themselves needn't be. run: its first 12
 *  characters, plenty to tell runs apart. played: past its first instrument offer (an instrument owned). unsure,
 *  corrected: its boards read with something unsure (or not the game screen) and corrected by hand, counted for games
 *  that started from Oct 25 (older ones never were). */
export interface GameRecord { run: string; n: number; start: string; day: string; boards: number; round: number; read: number; app: boolean; version: string; played: boolean; final: number | null; predictions: number[]; last: number; score: number; unsure?: number; corrected?: number }
/** One day's boards: how many, how many a player corrected or the reader was unsure of, the daily player codes and
 *  installs (their first 12 characters) seen, and the boards and problems per setup. */
export interface DayRecord { day: string; boards: number; corrected: number; unsure: number; clients: string[]; installs: string[]; setups: Setup[]; cards?: DayCardCount[]; cardBoards?: Record<string, number> }
type Setup = { by: string; group: string; boards: number; unsure: number; numbers: number }
export type CardCount = { name: string; shown: number; unsure: number; corrected: number }
/** a card's counts on one day's boards from one release (version: absent on days counted before Oct 26's split) */
export type DayCardCount = CardCount & { version?: string }
/** Everything the dashboard's numbers are worked out from; upto: the newest board in it (when it came). */
export interface Digest { upto: string; games: GameRecord[]; days: DayRecord[] }

export const emptyDigest = (): Digest => ({ upto: '', games: [], days: [] })

const RUN = 12
const gameKey = (g: { run: string; n: number }) => `${g.run}#${g.n}`

/** Adds boards to a digest: their games carry on from the ones in it, so a game split between two pulls is one. */
export function digest(rows: StatRow[], prior: Digest = emptyDigest()): Digest {
  const games = new Map(prior.games.map(g => [gameKey(g), { ...g, predictions: [...g.predictions] }]))
  // a run's latest game: a new one starts when a round read for sure goes back
  const current = new Map<string, GameRecord>()
  for (const g of games.values()) if ((current.get(g.run)?.n ?? -1) < g.n) current.set(g.run, g)
  const days = new Map(prior.days.map(d => [d.day, { ...d, clients: new Set(d.clients), installs: new Set(d.installs), setups: new Map(d.setups.map(x => [`${x.by}|${x.group}`, { ...x }])), cards: new Map((d.cards ?? []).map(c => [`${c.version ?? ''}|${c.name}`, { ...c }])), cardBoards: { ...d.cardBoards } }]))
  // boards from before Oct 24 had their tanks and instruments: the round each instrument was first seen, for the
  // ones that fire every few rounds
  const picked = new Map<GameRecord, Map<string, number>>()
  let upto = prior.upto
  for (const r of rows) {
    let b: Board
    try {
      b = JSON.parse(r.body)
    } catch {
      continue
    }
    if (r.received > upto) upto = r.received
    const day = r.received.slice(0, 10)
    const d = days.get(day) ?? { day, boards: 0, corrected: 0, unsure: 0, clients: new Set<string>(), installs: new Set<string>(), setups: new Map<string, Setup>(), cards: new Map<string, DayCardCount>(), cardBoards: {} as Record<string, number> }
    d.boards++
    d.clients.add(r.client)
    if (b.install) d.installs.add(b.install.slice(0, RUN))
    if (b.corrected?.length) d.corrected++
    if (b.unsure?.length) d.unsure++
    if (b.debug?.frame) for (const [by, group] of setupOf(b.debug)) {
      const k = `${by}|${group}`
      const g = d.setups.get(k) ?? { by, group, boards: 0, unsure: 0, numbers: 0 }
      g.boards++
      // a picture that wasn't the game screen: nothing on it read
      if (b.unsure?.length || b.unreadable) g.unsure++
      if (b.unreadable || b.unsure?.some(f => /\.(activity|quantity)$/.test(f))) g.numbers++
      d.setups.set(k, g)
    }
    const version = b.app.replace(/-overlay$/, '')
    const card = (name: string) => d.cards.get(`${version}|${name}`) ?? d.cards.set(`${version}|${name}`, { name, version, shown: 0, unsure: 0, corrected: 0 }).get(`${version}|${name}`)!
    if (b.cards?.length) d.cardBoards[version] = (d.cardBoards[version] ?? 0) + 1
    for (const n of new Set(b.cards ?? [])) card(n).shown++
    for (const n of new Set(b.unsureCards ?? [])) card(n).unsure++
    for (const n of new Set(b.correctedCards ?? [])) card(n).corrected++
    days.set(day, d)
    const run = b.run.slice(0, RUN)
    const sure = !b.unsure?.includes('round')
    let g = current.get(run)
    if (!g || (sure && b.round < g.read)) {
      g = { run, n: g ? g.n + 1 : 0, start: r.received, day, boards: 0, round: 0, read: 0, app: /-overlay$/.test(b.app), version, played: false, final: null, predictions: [], last: -1, score: 0, unsure: 0, corrected: 0 }
      games.set(gameKey(g), g)
      current.set(run, g)
    }
    g.boards++
    if (g.unsure !== undefined && (b.unsure?.length || b.unreadable)) g.unsure++
    if (g.corrected !== undefined && b.corrected?.length) g.corrected++
    const seq = b.seq ?? g.boards
    if (seq >= g.last) {
      g.last = seq
      g.score = b.score ?? total(b)
    }
    g.round = Math.max(g.round, b.round)
    // an unread round falls back to 1: only a round read for sure says how far the game got
    if (sure) g.read = Math.max(g.read, b.round)
    if ((b.instruments?.length ?? b.picks ?? 0) > 0) g.played = true
    const pk = picked.get(g) ?? picked.set(g, new Map()).get(g)!
    for (const n of b.instruments ?? []) if (!pk.has(n)) pk.set(n, sure ? b.round : 1)
    // a final score with an unsure number isn't one
    if (b.round === 13 && b.phase === 'protocol' && !b.unsure?.some(f => /\.(activity|quantity)$/.test(f))) {
      const ins = b.instruments ?? []
      const end = typeof b.final === 'number' ? b.final : b.tanks ? finalScore(b.tanks as Parameters<typeof finalScore>[0], ins, ins.map(n => pk.get(n) ?? 1)) : null
      if (end !== null) g.final = end <= MAX_FINAL ? end : null
    }
    if (typeof b.advice?.reached === 'number') g.predictions.push(Math.round(b.advice.reached * 1000) / 1000)
  }
  return {
    upto,
    games: [...games.values()].sort((a, b) => a.start.localeCompare(b.start) || a.run.localeCompare(b.run) || a.n - b.n),
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map(d => ({
      day: d.day, boards: d.boards, corrected: d.corrected, unsure: d.unsure, clients: [...d.clients].sort(), installs: [...d.installs].sort(),
      setups: [...d.setups.values()].sort((a, b) => a.by.localeCompare(b.by) || a.group.localeCompare(b.group)),
      ...(d.cards.size ? { cards: [...d.cards.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.version ?? '').localeCompare(b.version ?? '')) } : {}),
      ...(Object.keys(d.cardBoards).length ? { cardBoards: d.cardBoards } : {}),
    })),
  }
}

/** The dashboard's numbers from a digest. */
export function report(dg: Digest, now = new Date()): Stats {
  // a game that never got past its first instrument offer wasn't played: the Solver used to start a new game ID on
  // every board there (a reroll, a recheck), so most "games" seemed to stop at round 1. Those boards still count.
  const list = dg.games.filter(g => g.round > 1 || g.played)
  const today = now.toISOString().slice(0, 10)
  const rounds: Record<number, number> = {}
  const versions: Record<string, number> = {}
  for (const g of list) {
    // 0: the round was never read for sure (a screen the reader struggles with)
    rounds[g.read] = (rounds[g.read] ?? 0) + 1
    versions[g.version] = (versions[g.version] ?? 0) + 1
  }
  const finished = list.filter(g => g.final !== null)
  const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0 }
  const finals = finished.map(g => g.final!)
  const bands = new Map<number, { sum: number; games: number; reached: number }>()
  for (const g of finished) for (const p of g.predictions) {
    const k = Math.min(4, Math.floor(p * 5))
    const band = bands.get(k) ?? { sum: 0, games: 0, reached: 0 }
    band.sum += p
    band.games++
    if (g.final! >= TARGET) band.reached++
    bands.set(k, band)
  }
  const boards = dg.days.reduce((n, d) => n + d.boards, 0)
  const installs = new Set(dg.days.flatMap(d => d.installs))
  const setups = new Map<string, Setup>()
  for (const x of dg.days.flatMap(d => d.setups)) {
    const k = `${x.by}|${x.group}`
    const g = setups.get(k) ?? { by: x.by, group: x.group, boards: 0, unsure: 0, numbers: 0 }
    g.boards += x.boards
    g.unsure += x.unsure
    g.numbers += x.numbers
    setups.set(k, g)
  }
  // the cards' counts summed by name, over all of them or one release's
  const byCard = (counts: CardCount[]) => {
    const m = new Map<string, CardCount>()
    for (const c of counts) {
      const t = m.get(c.name) ?? m.set(c.name, { name: c.name, shown: 0, unsure: 0, corrected: 0 }).get(c.name)!
      t.shown += c.shown
      t.unsure += c.unsure
      t.corrected += c.corrected
    }
    return [...m.values()].sort((a, b) => b.unsure + b.corrected - (a.unsure + a.corrected) || b.shown - a.shown)
  }
  const dayCards = dg.days.flatMap(d => d.cards ?? [])
  // a release starts with its first game, played or not (a version's boards all belong to its games)
  const firsts = new Map<string, string>()
  for (const g of dg.games) if (!firsts.has(g.version) || g.start < firsts.get(g.version)!) firsts.set(g.version, g.start)
  const cardVersions = [...new Set(dayCards.flatMap(c => (c.version === undefined ? [] : [c.version])))]
    .map(version => ({ version, first: firsts.get(version) ?? '' }))
    .sort((a, b) => b.first.localeCompare(a.first)).slice(0, CARD_RELEASES)
  return {
    generated: now.toISOString(),
    finished: {
      games: finals.length, reached: finals.filter(f => f >= TARGET).length, finals,
      average: finals.length ? Math.round(finals.reduce((s, f) => s + f, 0) / finals.length) : 0, median: median(finals),
      capped: finals.length ? Math.round(finals.reduce((s, f) => s + Math.min(f, TARGET), 0) / finals.length) : 0,
    },
    calibration: [...bands.entries()].sort(([a], [b]) => a - b).map(([k, b]) => ({ band: `${k * 20}–${k * 20 + 20}%`, predicted: Math.round((100 * b.sum) / b.games) / 100, games: b.games, reached: b.reached })),
    totals: {
      boards, games: list.length, playersToday: dg.days.find(d => d.day === today)?.clients.length ?? 0,
      playersEver: installs.size, countedSince: dg.days.find(d => d.installs.length)?.day ?? null, playerDays: dg.days.reduce((n, d) => n + d.clients.length, 0),
    },
    days: dg.days.map(d => {
      const played = list.filter(g => g.day === d.day)
      const done = played.filter(g => g.final !== null)
      return {
        day: d.day, boards: d.boards, games: played.length, players: d.clients.length, website: played.filter(g => !g.app).length, app: played.filter(g => g.app).length,
        finished: done.length, averageFinal: done.length ? Math.round(done.reduce((s, g) => s + g.final!, 0) / done.length) : null,
        medianFinal: done.length ? median(done.map(g => g.final!)) : null,
      }
    }),
    rounds,
    corrected: boards ? dg.days.reduce((n, d) => n + d.corrected, 0) / boards : 0,
    unsure: boards ? dg.days.reduce((n, d) => n + d.unsure, 0) / boards : 0,
    problems: [...setups.values()].map(g => ({ ...g, unsure: g.unsure / g.boards, numbers: g.numbers / g.boards })).sort((a, b) => a.by.localeCompare(b.by) || b.boards - a.boards),
    versions,
    recent: [...list].sort((a, b) => b.start.localeCompare(a.start)).slice(0, RECENT).map(g => ({ start: g.start, boards: g.boards, round: g.round, app: g.app, score: g.final ?? g.score, finished: g.final !== null })),
    rolling: rolling([...finished].sort((a, b) => a.start.localeCompare(b.start))),
    releases: releases(list),
    cards: byCard(dayCards),
    cardReleases: cardVersions.map(({ version, first }) => ({
      version, first, boards: dg.days.reduce((n, d) => n + (d.cardBoards?.[version] ?? 0), 0), cards: byCard(dayCards.filter(c => c.version === version)),
    })),
  }
}

/** The dashboard's numbers straight from boards. */
export const summarize = (rows: StatRow[], now = new Date()): Stats => report(digest(rows), now)
