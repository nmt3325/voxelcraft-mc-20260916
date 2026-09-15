/** Builds the single 256x256 texture atlas and the manifest that indexes it. */
import { ATLAS_COLUMNS, ATLAS_ROWS, type AtlasManifest } from '@voxelcraft/core-types'
import { encodePng } from './png'
import { assetSeed } from './seed'
import { CUTOUT_TEXTURES, REQUIRED_TEXTURES, TRANSLUCENT_TEXTURES } from './texture-list'
import { GENERATORS } from './texture-registry'
import { ATLAS_HEIGHT, ATLAS_SLOTS, ATLAS_WIDTH, TILE_PX, TileCanvas } from './tile'

const CUTOUT = new Set(CUTOUT_TEXTURES)
const TRANSLUCENT = new Set(TRANSLUCENT_TEXTURES)

export type BuiltAtlas = {
  readonly manifest: AtlasManifest
  readonly png: Uint8Array
  readonly rgba: Uint8Array
  readonly width: number
  readonly height: number
  readonly tileCount: number
}

/**
 * Cutout tiles are snapped to alpha 0 or 255, ordinary tiles are forced opaque,
 * and translucent tiles keep the alpha ramp their generator produced.
 */
export function enforceAlphaPolicy(canvas: TileCanvas, name: string): void {
  if (TRANSLUCENT.has(name)) return
  const cutout = CUTOUT.has(name)
  const data = canvas.data
  for (let i = 0; i < data.length; i += 4) {
    if (!cutout) {
      data[i + 3] = 255
      continue
    }
    if ((data[i + 3] ?? 0) >= 128) {
      data[i + 3] = 255
    } else {
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = 0
    }
  }
}

/** Copy a tile into its row-major slot: col = index % columns, row = floor(index / columns). */
export function blitTile(atlas: Uint8Array, canvas: TileCanvas, index: number): void {
  const col = index % ATLAS_COLUMNS
  const row = Math.floor(index / ATLAS_COLUMNS)
  for (let y = 0; y < TILE_PX; y++) {
    const src = y * TILE_PX * 4
    const dst = ((row * TILE_PX + y) * ATLAS_WIDTH + col * TILE_PX) * 4
    atlas.set(canvas.data.subarray(src, src + TILE_PX * 4), dst)
  }
}

export function buildAtlas(): BuiltAtlas {
  const layers = [...REQUIRED_TEXTURES]
  if (layers.length > ATLAS_SLOTS) {
    throw new Error(`atlas overflow: ${layers.length} textures for ${ATLAS_SLOTS} slots`)
  }
  const rgba = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4)
  const layerOf: Record<string, number> = {}
  layers.forEach((name, index) => {
    const paint = GENERATORS[name]
    if (!paint) throw new Error(`no generator registered for texture "${name}"`)
    const canvas = new TileCanvas(assetSeed(name))
    paint(canvas)
    enforceAlphaPolicy(canvas, name)
    blitTile(rgba, canvas, index)
    layerOf[name] = index
  })
  const manifest: AtlasManifest = {
    tilePx: TILE_PX,
    columns: ATLAS_COLUMNS,
    rows: ATLAS_ROWS,
    layers,
    layerOf,
  }
  const png = encodePng({ width: ATLAS_WIDTH, height: ATLAS_HEIGHT, data: rgba })
  return {
    manifest,
    png,
    rgba,
    width: ATLAS_WIDTH,
    height: ATLAS_HEIGHT,
    tileCount: layers.length,
  }
}
