import { WORLD_HEIGHT, WORLD_WIDTH } from '../config'
import { LOCATIONS, type GameLocation } from './locations'

/** Padding from world edge — leave room so hubs feel spaced out. */
const PAD = 520

/**
 * Absolute world pins.
 * Pinned corners never reshuffle other hubs' coordinates.
 */
const PIN: Record<string, { x: number; y: number }> = {
  'ktv-corner': { x: PAD + 260, y: WORLD_HEIGHT - PAD - 240 },
  'mat-xa-nguoi-mu': { x: WORLD_WIDTH - PAD - 280, y: WORLD_HEIGHT - PAD - 260 },
  'nhau-tc': { x: PAD + 280, y: PAD + 300 },
  'home-tan-binh': { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 },
}

/** Stable geographic bounds from every location (including pinned ones). */
const BOUNDS = (() => {
  const lats = LOCATIONS.map((l) => l.lat)
  const lngs = LOCATIONS.map((l) => l.lng)
  const latMin = Math.min(...lats)
  const latMax = Math.max(...lats)
  const lngMin = Math.min(...lngs)
  const lngMax = Math.max(...lngs)
  return {
    latMax,
    lngMin,
    latRange: Math.max(latMax - latMin, 0.0001),
    lngRange: Math.max(lngMax - lngMin, 0.0001),
  }
})()

/**
 * Project lat/lng into world pixels.
 * North (higher lat) → smaller Y. East (higher lng) → larger X.
 */
