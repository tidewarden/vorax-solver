// @vitest-environment node
import { handle, type Store } from '../../worker/src/index'
import { memoryTraining } from './trainingStore'

type Row = { id: number; uid: string; client: string; body: string }
function memory(): Store & { summaries: string[]; batches: { id: number; received: string; body: string }[]; players: Set<string>; icons: Row[]; cards: Row[] } {
  const batches: { id: number; received: string; body: string }[] = []
  const players = new Set<string>()
  const icons: Row[] = []
  const cards: Row[] = []
  const summaries: string[] = []
  return {
    ...memoryTraining(),
    summaries,
    batches,
    players,
    icons,
    cards,
    async insertCard(r) {
      if (cards.some(x => x.uid === r.uid)) return 0
      cards.push({ id: cards.length + 1, ...r })
      return 1
    },
    async exportCards(after, limit) {
      return cards.filter(r => r.id > after).slice(0, limit)
    },
    async insertIcon(r) {
      if (icons.some(x => x.uid === r.uid)) return 0
      icons.push({ id: icons.length + 1, ...r })
      return 1
    },
    async exportIcons(after, limit) {
      return icons.filter(r => r.id > after).slice(0, limit)
    },
    async insertBatch(body) {
      batches.push({ id: batches.length + 1, received: '2026-10-18T10:00:00.000Z', body })
    },
    async seePlayer(day, client) {
      players.add(`${day}|${client}`)
    },
    async export(after, limit) {
      return batches.filter(r => r.id > after).slice(0, limit)
    },
    async rotate(upto) {
      if (!batches.some(r => r.id === upto - 1e9)) return null
      const dropped = batches.filter(r => r.id < upto - 1e9).length
      batches.splice(0, dropped)
      return { kept: batches.length, dropped }
    },
    async dayCounts() {
      return players.size ? [{ day: '2026-10-18', players: players.size }] : []
    },
    async summary() {
      return summaries.length ? JSON.parse(summaries[summaries.length - 1]) : null
    },
    async saveSummary(body) {
      summaries.push(body)
    },
  }
}

const env = { EXPORT_TOKEN: 'secret', IP_SALT: 'salt', LIMIT: { limit: async () => ({ success: true }) } }
const snap = (uid: string) => ({
  uid, run: '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', seq: 0, app: 'abc', source: 'live', trigger: 'board', round: 1, phase: 'potion', refreshes: 3, shelley: 6, corrected: [],
  tanks: [null, null, null, null, null, null], hand: ['Xeno-Hormone'], instruments: [],
})
const uid = (n: number) => `0b6f1f4e-6a37-4c1e-9d0e-${String(n).padStart(12, '0')}`
const post = (body: unknown, ip = '9.9.9.9') => new Request('https://w.dev/v1/snapshots', { method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': ip, origin: 'https://tidewarden.github.io' } })

it('stores the valid snapshots of an upload together, in one row, each once; drops the rest', async () => {
  const store = memory()
  const res = await handle(post([snap(uid(1)), snap(uid(1)), snap(uid(2)), { junk: true }]), env, store)
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ stored: 2, dropped: 2 })
  expect(store.batches).toHaveLength(1)
  expect(JSON.parse(store.batches[0].body).map((s: { uid: string }) => s.uid)).toEqual([uid(1), uid(2)])
})

it('stores each board without its tanks: its total, how many instruments, its cards’ names only, and the advice’s predicted end', async () => {
  const store = memory()
  const tank = { archetype: 'pest', rarity: 'magic', activity: 50, quantity: 200 }
  const advice = { move: 'Play Xeno-Hormone (card 1) → tank 1', activity: 812000, reached: 0.4 }
  await handle(post([{ ...snap(uid(1)), tanks: [tank, tank, null, null, null, null], instruments: ['Incubation Sac'], advice }]), env, store)
  const [b] = JSON.parse(store.batches[0].body)
  expect(b).toMatchObject({ uid: uid(1), round: 1, phase: 'potion', score: 20_000, picks: 1, advice: { activity: 812000, reached: 0.4 } })
  expect(b).not.toHaveProperty('tanks')
  expect(b).not.toHaveProperty('hand')
  expect(b).not.toHaveProperty('instruments')
  expect(b).not.toHaveProperty('final')
  expect(b.cards).toEqual(['Xeno-Hormone'])
  // the advice's move and the instruments' names aren't kept
  expect(store.batches[0].body).not.toMatch(/Play |Incubation Sac/)
})

