// Rebuilds a snapshot from the fields the collector knows, so nothing else a client sends is stored.
import { finalScore } from '../../src/engine/final'

export interface Names { potions: string[]; instruments: string[]; protocols: string[] }

const ARCHETYPES = ['pest', 'aemberon', 'boneSentry', 'agito']
const RARITIES = ['normal', 'magic', 'rare', 'boss']
const PHASES = ['potion', 'instrument', 'protocol']
const SOURCES = ['live', 'screenshot']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** The engine's cap on Activity and Quantity (src/ui/sandboxValidate.ts) */
const MAX_STAT = 1_000_000
const FIELD = /^(round|phase|refreshes|tank[0-5]\.(empty|archetype|rarity|activity|quantity)|hand[0-4]|instrument[0-3])$/

const int = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
const str = (v: unknown, re: RegExp): v is string => typeof v === 'string' && re.test(v)

export function validate(raw: unknown, names: Names) {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (!str(s.uid, UUID) || !str(s.run, UUID) || !int(s.seq, 0, 100) || !str(s.app, /^[\w.-]{1,24}$/)) return null
  if (!SOURCES.includes(s.source as string) || !str(s.trigger, /^(board|screen|manual|screenshot)$/)) return null
  if (!int(s.round, 1, 13) || !PHASES.includes(s.phase as string) || !int(s.refreshes, 0, 9) || !int(s.shelley, 1, 6)) return null
  if (!Array.isArray(s.tanks) || s.tanks.length !== 6) return null
  const tanks = []
  for (const t of s.tanks) {
    if (t === null) {
      tanks.push(null)
      continue
    }
    const m = t as Record<string, unknown>
    if (!ARCHETYPES.includes(m.archetype as string) || !RARITIES.includes(m.rarity as string) || !int(m.activity, 1, MAX_STAT) || !int(m.quantity, 1, MAX_STAT)) return null
    tanks.push({ archetype: m.archetype as string, rarity: m.rarity as string, activity: m.activity, quantity: m.quantity })
  }
  const pool = s.phase === 'potion' ? names.potions : s.phase === 'instrument' ? names.instruments : names.protocols
  // a Potion Kit opens to five cards
  if (!Array.isArray(s.hand) || s.hand.length > (s.phase === 'potion' ? 5 : 3) || !s.hand.every(n => pool.includes(n as string))) return null
  if (!Array.isArray(s.instruments) || s.instruments.length > 3 || !s.instruments.every(n => names.instruments.includes(n as string))) return null
  if (!Array.isArray(s.corrected) || s.corrected.length > 40 || !s.corrected.every(k => str(k, FIELD))) return null
  // the fields the Solver wasn't sure of: boards from before it sent unsure ones had none
  if (s.unsure !== undefined && (!Array.isArray(s.unsure) || s.unsure.length > 40 || !s.unsure.every(k => str(k, FIELD)))) return null
  return {
    uid: s.uid, run: s.run, seq: s.seq, app: s.app, source: s.source as string, trigger: s.trigger,
    // the random number a Solver makes once per browser or app, to count players: kept only as a well-formed one
    ...(str(s.install, UUID) ? { install: s.install } : {}),
    round: s.round, phase: s.phase as string, refreshes: s.refreshes, shelley: s.shelley, corrected: s.corrected as string[],
    tanks, hand: s.hand as string[], instruments: s.instruments as string[],
    ...(s.unsure !== undefined ? { unsure: s.unsure as string[] } : {}),
    ...(s.unreadable === true ? { unreadable: true } : {}),
    // the round-13 board's final score, as the Solver worked it out (it knows when each instrument was picked)
    ...(s.round === 13 && s.phase === 'protocol' && int(s.final, 0, 100 * MAX_STAT) ? { final: s.final } : {}),
    ...adviceOf(s.advice),
    ...debugOf(s.debug),
  }
}

type Board = NonNullable<ReturnType<typeof validate>>

/** What's stored of a board since Oct 24: its game, how it was read (debug included) and the advice's predicted end,
 *  but not its tanks, and of its cards (since Oct 26) only their names, which were unsure and which corrected: score, its total; picks, how many instruments it showed; final, on the round-13 board,
 *  the final score (the Solver's own, or worked out here with each instrument taken as picked in round 1, from a
 *  Solver from before it sent one). */
export function lean(b: Board) {
  const { tanks, hand, instruments, advice, final, ...rest } = b
  // the cards of the slots read unsure or corrected by hand, to find the cards the reader struggles with
  const named = (fields: string[]) => fields.flatMap(f => (/^hand\d$/.test(f) && hand[Number(f.slice(4))] ? [hand[Number(f.slice(4))]] : []))
  const end = b.round === 13 && b.phase === 'protocol' ? (final ?? finalScore(tanks as Parameters<typeof finalScore>[0], instruments)) : undefined
  return {
    ...rest,
    score: tanks.reduce((s, t) => s + (t ? (t.activity as number) * (t.quantity as number) : 0), 0),
    picks: instruments.length,
    // the hand's names only: how often each card is offered, against how often it was read unsure
    cards: hand,
    unsureCards: named(b.unsure ?? []),
    correctedCards: named(b.corrected),
    ...(end !== undefined ? { final: end } : {}),
    // the predicted end without the move, which names cards
    ...(advice ? { advice: { activity: advice.activity, reached: advice.reached, ...(advice.ms !== undefined ? { ms: advice.ms } : {}) } } : {}),
  }
}