export function projectLocation(location: GameLocation): { x: number; y: number } {
  const pinned = PIN[location.id]
  if (pinned) return { ...pinned }

  const { latMax, lngMin, latRange, lngRange } = BOUNDS

  let x = PAD + ((location.lng - lngMin) / lngRange) * (WORLD_WIDTH - PAD * 2)
  let y = PAD + ((latMax - location.lat) / latRange) * (WORLD_HEIGHT - PAD * 2)

  if (location.id === 'che-cau-nguyet') {
    x -= 1480
    y += 820
  } else if (location.id === 'ga-nguyen-con') {
    x += 120
    y -= 1180
  } else if (location.id === 'bun-chi-rau') {
    x += 1520
    y += 900
  }

  return {
    x: Math.round(clamp(x, PAD, WORLD_WIDTH - PAD)),
    y: Math.round(clamp(y, PAD, WORLD_HEIGHT - PAD)),
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

export interface PlacedLocation extends GameLocation {
  x: number
  y: number
}

export type RoadSeg = { x1: number; y1: number; x2: number; y2: number }

function plaza(h: PlacedLocation) {
  return { x: Math.round(h.x), y: Math.round(h.y + 80) }
}

/** Axis-aligned L from A to B (H then V). */
function addLPath(segs: RoadSeg[], junctions: { x: number; y: number }[], ax: number, ay: number, bx: number, by: number) {
  ax = Math.round(ax)
  ay = Math.round(ay)
  bx = Math.round(bx)
  by = Math.round(by)
  if (Math.abs(bx - ax) >= 4) {
    segs.push({ x1: ax, y1: ay, x2: bx, y2: ay })
    junctions.push({ x: bx, y: ay })
  }
  if (Math.abs(by - ay) >= 4) {
    segs.push({ x1: bx, y1: ay, x2: bx, y2: by })
  }
  junctions.push({ x: bx, y: by })
}

/** Merge colinear H/V segments; snap near-parallel lines so roads aren't drawn twice. */
function mergeSegs(segs: RoadSeg[]): RoadSeg[] {
  type H = { y: number; a: number; b: number }
  type V = { x: number; a: number; b: number }
  const hs: H[] = []
  const vs: V[] = []
  const SNAP = 14

  for (const s of segs) {
    if (Math.abs(s.y2 - s.y1) < 1) {
      let y = Math.round(s.y1)
      for (const h of hs) {
        if (Math.abs(h.y - y) <= SNAP) {
          y = h.y
          break
        }
      }
      hs.push({ y, a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2) })
    } else {
      let x = Math.round(s.x1)
      for (const v of vs) {
        if (Math.abs(v.x - x) <= SNAP) {
          x = v.x
          break
        }
      }
      vs.push({ x, a: Math.min(s.y1, s.y2), b: Math.max(s.y1, s.y2) })
    }
  }

  const mergeRuns = <T extends { a: number; b: number }>(items: T[], key: (t: T) => number) => {
    const byKey = new Map<number, T[]>()
    for (const it of items) {
      const k = key(it)
      const list = byKey.get(k) ?? []
      list.push(it)
      byKey.set(k, list)
    }
    const out: T[] = []
    for (const list of byKey.values()) {
      list.sort((p, q) => p.a - q.a)
      let cur = { ...list[0]! }
      for (let i = 1; i < list.length; i++) {
        const n = list[i]!
        if (n.a <= cur.b + 8) cur.b = Math.max(cur.b, n.b)
        else {
          out.push(cur)
          cur = { ...n }
        }
      }
      out.push(cur)
    }
    return out
  }

  const mergedH = mergeRuns(hs, (h) => h.y)
  const mergedV = mergeRuns(vs, (v) => v.x)
  const result: RoadSeg[] = []
  for (const h of mergedH) result.push({ x1: h.a, y1: h.y, x2: h.b, y2: h.y })
  for (const v of mergedV) result.push({ x1: v.x, y1: v.a, x2: v.x, y2: v.b })
  return result
}

/**
 * Roads from 66B to every shop + shops linked to each other.
 * All segments axis-aligned; southern shops share one flush east-west corridor.
 */
export function computeRoadLayout(hubs: PlacedLocation[]) {
  const ROAD = 56
  const home = hubs.find((h) => h.id === 'home-tan-binh') ?? hubs[0]
  if (!home) {
    return {
      ROAD,
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      segs: [] as RoadSeg[],
      junctions: [] as { x: number; y: number }[],
    }
  }

  const { x: hx, y: hy } = plaza(home)
  const segs: RoadSeg[] = []
  const junctions: { x: number; y: number }[] = [{ x: hx, y: hy }]

  const southHubs = hubs.filter((h) => h.id !== home.id && plaza(h).y > hy + 40)
  const otherHubs = hubs.filter((h) => h.id !== home.id && !southHubs.includes(h))

  // One shared south corridor (same Y) so the T-junction is not stepped
  if (southHubs.length > 0) {
    const southY = Math.round(Math.max(...southHubs.map((h) => plaza(h).y)))
    const southXs = southHubs.map((h) => plaza(h).x)
    const minSX = Math.min(...southXs, hx)
    const maxSX = Math.max(...southXs, hx)

    segs.push({ x1: hx, y1: hy, x2: hx, y2: southY })
    segs.push({ x1: minSX, y1: southY, x2: maxSX, y2: southY })
    junctions.push({ x: hx, y: southY })

    for (const hub of southHubs) {
      const p = plaza(hub)
      junctions.push({ x: p.x, y: southY })
      if (Math.abs(p.y - southY) >= 4) {
        segs.push({ x1: p.x, y1: southY, x2: p.x, y2: p.y })
      }
      junctions.push({ x: p.x, y: p.y })
    }
  }

  // Other shops: L from 66B (H along home row, then V)
  for (const hub of otherHubs) {
    const p = plaza(hub)
    addLPath(segs, junctions, hx, hy, p.x, p.y)
  }

  // Link shops to each other: nhậu → chè → gà → bún (west→east-ish chain)
  const chainIds = ['nhau-tc', 'che-cau-nguyet', 'ga-nguyen-con', 'bun-chi-rau'] as const
  const chain = chainIds
    .map((id) => hubs.find((h) => h.id === id))
    .filter((h): h is PlacedLocation => !!h)

  for (let i = 0; i < chain.length - 1; i++) {
    const a = plaza(chain[i]!)
    const b = plaza(chain[i + 1]!)
    addLPath(segs, junctions, a.x, a.y, b.x, b.y)
  }

  // Also connect south corridor shops to nearest food shop if useful — KTV/mát xa already on south road
  // Extra: link bun (east) toward mat-xa if both exist
  const bun = hubs.find((h) => h.id === 'bun-chi-rau')
  const matxa = hubs.find((h) => h.id === 'mat-xa-nguoi-mu')
  if (bun && matxa) {
    const a = plaza(bun)
    const b = plaza(matxa)
    addLPath(segs, junctions, a.x, a.y, b.x, b.y)
  }

  const merged = mergeSegs(segs)
  const xs = [hx, ...hubs.map((h) => plaza(h).x)]
  const ys = [hy, ...hubs.map((h) => plaza(h).y)]

  // Junctions only at unique rounded points
  const uniq = new Map<string, { x: number; y: number }>()
  for (const j of junctions) {
    const x = Math.round(j.x)
    const y = Math.round(j.y)
    uniq.set(`${x},${y}`, { x, y })
  }
  for (const h of hubs) {
    const p = plaza(h)
    uniq.set(`${p.x},${p.y}`, p)
  }

  return {
    ROAD,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    segs: merged,
    junctions: [...uniq.values()],
  }
}

/** True if point sits on the road surface (not the grass verge). */
export function isOnRoad(
  x: number,
  y: number,
  layout: ReturnType<typeof computeRoadLayout>,
  pad = 8,
): boolean {
  const half = layout.ROAD / 2 + pad
  for (const s of layout.segs) {
    if (Math.abs(s.y2 - s.y1) < 1) {
      const lo = Math.min(s.x1, s.x2) - half
      const hi = Math.max(s.x1, s.x2) + half
      if (x >= lo && x <= hi && Math.abs(y - s.y1) <= half) return true
    } else {
      const lo = Math.min(s.y1, s.y2) - half
      const hi = Math.max(s.y1, s.y2) + half
      if (y >= lo && y <= hi && Math.abs(x - s.x1) <= half) return true
    }
  }
  return false
}

export function getPlacedLocations(): PlacedLocation[] {
  return LOCATIONS.map((loc) => {
    const { x, y } = projectLocation(loc)
    return { ...loc, x, y }
  })
}