it('the round-13 board keeps its final score: the Solver’s own, or worked out from its tanks for a Solver from before', async () => {
  const store = memory()
  const tank = { archetype: 'pest', rarity: 'magic', activity: 500, quantity: 1000 }
  const last = { ...snap(uid(1)), round: 13, phase: 'protocol', hand: [], tanks: [tank, null, null, null, null, null] }
  await handle(post([last, { ...last, uid: uid(2), final: 612_345 }]), env, store)
  expect(JSON.parse(store.batches[0].body).map((b: { final: number }) => b.final)).toEqual([500_000, 612_345])
})

it('an upload with nothing valid in it stores nothing', async () => {
  const store = memory()
  expect(await (await handle(post([{ junk: true }]), env, store)).json()).toEqual({ stored: 0, dropped: 1 })
  expect(store.batches).toHaveLength(0)
  expect(store.players.size).toBe(0)
})

it('never stores the address', async () => {
  const store = memory()
  await handle(post([snap(uid(1))], '1.2.3.4'), env, store)
  expect(JSON.stringify(store.batches)).not.toContain('1.2.3.4')
  expect([...store.players].join()).not.toContain('1.2.3.4')
})

it('counts each player once a day by their daily code, however often they upload', async () => {
  const store = memory()
  await handle(post([snap(uid(1))], '1.1.1.1'), env, store)
  await handle(post([snap(uid(2))], '1.1.1.1'), env, store)
  await handle(post([snap(uid(3))], '2.2.2.2'), env, store)
  expect(store.players.size).toBe(2)
  expect([...store.players].every(k => /^\d{4}-\d\d-\d\d\|[0-9a-f]{24}$/.test(k))).toBe(true)
})

it('empties the uploads up to what was pulled, with the export token', async () => {
  const store = memory()
  for (const n of [1, 2, 3]) await handle(post([snap(uid(n))]), env, store)
  const rotate = (upto: number, token = 'secret') => handle(new Request(`https://w.dev/v1/export/rotate?upto=${upto}`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }), env, store)
  expect((await rotate(1e9 + 2, 'nope')).status).toBe(401)
  expect((await rotate(2)).status).toBe(400)
  expect((await rotate(1e9 + 9)).status).toBe(409)
  expect(await (await rotate(1e9 + 2)).json()).toEqual({ kept: 2, dropped: 1 })
  expect(store.batches.map(r => r.id)).toEqual([2, 3])
})

it('takes 1 to 10 snapshots per upload', async () => {
  expect((await handle(post([]), env, memory())).status).toBe(400)
  expect((await handle(post(Array.from({ length: 11 }, (_, i) => snap(uid(i)))), env, memory())).status).toBe(400)
})

it('rate-limited uploads get 429', async () => {
  const limited = { ...env, LIMIT: { limit: async () => ({ success: false }) } }
  expect((await handle(post([snap(uid(1))]), limited, memory())).status).toBe(429)
})

it('export needs the token', async () => {
  const store = memory()
  await handle(post([snap(uid(1))]), env, store)
  await handle(post([snap(uid(2)), snap(uid(3))]), env, store)
  expect((await handle(new Request('https://w.dev/v1/export?after=0'), env, store)).status).toBe(401)
  const res = await handle(new Request('https://w.dev/v1/export?after=1', { headers: { authorization: 'Bearer secret' } }), env, store)
  const body = await res.json() as { rows: { id: number; body: string }[]; last: number }
  expect(body.rows.map(r => r.id)).toEqual([2])
  expect(JSON.parse(body.rows[0].body)).toHaveLength(2)
  expect(body.last).toBe(2)
})

it('exports refuse everyone when the token is unset, "Bearer undefined" too', async () => {
  const unset = { ...env, EXPORT_TOKEN: undefined }
  const store = memory()
  await handle(post([snap(uid(1))]), unset, store)
  const as = (path: string, method = 'GET') => handle(new Request(`https://w.dev${path}`, { method, headers: { authorization: 'Bearer undefined' } }), unset, store)
  for (const path of ['/v1/export?after=0', '/v1/icons/export?after=0', '/v1/cards/export?after=0']) expect((await as(path)).status).toBe(401)
  expect((await as('/v1/export/rotate?upto=1000000002', 'POST')).status).toBe(401)
  expect((await as('/v1/summary', 'PUT')).status).toBe(401)
})

it('CORS also allows the local test server, for games played through a test copy of Vorax Overlay', async () => {
  const res = await handle(new Request('https://w.dev/v1/snapshots', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }), env, memory())
  expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
})

