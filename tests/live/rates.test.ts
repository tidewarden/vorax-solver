import { LIVE_WEIGHTS } from '@/data/liveWeights'
import { computeRates, wilson } from '../../scripts/live/rates'
import type { Snapshot } from '@/solver/share/snapshot'

const base = (o: Partial<Snapshot>): Snapshot => ({
  uid: Math.random().toString(), run: 'r1', seq: 0, app: 'a', source: 'live', trigger: 'board', round: 1, phase: 'potion', refreshes: 3,
  tanks: [null, null, null, null, null, null], hand: [], instruments: [], shelley: 6, corrected: [], ...o,
})

it('Wilson bounds for 30 of 100', () => {
  const w = wilson(30, 100)
  expect(w.lo).toBeCloseTo(0.219, 2)
  expect(w.hi).toBeCloseTo(0.396, 2)
})

it('counts offers, instruments and starting tanks from a run', () => {
  const rows = [
    base({ seq: 0, phase: 'instrument', hand: ['Hypertrophic Pituitary', 'Contracted Claws', 'Adherent Metatarsals'], refreshes: 2,
      tanks: [{ archetype: 'pest', rarity: 'magic', activity: 5, quantity: 24 }, { archetype: 'agito', rarity: 'normal', activity: 1, quantity: 36 }, null, null, null, null] }),
    base({ seq: 1, round: 1, hand: ['Xeno-Hormone', 'Mutagenic Powder', 'Green Bile Solution'] }),
    base({ seq: 2, round: 2, hand: ['Xeno-Hormone', 'Purest Holy Water', 'Green Bile Solution'] }),
  ]
  const r = computeRates(rows)
  expect(r.boards).toBe(3)
  expect(r.runs).toBe(1)
  expect(r.potionOffer['Xeno-Hormone'].count).toBe(2)
  expect(r.potionOffer['Xeno-Hormone'].n).toBe(6)
  expect(r.supreme.count).toBe(1)
  expect(r.supreme.n).toBe(6)
  expect(r.instrumentOffer.basic['Hypertrophic Pituitary'].count).toBe(1)
  expect(r.spawnRarity.magic.count).toBe(1)
  expect(r.spawnRarity.normal.count).toBe(1)
  expect(r.spawnRarity.normal.n).toBe(2)
  expect(r.spawnArchetype.pest.count).toBe(1)
  expect(r.supreme.engine).toBe(LIVE_WEIGHTS.supremeChance)
})

it('a reward pick after round 1 is an advanced offer, though the screen still shows round 1', () => {
  // the first pick (nothing held) is from the basic pool; Ultimate Activity's reward at the end of round 1 is
  // offered while the round panel still says 1, from the advanced pool (src/engine/game.ts instrumentPool)
  const rows = [
    base({ seq: 0, phase: 'instrument', round: 1, hand: ['Hypertrophic Pituitary', 'Contracted Claws', 'Adherent Metatarsals'] }),
    base({ seq: 1, phase: 'instrument', round: 1, instruments: ['Contracted Claws'], hand: ['Nettle Toggle', 'Fouled Scraper', 'Clustered Eggs'] }),
    base({ seq: 2, phase: 'instrument', round: 3, instruments: ['Contracted Claws', 'Nettle Toggle'], hand: ['Sinew Garrote', 'Fouled Scraper', 'Rawhide Restraint'] }),
  ]
  const r = computeRates(rows)
  expect(r.instrumentOffer.basic['Hypertrophic Pituitary'].n).toBe(3)
  expect(r.instrumentOffer.basic['Nettle Toggle']).toBeUndefined()
  expect(r.instrumentOffer.advanced['Fouled Scraper'].count).toBe(2)
  expect(r.instrumentOffer.advanced['Fouled Scraper'].n).toBe(6)
})

it('the same offer read twice in one round counts once', () => {
  const offer = { round: 4, refreshes: 2, hand: ['Xeno-Hormone', 'Mutagenic Powder', 'Green Bile Solution'] }
  const r = computeRates([base({ seq: 3, ...offer }), base({ seq: 4, ...offer })])
  expect(r.potionOffer['Xeno-Hormone'].n).toBe(3)
})

it('pull pages through the export until it runs dry', async () => {
  const { pull } = await import('../../scripts/live/collect')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(`${tmpdir()}/pull-`)
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    const pages = [
      { rows: [{ id: 1, uid: 'a', received: '2026-10-18T01:00:00Z', body: '{"x":1}' }, { id: 2, uid: 'b', received: '2026-10-19T01:00:00Z', body: '{"x":2}' }], last: 2 },
      { rows: [], last: 2 },
    ]
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(pages.shift())))
    expect(await pull('https://w.dev', 't', fetchFn as unknown as typeof fetch)).toBe(2)
    expect((fetchFn.mock.calls[0] as unknown[])[0]).toBe('https://w.dev/v1/export?after=0')
    const fs = await import('node:fs')
    expect(fs.readFileSync('data/live/raw/2026-10-19.jsonl', 'utf8')).toBe('{"received":"2026-10-19T01:00:00Z","x":2}\n')
    expect(JSON.parse(fs.readFileSync('data/live/state.json', 'utf8')).last).toBe(2)
  } finally {
    process.chdir(cwd)
  }
})