const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const pair = (v: unknown, lo: number, hi: number): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(x => num(x, lo, hi))
const size = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(x => int(x, 0, 20_000))

/** What the reader saw and the player's setup, to find out why a setup misreads (src/solver/share/snapshot.ts
 *  SharedDebug): rebuilt from the keys it knows; anything malformed drops it, the board kept. */
function debugOf(raw: unknown): { debug?: Record<string, unknown> } {
  if (!raw || typeof raw !== 'object') return {}
  const d = raw as Record<string, unknown>
  if (!size(d.frame) || !num(d.dpr, 0.25, 8) || typeof d.hdr !== 'boolean' || !str(d.browser, /^[\w.]{1,16}( \d{1,4})?$/)) return {}
  if (!num(d.off, 0, 1) || typeof d.corrected !== 'boolean' || (d.ms !== undefined && !int(d.ms, 0, 600_000))) return {}
  if (!Array.isArray(d.tanks) || d.tanks.length > 6) return {}
  const tanks = []
  for (const t of d.tanks) {
    if (t === null) {
      tanks.push(null)
      continue
    }
    const m = t as Record<string, unknown>
    const rgb = m?.rgb
    // a broken read's lines can run long: kept, cut to length (a line of other characters isn't a read)
    if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(c => int(c, 0, 255)) || !str(m.total, /^[\dx]*$/) || !str(m.aq, /^[\dx]*$/)) return {}
    tanks.push({ rgb, total: m.total.slice(0, 16), aq: m.aq.slice(0, 16) })
  }
  if (!d.scores || typeof d.scores !== 'object' || Array.isArray(d.scores)) return {}
  const scores = Object.entries(d.scores as Record<string, unknown>)
  // match scores can land a hair outside -1..1 from rounding: clamped
  if (scores.length > 40 || !scores.every(([k, v]) => FIELD.test(k) && pair(v, -2, 2))) return {}
  const clamp1 = (v: [number, number]) => v.map(x => Math.max(-1, Math.min(1, x)))
  let win: { window?: { outer: [number, number]; client: [number, number]; scale: number } } = {}
  if (d.window !== undefined) {
    const w = d.window as Record<string, unknown>
    if (!w || !size(w.outer) || !size(w.client) || !num(w.scale, 0.25, 8)) return {}
    win = { window: { outer: w.outer, client: w.client, scale: w.scale } }
  }
  const timing = timingOf(d.timing)
  return {
    debug: {
      frame: d.frame, dpr: d.dpr, hdr: d.hdr, browser: d.browser, ...(d.ms !== undefined ? { ms: d.ms } : {}),
      off: d.off, corrected: d.corrected, tanks, scores: Object.fromEntries(scores.map(([k, v]) => [k, clamp1(v as [number, number])])), ...win,
      ...(timing ? { timing } : {}),
    },
  }
}

const WHY = ['done', 'acted', 'dealt', 'quiet', 'max']
const TIMES = ['lag', 'log', 'screen', 'pixels', 'names'] as const

/** How a live board's read went (src/solver/types.ts ReadTiming): the parts there are, each in range; anything
 *  off drops the timings alone. */
function timingOf(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (t.why !== undefined) {
    if (!WHY.includes(t.why as string)) return null
    out.why = t.why
  }
  for (const k of TIMES) {
    if (t[k] === undefined) continue
    // the log's lag can come out a little negative when the clocks differ by a hair
    if (!int(t[k], k === 'lag' ? -60_000 : 0, 600_000)) return null
    out[k] = t[k]
  }
  if (t.early !== undefined) {
    if (typeof t.early !== 'boolean') return null
    out.early = t.early
  }
  if (t.steps !== undefined) {
    if (!Array.isArray(t.steps) || t.steps.length > 5 || !t.steps.every(v => int(v, 1, 4))) return null
    out.steps = t.steps
  }
  return Object.keys(out).length ? out : null
}

/** The advice shown with a board ({ move, activity, reached }); a malformed one is dropped, the board kept. */
function adviceOf(raw: unknown): { advice?: { move: string; activity: number | null; reached: number | null; ms?: number } } {
  if (!raw || typeof raw !== 'object') return {}
  const a = raw as Record<string, unknown>
  const okActivity = a.activity === null || int(a.activity, 0, 100 * MAX_STAT)
  const okReached = a.reached === null || (typeof a.reached === 'number' && a.reached >= 0 && a.reached <= 1)
  if (!str(a.move, /^[^<>]{1,160}$/) || !okActivity || !okReached) return {}
  // how long it took to work out: kept when it's a sensible number
  const ms = int(a.ms, 0, 600_000) ? { ms: a.ms } : {}
  return { advice: { move: a.move, activity: a.activity as number | null, reached: a.reached as number | null, ...ms } }
}

