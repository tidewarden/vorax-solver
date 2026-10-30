// Where each part of the Surgical Preparation screen sits. Measured on 3440x1440 frames (21:9) from a live
// game, in pixels of that frame, and placed on other frames by scaling with the height from the anchor the
// game's UI uses: the left or right edge, or the centre. On a screen narrower than 16:9 the UI fits the width
// instead (a 1680x1050 window: everything at 1680/2560 of its 1440p size, not 1050/1440). The tanks are part of
// the 3D scene, which is framed differently on each screen shape: on 16:9 they sit closer together and higher
// (measured on a live 1920x1080 frame), on 16:10 closer still (a live 1680x1050 window, Oct 25). Between
// measured shapes the tank positions are blended; outside them they stay at the nearest one, which reads 32:9
// (Oct 25) on 21:9's. 4:3 measured on a live 1440x1080 window (Oct 25).
import type { Rect } from '../types'

const REF_H = 1440
/** The width of a 16:9 frame at REF_H: narrower screens scale their UI by width */
const REF_W = 2560

/** Reference rects, x relative to the frame centre unless noted. */
/** The tanks' labels, by screen shape: centres under the six tanks (perspective pushes the right-hand ones
 *  further out), and the rows of the name, the total and Activity x Quantity. */
/** jar: the whole tank, from its cap down past its labels, for pointing at it: each jar's centre from its
 *  label's (the camera looks at the row from a little to the right), its width and its top and bottom. */
interface TankScene { x: number[]; name: [number, number]; total: [number, number]; aq: [number, number]; icon: number; iconSize: number; jar: { dx: number[]; w: number; y: [number, number] } }
const ULTRAWIDE: TankScene = { x: [-858, -421, 16, 454, 913, 1386], name: [556, 577], total: [578, 600], aq: [599, 619], icon: 533, iconSize: 26, jar: { dx: [57, 46, 32, 19, 0, -27], w: 290, y: [62, 630] } }
/** jar measured roughly on these two (it only places the highlight): 16:9's narrowed to the closer tanks */
const SQUARE_4_3: TankScene = { x: [-445, -201, 40, 284, 535, 795], name: [590, 610], total: [611, 631], aq: [633, 653], icon: 575, iconSize: 22, jar: { dx: [24, 18, 6, 5, -2, -16], w: 160, y: [313, 664] } }
const WIDE_16_10: TankScene = { x: [-610, -309, -10, 287, 597, 912], name: [555, 575], total: [576, 596], aq: [598, 618], icon: 540, iconSize: 22, jar: { dx: [30, 23, 7, 6, -3, -20], w: 195, y: [206, 629] } }
const WIDE_16_9: TankScene = { x: [-756, -400, -48, 304, 667, 1037], name: [511, 531], total: [532, 552], aq: [554, 574], icon: 496, iconSize: 22, jar: { dx: [35, 27, 8, 7, -3, -23], w: 230, y: [90, 585] } }
/** Three windows between 16:9 and 21:9 (Oct 20-25, one player): the straight blend put their labels up to 10 too high
 *  and 20-60 too far left, more to the right of the row, so every icon read as Agito. Each measured as the shift at which
 *  the tanks' totals and A x Q read sharpest and multiply, on 19-39 frames per tank: 2469x1180 at interface scale 1.044
 *  (from the log), 2409x1106 at 1.145 and 2522x1081 at 0.957 (from their rounds and headers). jar: the blend's. */
const WINDOW_2_09: TankScene = { x: [-784, -382, 20, 424, 845, 1279], name: [544, 564], total: [565, 586], aq: [587, 607], icon: 525, iconSize: 24, jar: { dx: [46, 37, 20, 13, -1, -25], w: 261, y: [76, 608] } }
const WINDOW_2_18: TankScene = { x: [-805, -389, 25, 443, 879, 1328], name: [548, 569], total: [570, 591], aq: [591, 611], icon: 528, iconSize: 25, jar: { dx: [49, 39, 24, 15, -1, -26], w: 269, y: [72, 614] } }
const WINDOW_2_33: TankScene = { x: [-868, -427, 13, 457, 920, 1397], name: [556, 577], total: [578, 600], aq: [599, 619], icon: 534, iconSize: 26, jar: { dx: [55, 44, 30, 18, 0, -27], w: 285, y: [65, 626] } }
const ASPECT_4_3 = 4 / 3
const ASPECT_16_10 = 1680 / 1050
const ASPECT_16_9 = 16 / 9
const ASPECT_ULTRAWIDE = 3440 / 1440
/** Every measured shape, narrowest first: between two, the tanks' labels are blended; outside them, the nearest is kept */
const SHAPES: [number, TankScene][] = [
  [ASPECT_4_3, SQUARE_4_3], [ASPECT_16_10, WIDE_16_10], [ASPECT_16_9, WIDE_16_9],
  [2469 / 1180, WINDOW_2_09], [2409 / 1106, WINDOW_2_18], [2522 / 1081, WINDOW_2_33], [ASPECT_ULTRAWIDE, ULTRAWIDE],
]
const LABEL_HALF_W = 200

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const mixPair = (a: [number, number], b: [number, number], t: number): [number, number] => [mix(a[0], b[0], t), mix(a[1], b[1], t)]

