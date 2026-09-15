/** Logs, planks and other wooden surfaces. */
import { colShade, edgeShade, noiseFill, ringRect, speckles } from './draw'
import { CACTUS, CACTUS_TOP, PLANKS, PLANKS_DARK } from './palette'
import { planksPattern } from './pattern'
import { TILE_PX, TileCanvas, shade, type Rgba } from './tile'

/** Bark: vertical grain streaks with darker channels. */
export function logSideTile(bark: Rgba, salt: number): (t: TileCanvas) => void {
  return (t) => {
    for (let x = 0; x < TILE_PX; x++) {
      const streak = t.steps(salt, x, 0, 4)
      for (let y = 0; y < TILE_PX; y++) {
        t.set(x, y, shade(bark, 0.84 + streak * 0.28 + t.steps(salt + 1, x, y, 3) * 0.1))
      }
    }
    speckles(t, shade(bark, 0.7), salt + 2, 0.1, 0.5)
    edgeShade(t, 1.05, 0.9)
  }
}

/** Log end: concentric growth rings inside a bark frame. */
export function logTopTile(bark: Rgba, ring: Rgba, salt: number): (t: TileCanvas) => void {
  return (t) => {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const dx = x - 7.5
        const dy = y - 7.5
        const r = Math.sqrt(dx * dx + dy * dy)
        const band = Math.floor(r * 1.15) % 2 === 0 ? 1.06 : 0.9
        const base = r > 7 ? bark : ring
        t.set(x, y, shade(base, band + (t.noise(salt, x, y) - 0.5) * 0.1))
      }
    }
    ringRect(t, 0, 0, TILE_PX, TILE_PX, shade(bark, 0.86))
  }
}

export function planksTile(t: TileCanvas): void {
  planksPattern(t, PLANKS, 4, false, 211)
  speckles(t, PLANKS_DARK, 212, 0.1, 0.4)
  edgeShade(t, 1.04, 0.92)
}

/** Crafting table top: planks with the crafting grid drawn on it. */
export function craftingTableTopTile(t: TileCanvas): void {
  planksPattern(t, PLANKS, 8, true, 221)
  const dark = shade(PLANKS_DARK, 0.78)
  ringRect(t, 1, 1, 14, 14, dark)
  for (let i = 0; i < TILE_PX; i++) {
    t.set(i, 5, dark)
    t.set(i, 10, dark)
    t.set(5, i, dark)
    t.set(10, i, dark)
  }
}

/** Crafting table side: planks with a recessed tool panel. */
export function craftingTableSideTile(t: TileCanvas): void {
  planksPattern(t, PLANKS, 4, false, 231)
  for (let y = 2; y < 8; y++) {
    for (let x = 3; x < 13; x++) t.set(x, y, shade(PLANKS_DARK, y < 4 ? 1.08 : 0.86))
  }
  ringRect(t, 3, 2, 10, 6, shade(PLANKS_DARK, 0.7))
  edgeShade(t, 1.04, 0.9)
}

export function cactusSideTile(t: TileCanvas): void {
  noiseFill(t, CACTUS, 0.14, 3, 241)
  colShade(t, 0, 0.82)
  colShade(t, TILE_PX - 1, 0.82)
  colShade(t, 1, 1.08)
  for (let y = 1; y < TILE_PX; y += 4) {
    for (let x = 3; x < 14; x += 5) t.set(x, y, shade(CACTUS_TOP, 1.3))
  }
}

export function cactusTopTile(t: TileCanvas): void {
  noiseFill(t, CACTUS_TOP, 0.12, 3, 251)
  ringRect(t, 0, 0, TILE_PX, TILE_PX, shade(CACTUS, 0.8))
  for (let i = 0; i < 6; i++) {
    const cx = 4 + Math.floor(t.noise(252, i, 0) * 8)
    const cy = 4 + Math.floor(t.noise(252, i, 1) * 8)
    t.set(cx, cy, shade(CACTUS_TOP, 1.35))
  }
}
