import { existsSync, readFileSync } from 'node:fs'
import { decodePng } from '../../scripts/scan/png'
import { scan } from '@/solver/scan/scan'
import raw from '@/solver/scan/data.json'
import { unpack, type PackedScanData } from '@/solver/scan/data'

const data = unpack(raw as unknown as PackedScanData)
import type { Label } from '../../scripts/scan/buildData'

const truth = JSON.parse(readFileSync('scripts/scan/truth.json', 'utf8')) as Record<string, Label>
const local = existsSync('training/003-board.png')

describe.skipIf(!local)('reading the labelled live frames (training/)', () => {
  for (const [file, label] of Object.entries(truth)) {
    if (!label.state) continue
    it(`reads ${file}`, () => {
      const r = scan(decodePng(readFileSync(`training/${file}`)), data)
      expect(r.problems).toEqual([])
      expect(r.state).toEqual(label.state)
      // the cards must be right, not sure: with references from many players' screens (Oct 25) a few of these frames'
      // cards score just under the line, and the Solver reads those by their title instead
      expect(Object.entries(r.fields).filter(([k, f]) => !f.sure && !k.startsWith('hand')).map(([k]) => k)).toEqual([])
    })
  }
})

it('a black frame is not the Surgical Preparation screen', () => {
  const img = { width: 1280, height: 720, data: new Uint8ClampedArray(1280 * 720 * 4).fill(0) }
  const r = scan(img, data)
  expect(r.problems).toEqual([{ kind: 'notFound' }])
})

describe('committed fixtures (masked live frames)', () => {
  const read = (f: string) => scan(decodePng(readFileSync(`tests/fixtures/frames/${f}`)), data)

  it('reads a potion round exactly', () => {
    const r = read('board-012.png')
    expect(r.problems).toEqual([])
    expect(r.state).toEqual(truth['012-board.png'].state)
  })

  it('reads a Surgical Protocol round', () => {
    const r = read('protocol-018.png')
    expect(r.state.phase).toBe('protocol')
    expect(r.state.hand).toEqual(truth['018-board.png'].state!.hand)
    expect(r.state.round).toBe(11)
  })

  it('reads a real 1920x1080 (16:9) screen: tanks, cards, round and refreshes', () => {
    const r = read('board-1080p.png')
    expect(r.problems).toEqual([])
    const want = truth['h1-013-screen.png'].state!
    expect(r.state.tanks).toEqual(want.tanks)
    expect(r.state.hand).toEqual(want.hand)
    expect([r.state.round, r.state.instrumentRefreshes, r.state.phase]).toEqual([1, 2, 'instrument'])
  })

  it('flags a card it cannot recognise', () => {
    const r = read('unknown-card.png')
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'unknownArt', field: 'hand1' })])
    expect(r.fields.hand1.sure).toBe(false)
  })

  it('reads a label over a candle: the flames under it are no digits (66x319 read as 66x319661)', () => {
    const r = read('candle-1901.png')
    expect(r.problems).toEqual([])
    expect(r.state.tanks.map(t => t && [t.activity, t.quantity])).toEqual([[5, 139], [66, 319], [1, 306], [42, 306], [5, 329], [5, 149]])
  })

  it('reads the tanks of a window between the measured shapes: its labels sit lower and further right (2469x1180, 2.09:1)', () => {
    // the game logged interface scale 1.0444 for this window; every icon read as a sure Agito, and half the tanks as empty
    const r = scan(decodePng(readFileSync('tests/fixtures/frames/window-2469.png')), data, {}, { ui: 1.0444 })
    expect(r.state.tanks).toEqual([
      { archetype: 'pest', rarity: 'magic', activity: 98, quantity: 76 },
      { archetype: 'aemberon', rarity: 'normal', activity: 1, quantity: 36 },
      { archetype: 'pest', rarity: 'normal', activity: 1, quantity: 36 },
      { archetype: 'agito', rarity: 'normal', activity: 243, quantity: 88 },
      { archetype: 'pest', rarity: 'magic', activity: 36, quantity: 97 },
      { archetype: 'boneSentry', rarity: 'normal', activity: 1, quantity: 109 },
    ])
    expect(Object.entries(r.fields).filter(([k, f]) => k.startsWith('tank') && !f.sure).map(([k]) => k)).toEqual([])
  })

  it('reads the tanks of a small window: faint 7-pixel digits and dim Pest icons (issue #287, 1306x737)', () => {
    const r = read('small-737.png')
    const pest = { archetype: 'pest', rarity: 'normal', activity: 1, quantity: 36 }
    expect(r.state.tanks).toEqual([pest, pest, pest, pest, null, null])
    expect(Object.entries(r.fields).filter(([k, f]) => k.startsWith('tank') && !f.sure).map(([k]) => k)).toEqual([])
  })

  it('reads touching 7-pixel digits by laying the total\'s factor pairs over them (issue #287, 1360x768)', () => {
    const r = read('small-768.png')
    expect(r.state.tanks.map(t => t && [t.activity, t.quantity])).toEqual([[15, 92], [32, 124], [32, 148], [1, 221], [5, 104], [5, 112]])
  })
})


