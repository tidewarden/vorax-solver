// The live-data collector: a Cloudflare Worker with a D1 database. The Solver posts the boards it read;
// the nightly jobs (scripts/nightly.sh) pull them with the export token. No addresses are stored: players are
// counted by a salted hash that changes every day. The free plan allows 100,000 row writes a day, so an upload
// is one row however many boards it carries, and a player one row a day.
import names from './names.json'
import { lean, validate, validateCard, validateIcon } from './validate'
import type { Stats } from './stats'
import { isStats, withCounts, type DayCount } from './summary'
import { DASHBOARD_HTML } from './dashboard'
import { dispatch, FILES, LISTED, onSchedule, repoFile, repoRuns, RUNNABLE } from './schedule'
import { fileShot, MAX_ASK, MAX_PICTURE, validateCard as validateTrainingCard, validateShot, wanted, type TrainingRow, type TrainingStore } from './training'

export interface Store extends TrainingStore {
  /** stores an upload's boards, a JSON array, as one row */
  insertBatch(body: string): Promise<void>
  /** notes a daily player code as seen that day: a write only the first time */
  seePlayer(day: string, client: string): Promise<void>
  /** uploads after an id (ids from BATCHES on; boards were stored one per row before Oct 23, ids below it),
   *  about `limit` boards: an upload per row, its body an array of boards */
  export(after: number, limit: number): Promise<{ id: number; received: string; body: string }[]>
  /** empties the uploads table up to an export id the nightly jobs have pulled, without a row write per upload (a
   *  DELETE costs one per row, a DROP TABLE none): the uploads from that one on move to a new table, so ids carry
   *  on; null when no upload has that id */
  rotate(upto: number): Promise<{ kept: number; dropped: number } | null>
  /** stores an icon with a new uid; returns 1 if it was new */
  insertIcon(row: { uid: string; client: string; body: string }): Promise<number>
  exportIcons(after: number, limit: number): Promise<{ id: number; uid: string; client: string; body: string }[]>
  /** stores a card the Solver couldn't name, with a new uid; returns 1 if it was new */
  insertCard(row: { uid: string; client: string; body: string }): Promise<number>
  exportCards(after: number, limit: number): Promise<{ id: number; uid: string; client: string; body: string }[]>
  /** different daily player codes per day, for the dashboard's counts */
  dayCounts(): Promise<DayCount[]>
  /** the dashboard's numbers the nightly jobs last worked out (summary.ts), or null before the first */
  summary(): Promise<Stats | null>
  saveSummary(body: string): Promise<void>
}

export interface Env {
  /** the nightly jobs' token for the exports (wrangler secret put EXPORT_TOKEN): unset, they refuse everyone */
  EXPORT_TOKEN?: string
  /** the analytics page's password (wrangler secret put DASHBOARD_TOKEN) */
  DASHBOARD_TOKEN?: string
  /** starts the repo's workflows on schedule, and reads the private repo for the dashboard (src/schedule.ts) */
  GITHUB_DISPATCH_TOKEN?: string
  IP_SALT: string
  /** opens the training-data issues and commits their screenshots in the private repo (src/training.ts) */
  TRAINING_TOKEN?: string
  /** "on" to keep the boards, named icons and unnamed cards the Solver sends; anything else answers them as stored
   * but keeps none (players are still counted, for the dashboard). wrangler.jsonc "vars" */
  COLLECTING?: string
  /** "on" to take training data; anything else wants no card (wrangler.jsonc "vars"; off since 2026-10-29) */
  TRAINING_UPLOADS?: string
  LIMIT: { limit(o: { key: string }): Promise<{ success: boolean }> }
  DB?: D1Like
}

interface D1Bound { run(): Promise<{ meta: { changes: number } }>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }> }
interface D1Like {
  prepare(sql: string): { bind(...v: unknown[]): D1Bound }
  /** the statements in one transaction */
  batch(statements: D1Bound[]): Promise<unknown>
}

const ORIGIN = 'https://tidewarden.github.io'
/** the site's second home while both are served (Cloudflare Pages, deploy.yml), and the local test server:
 *  Vorax Overlay pointed at it plays real games (any other origin gets the site's) */
const ORIGINS = [ORIGIN, 'https://voraxlab.pages.dev', 'http://localhost:5173']
const MAX_BATCH = 10
const MAX_BYTES = 64_000
const EXPORT_MAX = 5000
/** where the uploads' ids start in the export, after the boards stored one per row before them */
export const BATCHES = 1_000_000_000
/** the workflow's summary is tens of kilobytes */
const MAX_SUMMARY = 1_000_000

const corsFor = (req: Request) => {
  const origin = req.headers.get('origin') ?? ''
  return { 'access-control-allow-origin': ORIGINS.includes(origin) ? origin : ORIGIN, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' }
}
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } })

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('')
}

