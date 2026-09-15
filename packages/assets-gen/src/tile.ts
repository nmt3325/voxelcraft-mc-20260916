/** 16x16 RGBA tile canvas plus colour helpers. Every value is hash driven. */
import { ATLAS_COLUMNS, ATLAS_ROWS, TEXTURE_TILE_PX, hash01 } from '@voxelcraft/core-types'

export const TILE_PX = TEXTURE_TILE_PX
export const ATLAS_WIDTH = TEXTURE_TILE_PX * ATLAS_COLUMNS
export const ATLAS_HEIGHT = TEXTURE_TILE_PX * ATLAS_ROWS
export const ATLAS_SLOTS = ATLAS_COLUMNS * ATLAS_ROWS

export type Rgba = readonly [number, number, number, number]

export const TRANSPARENT: Rgba = [0, 0, 0, 0]

export function rgb(r: number, g: number, b: number, a = 255): Rgba {
  return [r, g, b, a]
}

export function clampByte(value: number): number {
  const v = Math.round(value)
  return v < 0 ? 0 : v > 255 ? 255 : v
}

export function shade(color: Rgba, factor: number): Rgba {
  return [color[0] * factor, color[1] * factor, color[2] * factor, color[3]]
}

export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
    a[3] + (b[3] - a[3]) * k,
  ]
}

export function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], alpha]
}

/** Pull a colour towards its luminance so the biome tint (vertex lane 7) can drive the hue. */
export function desaturate(color: Rgba, amount: number): Rgba {
  const lum = color[0] * 0.299 + color[1] * 0.587 + color[2] * 0.114
  return mix(color, [lum, lum, lum, color[3]], amount)
}

export class TileCanvas {
  readonly seed: number
  readonly data: Uint8Array

  constructor(seed: number) {
    this.seed = seed >>> 0
    this.data = new Uint8Array(TILE_PX * TILE_PX * 4)
  }

  noise(salt: number, x: number, y: number): number {
    return hash01(this.seed, salt, x, y)
  }

  /** Quantised noise: fewer levels keeps the 16x16 pixel-art look crisp. */
  steps(salt: number, x: number, y: number, levels: number): number {
    if (levels <= 1) return 0
    const q = Math.floor(this.noise(salt, x, y) * levels)
    return (q >= levels ? levels - 1 : q) / (levels - 1)
  }

  set(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= TILE_PX || y >= TILE_PX) return
    const o = (y * TILE_PX + x) * 4
    this.data[o] = clampByte(color[0])
    this.data[o + 1] = clampByte(color[1])
    this.data[o + 2] = clampByte(color[2])
    this.data[o + 3] = clampByte(color[3])
  }

  get(x: number, y: number): Rgba {
    const o = (y * TILE_PX + x) * 4
    return [this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3]]
  }

  fill(color: Rgba): void {
    for (let y = 0; y < TILE_PX; y++) for (let x = 0; x < TILE_PX; x++) this.set(x, y, color)
  }
}