describe.skipIf(!local)('cards named in the browser', () => {
  it('only help read the hand, never the equipped-instrument icons', async () => {
    const { layout } = await import('@/solver/scan/layout')
    const { artFeature } = await import('@/solver/scan/pixels')
    const img = decodePng(readFileSync('training/012-board.png'))
    // the worst case: a name stored by "What is this?" whose picture happens to match a panel icon exactly
    const named = { 'instrument:Hyperplastic Frontal Lobe': [artFeature(img, layout(img).instrumentIcon[0])] }
    const r = scan(img, data, named)
    expect(r.state.instruments).toEqual(truth['012-board.png'].state!.instruments)
  })
})

describe.skipIf(!local)('the potion-activation animation', () => {
  it('is recognised (one card left on the floor) and not read as a hand', () => {
    for (const f of ['g2-ticks/042-tick.png', 'g3-ticks/015-tick.png', 'g3-ticks/077-tick.png']) {
      const r = scan(decodePng(readFileSync(`training/${f}`)), data)
      expect(r.problems).toEqual([{ kind: 'animating' }])
    }
  })
  it('a normal hand is not mistaken for it', () => {
    const r = scan(decodePng(readFileSync('training/g3-ticks/085-tick.png')), data)
    expect(r.problems.some(p => p.kind === 'animating')).toBe(false)
  })
})

describe.skipIf(!local)('the size of the hand', () => {
  it('is five when cards sit at the far ends of the fan (a Potion Kit)', async () => {
    const { layout } = await import('@/solver/scan/layout')
    const { fanSize } = await import('@/solver/scan/cards')
    for (const f of ['g3-026-board.png', 'g3-ticks/030-tick.png']) {
      const img = decodePng(readFileSync(`training/${f}`))
      expect(fanSize(img, layout(img))).toBe(5)
    }
    for (const f of ['g3-042-board.png', 'g4-053-board.png', 'g3-ticks/088-tick.png']) {
      const img = decodePng(readFileSync(`training/${f}`))
      expect(fanSize(img, layout(img))).toBe(3)
    }
  })
})

describe.skipIf(!local)('a card raised by the mouse', () => {
  it('fits its references about 35 px higher than a resting card does', async () => {
    const { layout } = await import('@/solver/scan/layout')
    const { fitOffset } = await import('@/solver/scan/cards')
    const img = decodePng(readFileSync('training/g2-ticks/059-tick.png'))
    const l = layout(img)
    expect(fitOffset(img, l.cards[2], l.k, 'potion:Xenopurge Powder', data)!.at[1]).toBeLessThanOrEqual(-27)
    expect(fitOffset(img, l.cards[0], l.k, 'potion:Pure Leech Solution', data)!.at[1]).toBe(0)
  })
})

describe.skipIf(!local)('a 1440p frame shrunk to 1080p', () => {
  it('still finds every filled tank', async () => {
    const { resize } = await import('@/solver/scan/pixels')
    for (const f of ['006-board.png', '012-board.png', '016-board.png']) {
      const big = decodePng(readFileSync(`training/${f}`))
      const r = scan(resize(big, Math.round(big.width * 0.75), Math.round(big.height * 0.75)), data)
      expect(r.state.tanks.map(t => !!t)).toEqual(truth[f].state!.tanks.map(t => !!t))
    }
  })
  it('reads the refresh count beside Shelley’s portrait', async () => {
    const { resize } = await import('@/solver/scan/pixels')
    for (const f of ['007-board.png', '008-board.png', 'g3-037-board.png']) {
      const big = decodePng(readFileSync(`training/${f}`))
      const r = scan(resize(big, Math.round(big.width * 0.75), Math.round(big.height * 0.75)), data)
      const want = truth[f].state!
      expect(want.phase === 'potion' ? r.state.potionRefreshes : r.state.instrumentRefreshes).toBe(want.phase === 'potion' ? want.potionRefreshes : want.instrumentRefreshes)
    }
  })
})