/** The tanks' labels for a screen of this shape. */
export function tankScene(aspect: number): TankScene {
  // the first measured shape wider than this screen, and the one before it (past the widest, the last two)
  const wider = SHAPES.findIndex(([w]) => aspect < w)
  const j = wider === -1 ? SHAPES.length - 1 : Math.max(1, wider)
  const [[a, lo], [b, hi]] = [SHAPES[j - 1], SHAPES[j]]
  const t = Math.min(1, Math.max(0, (aspect - a) / (b - a)))
  return {
    x: hi.x.map((x, i) => mix(lo.x[i], x, t)),
    name: mixPair(lo.name, hi.name, t),
    total: mixPair(lo.total, hi.total, t),
    aq: mixPair(lo.aq, hi.aq, t),
    icon: mix(lo.icon, hi.icon, t),
    iconSize: mix(lo.iconSize, hi.iconSize, t),
    jar: {
      dx: hi.jar.dx.map((x, i) => mix(lo.jar.dx[i], x, t)),
      w: mix(lo.jar.w, hi.jar.w, t),
      y: mixPair(lo.jar.y, hi.jar.y, t),
    },
  }
}

const CARD_X0 = -90
const CARD_PITCH = 226.5
const CARD_ART = { y: 975, w: 100, h: 120 }
const CARD_FACE = { y: 960, w: 230, h: 340 }
/** The hand is fanned: each card's centre and tilt (radians), measured from the cards' edges. */
const CARD_CY = 1130
const CARD_TILT = [-0.0576, 0, 0.0506]
/** The fan's arc: the side cards sit a little lower and further out than the middle one. */
const CARD_SHIFT = [{ x: 6, y: 6 }, { x: 0, y: 0 }, { x: -6, y: 6 }]
/** A Potion Kit opens to five cards, fanned wider: centres from the frame centre, heights and tilts. */
const HAND5 = { x: [-385, -163, 70, 303, 515], y: [1141, 1121, 1111, 1121, 1141], tilt: [-0.11, -0.06, 0, 0.05, 0.11] }
/** Art and title in a card's own frame, in reference pixels from its centre. */
export const CARD_LOCAL = { art: { x: -50, y: -155, w: 100, h: 120 }, text: { x: -100, y: -45, w: 185, h: 175 } }
const HEADER = { x: -260, y: 908, w: 560, h: 30 }
const REFRESH = { x: 300, y: 1342, w: 160, h: 40 }
/** the whole Refresh button, its dice and its count: for pointing at it */
const REFRESH_BUTTON = { x: 262, y: 1328, w: 162, h: 64 }

/** From the left edge. */
const ROUND = { x: 105, y: 500, w: 100, h: 70 }

/** From the right edge: icon centres, the newest first. Three picks fit, and a fourth slot holds the permanent
 *  item some players have (an ewer) at the oldest end. */
const INSTRUMENT = { right: 162, pitch: 135, y: 66, size: 74 }

export interface CardPos { cx: number; cy: number; angle: number }

/** A card's face around its centre, for showing it in "What is this?". */
export const cardFace = (c: CardPos, k: number): Rect => ({ x: c.cx - (CARD_FACE.w / 2) * k, y: c.cy - (CARD_FACE.h / 2) * k, w: CARD_FACE.w * k, h: CARD_FACE.h * k })

export interface Layout {
  width: number
  height: number
  /** pixels per reference pixel of the interface */
  k: number
  tankCx: number[]
  /** each whole tank, jar and labels (the 3D scene: not scaled with the interface) */
  tank: Rect[]
  icon: Rect[]
  nameBand: Rect[]
  totalBand: Rect[]
  aqBand: Rect[]
  cardArt: Rect[]
  cardFace: Rect[]
  /** each card's centre and tilt, for sampling its art and title straightened */
  cards: CardPos[]
  /** the same for a Potion Kit's five cards */
  hand5: CardPos[]
  header: Rect
  refresh: Rect
  refreshButton: Rect
  round: Rect
  /** rightmost slot first */
  instrumentIcon: Rect[]
}