it('CORS allows only the published site, at either of its homes', async () => {
  const res = await handle(new Request('https://w.dev/v1/snapshots', { method: 'OPTIONS', headers: { origin: 'https://tidewarden.github.io' } }), env, memory())
  expect(res.headers.get('access-control-allow-origin')).toBe('https://tidewarden.github.io')
  const pages = await handle(new Request('https://w.dev/v1/snapshots', { method: 'OPTIONS', headers: { origin: 'https://voraxlab.pages.dev' } }), env, memory())
  expect(pages.headers.get('access-control-allow-origin')).toBe('https://voraxlab.pages.dev')
  const other = await handle(new Request('https://w.dev/v1/snapshots', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env, memory())
  expect(other.headers.get('access-control-allow-origin')).toBe('https://tidewarden.github.io')
})

it('anything else is 404', async () => {
  expect((await handle(new Request('https://w.dev/'), env, memory())).status).toBe(404)
})

it('refuses an oversized body without reading it as JSON', async () => {
  const big = new Request('https://w.dev/v1/snapshots', { method: 'POST', body: JSON.stringify([{ pad: 'x'.repeat(70_000) }]), headers: { 'cf-connecting-ip': '9.9.9.9' } })
  expect((await handle(big, env, memory())).status).toBe(413)
})

const pattern = () => {
  const v = Array.from({ length: 576 }, (_, i) => Math.sin(i))
  const n = Math.hypot(...v)
  return v.map(x => Math.round((x / n) * 1000) / 1000 || 0)
}
const icon = (body: unknown) => new Request('https://w.dev/v1/icons', { method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': '9.9.9.9' } })

it('stores a named instrument icon once', async () => {
  const store = memory()
  const body = { uid: uid(7), name: 'Egg-Burdened Butterfly', pattern: pattern() }
  expect((await handle(icon(body), env, store)).status).toBe(200)
  await handle(icon(body), env, store)
  expect(store.icons).toHaveLength(1)
  expect(JSON.parse(store.icons[0].body)).toEqual(body)
})

it.each([
  ['an unknown instrument', { name: 'Not An Instrument' }],
  ['a short pattern', { pattern: [0.1, 0.2] }],
  ['a pattern that is not a unit vector', { pattern: Array(576).fill(0.5) }],
  ['a bad uid', { uid: 'x' }],
])('refuses an icon with %s', async (_, patch) => {
  const store = memory()
  const res = await handle(icon({ uid: uid(8), name: 'Egg-Burdened Butterfly', pattern: pattern(), ...patch }), env, store)
  expect(res.status).toBe(400)
  expect(store.icons).toHaveLength(0)
})

it('icons export only with the token', async () => {
  const store = memory()
  await handle(icon({ uid: uid(9), name: 'Egg-Burdened Butterfly', pattern: pattern() }), env, store)
  expect((await handle(new Request('https://w.dev/v1/icons/export?after=0'), env, store)).status).toBe(401)
  const res = await handle(new Request('https://w.dev/v1/icons/export?after=0', { headers: { authorization: 'Bearer secret' } }), env, store)
  expect((await res.json()).rows).toHaveLength(1)
})

const card = (body: unknown) => new Request('https://w.dev/v1/cards', { method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': '9.9.9.9' } })
const jpeg = 'data:image/jpeg;base64,' + 'A'.repeat(4000)

describe('a card the Solver couldn’t name', () => {
  it('is stored once, with its title as read and a small picture of it', async () => {
    const store = memory()
    const body = { uid: uid(11), phase: 'potion', text: 'First Rite Holy Water: Confession\nThe throat is not only for', picture: jpeg }
    expect((await handle(card(body), env, store)).status).toBe(200)
    await handle(card(body), env, store)
    expect(store.cards).toHaveLength(1)
    expect(JSON.parse(store.cards[0].body)).toEqual(body)
  })
  it('keeps nothing else, and refuses anything that isn’t a card picture', async () => {
    const store = memory()
    await handle(card({ uid: uid(12), phase: 'potion', text: 'A card', picture: 'data:image/png;base64,AAAA', screen: 'x' }), env, store)
    expect(JSON.parse(store.cards[0].body)).toEqual({ uid: uid(12), phase: 'potion', text: 'A card' })
    expect((await handle(card({ uid: uid(13), phase: 'potion', text: '' }), env, store)).status).toBe(400)
    expect((await handle(card({ uid: uid(14), phase: 'menu', text: 'A card' }), env, store)).status).toBe(400)
    expect((await handle(card({ uid: uid(15), phase: 'potion', text: 'x'.repeat(2000) }), env, store)).status).toBe(200)
    expect(JSON.parse(store.cards[1].body).text).toHaveLength(400)
  })
  it('is exported with the token only', async () => {
    const store = memory()
    await handle(card({ uid: uid(16), phase: 'instrument', text: 'A new instrument' }), env, store)
    expect((await handle(new Request('https://w.dev/v1/cards/export?after=0'), env, store)).status).toBe(401)
    const res = await handle(new Request('https://w.dev/v1/cards/export?after=0', { headers: { authorization: 'Bearer secret' } }), env, store)
    expect((await res.json()).rows).toHaveLength(1)
  })
})

describe('the dashboard summary the hourly workflow sends', () => {
  const stats = { generated: '2026-10-22T13:00:00.000Z', totals: { games: 3 }, days: [], finished: { games: 1 }, recent: [] }
  const put = (body: string, token = 'secret') => new Request('https://w.dev/v1/summary', { method: 'PUT', body, headers: { authorization: `Bearer ${token}` } })
  it('needs the export token', async () => {
    const store = memory()
    expect((await handle(put(JSON.stringify(stats), 'wrong'), env, store)).status).toBe(401)
    expect(store.summaries).toHaveLength(0)
  })
  it('is stored when it is one', async () => {
    const store = memory()
    expect((await handle(put('nope'), env, store)).status).toBe(400)
    expect((await handle(put('{"totals":{}}'), env, store)).status).toBe(400)
    const ok = await handle(put(JSON.stringify(stats)), env, store)
    expect(await ok.json()).toEqual({ saved: stats.generated })
    expect(store.summaries).toEqual([JSON.stringify(stats)])
  })
  it('is served with the collector’s own counts, which need the dashboard password', async () => {
    const store = memory()
    const denv = { ...env, DASHBOARD_TOKEN: 'pw' }
    await handle(put(JSON.stringify(stats)), denv, store)
    await handle(post([snap(uid(1)), snap(uid(2))]), denv, store)
    expect((await handle(new Request('https://w.dev/v1/stats', { headers: { authorization: 'Bearer secret' } }), denv, store)).status).toBe(401)
    const s = await (await handle(new Request('https://w.dev/v1/stats', { headers: { authorization: 'Bearer pw' } }), denv, store)).json()
    expect(s.totals).toMatchObject({ games: 3, playerDays: 1 })
    expect(s.days).toEqual([expect.objectContaining({ day: '2026-10-18', players: 1, games: 0 })])
  })
})

describe('training data endpoints', () => {
  const ask = (body: unknown) => new Request('https://w.dev/v1/training/ask', { method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': '9.9.9.9', origin: 'https://voraxlab.pages.dev' } })
  it('want nothing without a token: the feature is off until TRAINING_TOKEN is set', async () => {
    expect(await (await handle(ask({ phase: 'instrument', name: 'Egg-Burdened Butterfly' }), env, memory())).json()).toEqual({ want: false })
  })
  it('want nothing, and file nothing, while the flag is off (wrangler.jsonc ships it off)', async () => {
    const off = { ...env, TRAINING_TOKEN: 't', TRAINING_UPLOADS: 'off' }
    expect(await (await handle(ask({ phase: 'instrument', name: 'Egg-Burdened Butterfly' }), off, memory())).json()).toEqual({ want: false })
    const shot = new Request('https://w.dev/v1/training', { method: 'POST', body: '{}', headers: { 'cf-connecting-ip': '9.9.9.9' } })
    expect(await (await handle(shot, off, memory())).json()).toEqual({ want: false })
    const { readFileSync } = await import('node:fs')
    expect(JSON.parse(readFileSync('worker/wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '')).vars.TRAINING_UPLOADS).toBe('off')
  })
  it('with one and the flag on, want a card not yet filed, and refuse anything that isn’t a card', async () => {
    const withToken = { ...env, TRAINING_TOKEN: 't', TRAINING_UPLOADS: 'on' }
    expect(await (await handle(ask({ phase: 'instrument', name: 'Egg-Burdened Butterfly' }), withToken, memory())).json()).toEqual({ want: true })
    expect((await handle(ask({ phase: 'instrument', name: 'Not A Card' }), withToken, memory())).status).toBe(400)
    const big = new Request('https://w.dev/v1/training/ask', { method: 'POST', body: 'x'.repeat(3000), headers: { 'cf-connecting-ip': '9.9.9.9' } })
    expect((await handle(big, withToken, memory())).status).toBe(413)
  })
})
