/** Translucent surfaces: glass, ice, water and lava all keep 0 < alpha < 255 pixels. */
import { TWO_PI, sinApprox } from './dsp'
import { GLASS_PANE, ICE, LAVA, LAVA_CRUST, WATER } from './palette'
import { crackLines } from './tex-mineral'
import { TILE_PX, TileCanvas, shade, withAlpha } from './tile'

/** Nearly clear pane inside a solid frame, plus a diagonal highlight. */
export function glassTile(t: TileCanvas): void {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const alpha = 46 + Math.floor(t.steps(501, x, y, 3) * 22)
      t.set(x, y, withAlpha(shade(GLASS_PANE, 0.96 + t.noise(502, x, y) * 0.1), alpha))
    }
  }
  for (let i = 0; i < TILE_PX; i++) {
    t.set(i, 0, withAlpha(GLASS_PANE, 236))
    t.set(i, TILE_PX - 1, withAlpha(shade(GLASS_PANE, 0.86), 236))
    t.set(0, i, withAlpha(GLASS_PANE, 236))
    t.set(TILE_PX - 1, i, withAlpha(shade(GLASS_PANE, 0.86), 236))
  }
  for (let i = 0; i < 5; i++) t.set(3 + i, 10 - i, withAlpha(shade(GLASS_PANE, 1.08), 140))
}

export function iceTile(t: TileCanvas): void {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const tone = 0.9 + t.steps(511, x, y, 4) * 0.22
      t.set(x, y, withAlpha(shade(ICE, tone), 186 + Math.floor(t.steps(512, x, y, 3) * 18)))
    }
  }
  crackLines(t, shade(ICE, 1.2), 210, 3, 513)
}

/** Water: banded wave offsets so the surface reads as ripples. */
export function waterTile(t: TileCanvas): void {
  for (let y = 0; y < TILE_PX; y++) {
    const wave = Math.floor(sinApprox((y / TILE_PX) * TWO_PI * 2) * 2)
    for (let x = 0; x < TILE_PX; x++) {
      const sx = (x + wave + TILE_PX) % TILE_PX
      const tone = 0.88 + t.steps(521, sx, y, 4) * 0.24
      t.set(x, y, withAlpha(shade(WATER, tone), 178 + Math.floor(t.steps(522, x, y, 3) * 16)))
    }
  }
}

/** Lava: dark crust patches floating on a hot body. */
export function lavaTile(t: TileCanvas): void {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const n = t.steps(531, x, y, 5)
      const crust = n < 0.34
      const color = crust ? shade(LAVA_CRUST, 0.9 + n) : shade(LAVA, 0.9 + n * 0.3)
      t.set(x, y, withAlpha(color, crust ? 250 : 255))
    }
  }
  for (let i = 0; i < 6; i++) {
    const cx = 2 + Math.floor(t.noise(532, i, 0) * 12)
    const cy = 2 + Math.floor(t.noise(532, i, 1) * 12)
    t.set(cx, cy, withAlpha(shade(LAVA, 1.25), 255))
  }
}