describe.skipIf(!existsSync('training/g5-011-board.png'))('a panel icon named in the browser', () => {
  it('is recognised on the next boards', async () => {
    // a reader that has never seen it: not in the built-in data, nor in the icons players taught
    const learnedIcons = (await import('@/solver/scan/learnedIcons.json')).default as Record<string, number[][]>
    vi.resetModules()
    vi.doMock('@/solver/scan/learnedIcons.json', () => ({ default: Object.fromEntries(Object.entries(learnedIcons).filter(([n]) => n !== 'Egg-Burdened Butterfly')) }))
    const { layout } = await import('@/solver/scan/layout')
    const { iconPattern, readInstruments } = await import('@/solver/scan/instruments')
    const learnedFrom = decodePng(readFileSync('training/g5-011-board.png'))
    const learned = { 'icon:Egg-Burdened Butterfly': [iconPattern(learnedFrom, layout(learnedFrom).instrumentIcon[0])] }
    const later = decodePng(readFileSync('training/g5-018-board.png'))
    // as before the built-in data had this icon
    const icons = { ...data.instrumentIcons }
    delete icons['Egg-Burdened Butterfly']
    const without = { ...data, instrumentIcons: icons }
    expect(readInstruments(later, layout(later), without).names).not.toContain('Egg-Burdened Butterfly')
    expect(readInstruments(later, layout(later), without, learned).names).toEqual(['Contracted Claws', 'Egg-Burdened Butterfly'])
    vi.doUnmock('@/solver/scan/learnedIcons.json')
    vi.resetModules()
  })
})

describe.skipIf(!existsSync('training/h2-066-board.png'))('the equipped-instrument panel at 1920x1080', () => {
  const panel = async (f: string) => {
    const { layout } = await import('@/solver/scan/layout')
    const { readInstruments } = await import('@/solver/scan/instruments')
    const img = decodePng(readFileSync(`training/${f}`))
    return readInstruments(img, layout(img), data)
  }
  it('counts only the slots that hold an icon: dark slots are empty', async () => {
    expect((await panel('h2-025-board.png')).names).toEqual(['Aberrant Sprout'])
    expect((await panel('h2-066-board.png')).names).toHaveLength(3)
  })
  it('reads the three picks of a real game in order once their icons are known', async () => {
    expect((await panel('h2-066-board.png')).names).toEqual(['Aberrant Sprout', 'Pig Iron Bone Saw', 'Tanned Leather Restraint'])
  })
})


describe.skipIf(!existsSync('training/h2-066-board.png'))('the permanent item at the start of the panel (a teal ewer, seen on 16:9)', () => {
  it('is skipped, so only the picks count', async () => {
    const { layout } = await import('@/solver/scan/layout')
    const { readInstruments } = await import('@/solver/scan/instruments')
    for (const [f, picks] of [['h2-019-screen.png', 0], ['h2-025-board.png', 1], ['h2-038-board.png', 2], ['h2-066-board.png', 3]] as const) {
      const img = decodePng(readFileSync(`training/${f}`))
      expect(readInstruments(img, layout(img), data).names, f).toHaveLength(picks)
    }
  })
})

it('icons players taught (learnedIcons.json) are read like the built-in ones', async () => {
  const { allIcons } = await import('@/solver/scan/instruments')
  const learned = (await import('@/solver/scan/learnedIcons.json')).default as Record<string, number[][]>
  const icons = allIcons({ instrumentIcons: { Foo: [[1]] } } as never)
  for (const [name, vs] of Object.entries(learned)) for (const v of vs) expect(icons[name]).toContainEqual(v)
  expect(icons.Foo).toEqual([[1]])
})