export async function handle(req: Request, env: Env, store: Store): Promise<Response> {
  const url = new URL(req.url)
  const cors = corsFor(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  if (url.pathname === '/v1/snapshots' && req.method === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
    const day = new Date().toISOString().slice(0, 10)
    const client = (await sha256(`${env.IP_SALT}|${day}|${ip}`)).slice(0, 24)
    if (!(await env.LIMIT.limit({ key: client })).success) return json({ error: 'slow down' }, 429, cors)
    // ten snapshots are a few kilobytes: anything far bigger isn't from the Solver
    const text = await req.text()
    if (text.length > MAX_BYTES) return json({ error: 'too large' }, 413, cors)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return json({ error: 'not JSON' }, 400, cors)
    }
    if (!Array.isArray(body) || body.length < 1 || body.length > MAX_BATCH) return json({ error: `1 to ${MAX_BATCH} snapshots` }, 400, cors)
    // a board sent twice in one upload is kept once; an upload sent twice is sorted out by the pull
    const seen = new Set<unknown>()
    const valid = body.map(s => validate(s, names)).filter((s): s is NonNullable<typeof s> => s !== null && !seen.has(s.uid) && !!seen.add(s.uid))
    if (valid.length) {
      if (env.COLLECTING === 'on') await store.insertBatch(JSON.stringify(valid.map(lean)))
      await store.seePlayer(day, client)
    }
    return json({ stored: valid.length, dropped: body.length - valid.length }, 200, cors)
  }

  if (url.pathname === '/v1/icons' && req.method === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
    const day = new Date().toISOString().slice(0, 10)
    const client = (await sha256(`${env.IP_SALT}|${day}|${ip}`)).slice(0, 24)
    if (!(await env.LIMIT.limit({ key: client })).success) return json({ error: 'slow down' }, 429, cors)
    const text = await req.text()
    if (text.length > MAX_BYTES) return json({ error: 'too large' }, 413, cors)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return json({ error: 'not JSON' }, 400, cors)
    }
    const icon = validateIcon(raw, names)
    if (!icon) return json({ error: 'not an icon' }, 400, cors)
    // collection off: answered as stored, so the Solver doesn't send it again
    const stored = env.COLLECTING === 'on' ? await store.insertIcon({ uid: icon.uid as string, client, body: JSON.stringify(icon) }) : 1
    return json({ stored }, 200, cors)
  }

  // training data (src/training.ts): whether a card's screenshot is still wanted, then the screenshot itself
  if ((url.pathname === '/v1/training/ask' || url.pathname === '/v1/training') && req.method === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
    const day = new Date().toISOString().slice(0, 10)
    const client = (await sha256(`${env.IP_SALT}|${day}|${ip}`)).slice(0, 24)
    if (!(await env.LIMIT.limit({ key: client })).success) return json({ error: 'slow down' }, 429, cors)
    if (!env.TRAINING_TOKEN || env.TRAINING_UPLOADS !== 'on') return json({ want: false }, 200, cors)
    const ask = url.pathname === '/v1/training/ask'
    const text = await req.text()
    if (text.length > (ask ? MAX_ASK : MAX_PICTURE + 4_000)) return json({ error: 'too large' }, 413, cors)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return json({ error: 'not JSON' }, 400, cors)
    }
    if (ask) {
      const card = validateTrainingCard(raw)
      return card ? json({ want: await wanted(store, card) }, 200, cors) : json({ error: 'not a card' }, 400, cors)
    }
    const shot = validateShot(raw)
    if (!shot) return json({ error: 'not a screenshot' }, 400, cors)
    return json(await fileShot(store, shot, env.TRAINING_TOKEN, (u, i) => fetch(u, i)), 200, cors)
  }

  // a card the Solver couldn't name: one at a time, so its picture never weighs down a batch of boards
  if (url.pathname === '/v1/cards' && req.method === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
    const day = new Date().toISOString().slice(0, 10)
    const client = (await sha256(`${env.IP_SALT}|${day}|${ip}`)).slice(0, 24)
    if (!(await env.LIMIT.limit({ key: client })).success) return json({ error: 'slow down' }, 429, cors)
    const text = await req.text()
    if (text.length > MAX_BYTES) return json({ error: 'too large' }, 413, cors)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return json({ error: 'not JSON' }, 400, cors)
    }
    const card = validateCard(raw)
    if (!card) return json({ error: 'not a card' }, 400, cors)
    const stored = env.COLLECTING === 'on' ? await store.insertCard({ uid: card.uid as string, client, body: JSON.stringify(card) }) : 1
    return json({ stored }, 200, cors)
  }

  if (url.pathname === '/v1/cards/export' && req.method === 'GET') {
    if (!env.EXPORT_TOKEN || req.headers.get('authorization') !== `Bearer ${env.EXPORT_TOKEN}`) return json({ error: 'token' }, 401)
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0)
    const rows = await store.exportCards(after, EXPORT_MAX)
    return json({ rows, last: rows.length ? rows[rows.length - 1].id : after })
  }

  if (url.pathname === '/v1/icons/export' && req.method === 'GET') {
    if (!env.EXPORT_TOKEN || req.headers.get('authorization') !== `Bearer ${env.EXPORT_TOKEN}`) return json({ error: 'token' }, 401)
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0)
    const rows = await store.exportIcons(after, EXPORT_MAX)
    return json({ rows, last: rows.length ? rows[rows.length - 1].id : after })
  }

  if (url.pathname === '/v1/export' && req.method === 'GET') {
    if (!env.EXPORT_TOKEN || req.headers.get('authorization') !== `Bearer ${env.EXPORT_TOKEN}`) return json({ error: 'token' }, 401)
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0)
    const rows = await store.export(after, EXPORT_MAX)
    return json({ rows, last: rows.length ? rows[rows.length - 1].id : after })
  }

  // after the nightly jobs pulled: empties the uploads table up to what they pulled (Store rotate)
  if (url.pathname === '/v1/export/rotate' && req.method === 'POST') {
    if (!env.EXPORT_TOKEN || req.headers.get('authorization') !== `Bearer ${env.EXPORT_TOKEN}`) return json({ error: 'token' }, 401)
    const upto = Number(url.searchParams.get('upto'))
    if (!Number.isInteger(upto) || upto <= BATCHES) return json({ error: 'upto: an export id' }, 400)
    const done = await store.rotate(upto)
    return done ? json(done) : json({ error: 'no upload with that id' }, 409)
  }

  // The dashboard's numbers from the nightly jobs (scripts/live/summary.ts), with the export token
  if (url.pathname === '/v1/summary' && req.method === 'PUT') {
    if (!env.EXPORT_TOKEN || req.headers.get('authorization') !== `Bearer ${env.EXPORT_TOKEN}`) return json({ error: 'token' }, 401)
    const text = await req.text()
    if (text.length > MAX_SUMMARY) return json({ error: 'too large' }, 413)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return json({ error: 'not JSON' }, 400)
    }
    if (!isStats(body)) return json({ error: 'not a summary' }, 400)
    await store.saveSummary(text)
    return json({ saved: body.generated })
  }

  // The private analytics page and its numbers (counts only; see stats.ts and summary.ts).
  if (url.pathname === '/dashboard' && req.method === 'GET') {
    return new Response(DASHBOARD_HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })
  }
  // Run now, on the dashboard: starts one of the repo's loops (with the dashboard password)
  const run = /^\/v1\/run\/([\w.-]+)$/.exec(url.pathname)
  if (run && req.method === 'POST') {
    if (!env.DASHBOARD_TOKEN || req.headers.get('authorization') !== `Bearer ${env.DASHBOARD_TOKEN}`) return json({ error: 'password' }, 401)
    if (!RUNNABLE.has(run[1])) return json({ error: 'not a loop' }, 404)
    const why = await dispatch(run[1], env.GITHUB_DISPATCH_TOKEN)
    return why ? json({ error: why }, 502) : json({ started: run[1] })
  }
  // The dashboard's reads of the private repo (with the dashboard password): a few named files, and run lists
  const file = /^\/v1\/repo\/(\w+)$/.exec(url.pathname)
  const runs = /^\/v1\/runs\/([\w.-]+)$/.exec(url.pathname)
  if ((file || runs) && req.method === 'GET') {
    if (!env.DASHBOARD_TOKEN || req.headers.get('authorization') !== `Bearer ${env.DASHBOARD_TOKEN}`) return json({ error: 'password' }, 401)
    if (file ? !Object.hasOwn(FILES, file[1]) : !LISTED.has(runs![1])) return json({ error: 'not found' }, 404)
    const res = file ? await repoFile(file[1], env.GITHUB_DISPATCH_TOKEN) : await repoRuns(runs![1], env.GITHUB_DISPATCH_TOKEN)
    // a file not there yet reads as empty
    if (file && res.status === 404) return new Response('', { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
    if (!res.ok) return json({ error: `GitHub answered ${res.status}` }, 502)
    return new Response(res.body, { headers: { 'content-type': file ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store' } })
  }
  if (url.pathname === '/v1/stats' && req.method === 'GET') {
    if (!env.DASHBOARD_TOKEN || req.headers.get('authorization') !== `Bearer ${env.DASHBOARD_TOKEN}`) return json({ error: 'password' }, 401)
    const [summary, counts] = await Promise.all([store.summary(), store.dayCounts()])
    return json(withCounts(summary, counts), 200, { 'cache-control': 'no-store' })
  }

  return json({ error: 'not found' }, 404)
}

/** The D1 tables in schema.sql. */
export function d1Store(db: D1Like): Store {
  return {
    async insertBatch(body) {
      await db.prepare('INSERT INTO batches (received, body) VALUES (?, ?)').bind(new Date().toISOString(), body).run()
    },
    async seePlayer(day, client) {
      await db.prepare('INSERT OR IGNORE INTO players (day, client) VALUES (?, ?)').bind(day, client).run()
    },
    async export(after, limit) {
      // an upload is up to 10 boards. Ordered by the table's id, not the shifted id it's returned as: sorting by that
      // read every later row for each page (4.3M rows a day, Oct 25)
      const { results } = await db.prepare('SELECT id + ? AS id, received, body FROM batches WHERE id > ? ORDER BY batches.id LIMIT ?')
        .bind(BATCHES, Math.max(0, after - BATCHES), Math.ceil(limit / MAX_BATCH)).all<{ id: number; received: string; body: string }>()
      return results
    },
    async rotate(upto) {
      const id = upto - BATCHES
      if (!(await db.prepare('SELECT 1 AS x FROM batches WHERE id = ?').bind(id).first())) return null
      const n = await db.prepare('SELECT (SELECT COUNT(*) FROM batches WHERE id >= ?) AS kept, COUNT(*) AS total FROM batches').bind(id).first<{ kept: number; total: number }>()
      // the pulled upload itself stays as the newest one there, so the next id is one past it
      await db.batch([
        db.prepare('CREATE TABLE batches_next (id INTEGER PRIMARY KEY, received TEXT NOT NULL, body TEXT NOT NULL)').bind(),
        db.prepare('INSERT INTO batches_next SELECT id, received, body FROM batches WHERE id >= ?').bind(id),
        db.prepare('DROP TABLE batches').bind(),
        db.prepare('ALTER TABLE batches_next RENAME TO batches').bind(),
      ])
      return { kept: n!.kept, dropped: n!.total - n!.kept }
    },
    async insertIcon(r) {
      const res = await db.prepare('INSERT OR IGNORE INTO icons (uid, received, client, body) VALUES (?, ?, ?, ?)').bind(r.uid, new Date().toISOString(), r.client, r.body).run()
      return res.meta.changes
    },
    async exportIcons(after, limit) {
      const { results } = await db.prepare('SELECT id, uid, received, body FROM icons WHERE id > ? ORDER BY id LIMIT ?').bind(after, limit).all<{ id: number; uid: string; client: string; body: string }>()
      return results
    },
    async insertCard(r) {
      const res = await db.prepare('INSERT OR IGNORE INTO cards (uid, received, client, body) VALUES (?, ?, ?, ?)').bind(r.uid, new Date().toISOString(), r.client, r.body).run()
      return res.meta.changes
    },
    async exportCards(after, limit) {
      const { results } = await db.prepare('SELECT id, uid, received, body FROM cards WHERE id > ? ORDER BY id LIMIT ?').bind(after, limit).all<{ id: number; uid: string; client: string; body: string }>()
      return results
    },
    async training(key) {
      return db.prepare('SELECT key, title, issue, shots, created FROM training WHERE key = ?').bind(key).first<TrainingRow>()
    },
    async claimTraining(key, title, created) {
      const res = await db.prepare('INSERT OR IGNORE INTO training (key, title, issue, shots, created) VALUES (?, ?, NULL, 0, ?)').bind(key, title, created).run()
      return res.meta.changes === 1
    },
    async setTrainingIssue(key, issue) {
      await db.prepare('UPDATE training SET issue = ? WHERE key = ?').bind(issue, key).run()
    },
    async addTrainingShot(key) {
      await db.prepare('UPDATE training SET shots = shots + 1 WHERE key = ?').bind(key).run()
    },
    async dropTraining(key) {
      await db.prepare('DELETE FROM training WHERE key = ?').bind(key).run()
    },
    async dayCounts() {
      // a row per player per day, in key order: thousands of rows, not every board
      const { results } = await db.prepare('SELECT day, COUNT(*) AS players FROM players GROUP BY day ORDER BY day').bind().all<DayCount>()
      return results
    },
    async summary() {
      const row = await db.prepare('SELECT body FROM summary WHERE id = 1').bind().first<{ body: string }>()
      return row ? (JSON.parse(row.body) as Stats) : null
    },
    async saveSummary(body) {
      await db.prepare('INSERT INTO summary (id, updated, body) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET updated = excluded.updated, body = excluded.body').bind(new Date().toISOString(), body).run()
    },
  }
}

export default {
  fetch: (req: Request, env: Env) => handle(req, env, d1Store(env.DB!)),
  scheduled: (event: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) => ctx.waitUntil(onSchedule(event.cron, env)),
}