it('pull spreads an upload’s boards out, and keeps each board once though its upload came twice', async () => {
  const { pull } = await import('../../scripts/live/collect')
  const fs = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = fs.mkdtempSync(`${tmpdir()}/batches-`)
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    fs.mkdirSync('data/live/raw', { recursive: true })
    fs.writeFileSync('data/live/raw/2026-10-22.jsonl', '{"received":"2026-10-22T01:00:00Z","uid":"a","x":0}\n')
    const pages = [
      { rows: [
        { id: 1_000_000_001, received: '2026-10-23T01:00:00Z', body: '[{"uid":"a","x":1},{"uid":"b","x":2}]' },
        // the same upload again (its answer was lost, so the Solver sent it twice)
        { id: 1_000_000_002, received: '2026-10-23T01:00:05Z', body: '[{"uid":"b","x":2},{"uid":"c","x":3}]' },
      ], last: 1_000_000_002 },
      { rows: [], last: 1_000_000_002 },
    ]
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(pages.shift())))
    expect(await pull('https://w.dev', 't', fetchFn as unknown as typeof fetch)).toBe(2)
    expect(fs.readFileSync('data/live/raw/2026-10-23.jsonl', 'utf8')).toBe(
      '{"received":"2026-10-23T01:00:00Z","uid":"b","x":2}\n{"received":"2026-10-23T01:00:05Z","uid":"c","x":3}\n')
    expect(JSON.parse(fs.readFileSync('data/live/state.json', 'utf8')).last).toBe(1_000_000_002)
  } finally {
    process.chdir(cwd)
  }
})

describe('the public digest keeps no install number, only a keyed hash of it', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
  it('hashes an install number by its first 12 characters, and leaves a hash as it is', async () => {
    const { installKey } = await import('../../scripts/live/collect')
    const k = installKey(id, 'salt')
    expect(k).toMatch(/^[0-9a-f]{12}$/)
    expect(installKey(id.slice(0, 12), 'salt')).toBe(k)
    expect(installKey(k, 'salt')).toBe(k)
    expect(installKey(id, 'another salt')).not.toBe(k)
  })
  it('in the boards it adds and the days it already had, and refuses to go on without the key', async () => {
    const { installKey, loadDigest, saveDigest, updatedDigest } = await import('../../scripts/live/collect')
    const fs = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const dir = fs.mkdtempSync(`${tmpdir()}/digest-`)
    const cwd = process.cwd()
    const salt = process.env.DIGEST_SALT
    process.chdir(dir)
    try {
      fs.mkdirSync('data/live/digest', { recursive: true })
      fs.writeFileSync('data/live/digest/2026-10-29.json', JSON.stringify({ day: { day: '2026-10-29', boards: 1, corrected: 0, unsure: 0, clients: [''], installs: [id.slice(0, 12)], setups: [] }, games: [] }))
      fs.mkdirSync('data/live/raw', { recursive: true })
      fs.writeFileSync('data/live/raw/2026-10-30.jsonl', JSON.stringify({ received: '2026-10-30T01:00:00Z', ...base({ install: id }) }) + '\n')
      delete process.env.DIGEST_SALT
      expect(() => updatedDigest()).toThrow(/DIGEST_SALT/)
      process.env.DIGEST_SALT = 'salt'
      saveDigest(updatedDigest())
      const files = fs.readdirSync('data/live/digest').map(f => fs.readFileSync(`data/live/digest/${f}`, 'utf8')).join('')
      expect(files).not.toContain(id.slice(0, 8))
      const d = loadDigest()
      expect(d.days.map(x => x.installs)).toEqual([[installKey(id, 'salt')], [installKey(id, 'salt')]])
      expect(d.games[0].install).toBe(installKey(id, 'salt'))
    } finally {
      process.chdir(cwd)
      if (salt === undefined) delete process.env.DIGEST_SALT
      else process.env.DIGEST_SALT = salt
    }
  })
})

it('learns only from what was read for sure: a hand with an unsure card, or an unsure tank, doesn’t count', () => {
  const rows = [
    base({ seq: 0, run: 'a', round: 1, hand: ['Xeno-Hormone', 'Mutagenic Powder', 'Green Bile Solution'], unsure: ['tank0.activity'],
      tanks: [{ archetype: 'pest', rarity: 'magic', activity: 1, quantity: 1 }, { archetype: 'agito', rarity: 'rare', activity: 5, quantity: 24 }, null, null, null, null] }),
    base({ seq: 1, run: 'a', round: 2, hand: ['Xeno-Hormone', 'Purest Holy Water', 'Green Bile Solution'], unsure: ['hand1'] }),
    base({ seq: 0, run: 'b', round: 1, unsure: ['tank1.rarity'],
      tanks: [{ archetype: 'pest', rarity: 'normal', activity: 5, quantity: 24 }, { archetype: 'pest', rarity: 'boss', activity: 5, quantity: 24 }, null, null, null, null] }),
  ]
  const r = computeRates(rows)
  // the unsure Activity doesn't spoil the hand; the hand with an unsure card is left out
  expect(r.potionOffer['Xeno-Hormone'].count).toBe(1)
  expect(r.potionOffer['Xeno-Hormone'].n).toBe(3)
  // starting tanks: both of run a (only its numbers were unsure), run b's first but not its unsure second
  expect(r.spawnRarity.magic.count).toBe(1)
  expect(r.spawnRarity.rare.count).toBe(1)
  expect(r.spawnRarity.normal.count).toBe(1)
  expect(r.spawnRarity.boss.count).toBe(0)
  expect(r.spawnRarity.normal.n).toBe(3)
})

it('a board flagged unreadable teaches nothing', () => {
  const r = computeRates([base({ unreadable: true, hand: ['Xeno-Hormone', 'Mutagenic Powder', 'Green Bile Solution'], tanks: [{ archetype: 'agito', rarity: 'boss', activity: 1, quantity: 1 }, null, null, null, null, null] })])
  expect(r.potionOffer['Xeno-Hormone'].count).toBe(0)
  expect(r.spawnRarity.boss.n).toBe(0)
})