// issue #12: 2560x1440 with the game's interface at 125% (Windows' display scale or the game's): every panel
// and card larger, the tanks where they were
describe('an interface scaled to 125% (the game\u2019s recommended setting, 1.257x)', () => {
  const r = scan(decodePng(readFileSync('tests/fixtures/frames/ui-125.png')), data)
  it('is found, and the round, the phase and the cards read', () => {
    expect(r.ui).toBe(1.257)
    expect(r.state.round).toBe(5)
    expect(r.fields.round.sure).toBe(true)
    expect(r.state.phase).toBe('potion')
    expect(r.state.hand).toEqual(['Hollow Spinal Solution', 'Mutagenic Powder', 'Eggshell Powder'])
  })
  it('reads the tanks clear of the panels', () => {
    expect(r.state.tanks.slice(1, 3).map(t => t && [t.activity, t.quantity])).toEqual([[66, 166], [82, 186]])
  })
})

// Two players' reports, Oct 23: the slider at its lowest (0.64, 0.957x of the labelled frames), the empty tanks' plates
// lit red by their glass
describe('the interface at its lowest, empty tanks glowing red', () => {
  const img = decodePng(readFileSync('tests/fixtures/frames/ui-lowest.png'))
  it('is found by the header when the game hasn’t said, and the empty tanks are empty, not bosses', () => {
    // as the site reads: the cards' names come afterwards (titles.ts), so the header says which pick it is
    const r = scan(img, data, {}, { pictures: false })
    expect(r.ui).toBe(0.957)
    expect(r.state.phase).toBe('instrument')
    expect(r.fields.phase.sure).toBe(true)
    expect(r.state.tanks.slice(3)).toEqual([null, null, null])
    expect(r.state.tanks.slice(0, 3).map(t => t && [t.activity, t.quantity])).toEqual([[1, 36], [1, 36], [5, 24]])
    expect(r.problems).toEqual([])
  })
  it('is read at the scale the game logged, without trying others', () => {
    const r = scan(img, data, {}, { pictures: false, ui: 0.64 / 0.66887495368719 })
    expect(r.ui).toBeCloseTo(0.957, 3)
    expect(r.fields.phase.sure).toBe(true)
  })
})

// One board on a 3440x1440 screen with the slider at four places (Oct 25): the labels sit lower than on 16:9 and grow
// about their own total's row, so read about 16:9's they came out a few pixels off (cut digits, 1 x 36 as 1 x 46), and
// at the highest the empty tanks' rim lit pink passed for a name
describe('an ultrawide screen at every interface scale', () => {
  for (const [name, page] of [['lowest', 0.64], ['quarter', 0.73211278676987], ['recommended', 0.84067144155502], ['highest', 1]] as const) {
    it(`reads every tank at the ${name} setting (PageScale ${page.toFixed(3)})`, () => {
      const img = decodePng(readFileSync(`tests/fixtures/frames/ultrawide-ui-${name}.png`))
      const r = scan(img, data, {}, { pictures: false, ui: page / 0.66887495368719 })
      expect(r.state.round).toBe(1)
      expect(r.state.phase).toBe('instrument')
      expect(r.state.tanks.map(t => t && [t.activity, t.quantity])).toEqual([[1, 36], [300, 1], [5, 24], null, null, null])
      expect(r.problems).toEqual([])
    })
  }
})

// Two boards played on one screen at five window shapes (Oct 25): narrower than 16:9 the UI fits the width and the
// tanks sit closer together, so 16:10 and 4:3 weren't found at all
describe('every screen shape', () => {
  const round7 = [[81, 165], [560, 234], [266, 36], [325, 195], [385, 1], [146, 36]]
  const round8 = [[161, 165], [700, 234], [286, 36], [536, 195], [405, 1], [166, 36]]
  for (const [name, page, round, tanks] of [['32-9', 0.674, 7, round7], ['21-9', 0.674, 7, round7], ['16-9-window', 0.674, 7, round7], ['16-10', 0.674, 8, round8], ['4-3', 0.6914453268, 8, round8]] as const) {
    it(`reads the board on ${name.replace(/-/, ':')}`, () => {
      const img = decodePng(readFileSync(`tests/fixtures/frames/shape-${name}.png`))
      const r = scan(img, data, {}, { pictures: false, ui: page / 0.66887495368719 })
      expect(r.state.round).toBe(round)
      expect(r.fields.phase.sure).toBe(true)
      expect(r.state.tanks.map(t => t && [t.activity, t.quantity])).toEqual(tanks)
      expect(r.problems).toEqual([])
    })
  }
})