/** The game's interface scale (its settings' slider; Windows' display scale doesn't change it) enlarges every panel,
 *  card and label from where it's anchored, while the 3D tanks stay put. The scales tried when the game hasn't said
 *  (uiScaleOf in triggers.ts): the slider runs 0.957x-1.495x of the labelled frames, 1.257x recommended (Oct 23). */
export const UI_SCALES = [1, 1.257, 0.957, 1.495, 1.128, 1.376]
export function layout(frame: { width: number; height: number }, ui = 1): Layout {
  const { width, height } = frame
  // s places the 3D scene, k sizes the UI (and places it from its anchors)
  const s = height / REF_H
  const k = Math.min(s, width / REF_W) * ui
  const cx = width / 2
  /** a y from the bottom edge, from the middle, and in a tank's label */
  const bottom = (y: number) => height - (REF_H - y) * k
  const middle = (y: number) => height / 2 + (y - REF_H / 2) * k
  const scene = tankScene(width / height)
  // the tanks' labels grow about their total's row, which sits lower on a wider screen (16:9: 542; 21:9: 589)
  const labelMid = (scene.total[0] + scene.total[1]) / 2
  const label = (y: number) => labelMid * s + (y - labelMid) * k
  // the labels' text grows, but not the space between tanks: a wider band would take in the next label
  const band = (x: number, y: [number, number] | number[]) => ({ x: x - LABEL_HALF_W * s, y: label(y[0]), w: 2 * LABEL_HALF_W * s, h: (y[1] - y[0]) * k })
  const tankCx = scene.x.map(x => cx + x * s)
  const cardCx = [0, 1, 2].map(j => cx + (CARD_X0 + CARD_PITCH * j) * k)
  const instrumentCx = [0, 1, 2, 3].map(j => width - (INSTRUMENT.right + INSTRUMENT.pitch * j) * k)
  return {
    width,
    height,
    k,
    tankCx,
    tank: tankCx.map((x, i) => ({ x: x + (scene.jar.dx[i] - scene.jar.w / 2) * s, y: scene.jar.y[0] * s, w: scene.jar.w * s, h: (scene.jar.y[1] - scene.jar.y[0]) * s })),
    icon: tankCx.map(x => ({ x: x - (scene.iconSize / 2) * k, y: label(scene.icon) - (scene.iconSize / 2) * k, w: scene.iconSize * k, h: scene.iconSize * k })),
    nameBand: tankCx.map(x => band(x, scene.name)),
    totalBand: tankCx.map(x => band(x, scene.total)),
    aqBand: tankCx.map(x => band(x, scene.aq)),
    cardArt: cardCx.map(x => ({ x: x - (CARD_ART.w / 2) * k, y: bottom(CARD_ART.y), w: CARD_ART.w * k, h: CARD_ART.h * k })),
    cardFace: cardCx.map(x => ({ x: x - (CARD_FACE.w / 2) * k, y: bottom(CARD_FACE.y), w: CARD_FACE.w * k, h: CARD_FACE.h * k })),
    cards: cardCx.map((x, j) => ({ cx: x + CARD_SHIFT[j].x * k, cy: bottom(CARD_CY + CARD_SHIFT[j].y), angle: CARD_TILT[j] })),
    hand5: HAND5.x.map((x, j) => ({ cx: cx + x * k, cy: bottom(HAND5.y[j]), angle: HAND5.tilt[j] })),
    header: { x: cx + HEADER.x * k, y: bottom(HEADER.y), w: HEADER.w * k, h: HEADER.h * k },
    refresh: { x: cx + REFRESH.x * k, y: bottom(REFRESH.y), w: REFRESH.w * k, h: REFRESH.h * k },
    refreshButton: { x: cx + REFRESH_BUTTON.x * k, y: bottom(REFRESH_BUTTON.y), w: REFRESH_BUTTON.w * k, h: REFRESH_BUTTON.h * k },
    round: { x: ROUND.x * k, y: middle(ROUND.y), w: ROUND.w * k, h: ROUND.h * k },
    instrumentIcon: instrumentCx.map(x => ({ x: x - (INSTRUMENT.size / 2) * k, y: (INSTRUMENT.y - INSTRUMENT.size / 2) * k, w: INSTRUMENT.size * k, h: INSTRUMENT.size * k })),
  }
}
