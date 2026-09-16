import { ATLAS_COLUMNS, ATLAS_ROWS, TEXTURE_TILE_PX } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { buildAtlas } from '../atlas'
import { CUTOUT_TEXTURES, REQUIRED_TEXTURES, TRANSLUCENT_TEXTURES } from '../texture-list'
import { decodePng, tilePixels } from './png-decode'

const built = buildAtlas()
const decoded = decodePng(built.png)
const SLOTS = ATLAS_COLUMNS * ATLAS_ROWS

function alphasOf(name: string): number[] {
  const index = built.manifest.layerOf[name] ?? -1
  return tilePixels(decoded, index, TEXTURE_TILE_PX, ATLAS_COLUMNS).map((pixel) => pixel[3])
}

describe('atlas manifest', () => {
  it('describes the contract geometry', () => {
    expect(built.manifest.tilePx).toBe(TEXTURE_TILE_PX)
    expect(built.manifest.columns).toBe(ATLAS_COLUMNS)
    expect(built.manifest.rows).toBe(ATLAS_ROWS)
    expect(built.manifest.layers.length).toBeLessThanOrEqual(SLOTS)
  })

  it('covers every required texture with a unique index', () => {
    const { layers, layerOf } = built.manifest
    expect(layers).toEqual([...REQUIRED_TEXTURES])
    const seen = new Set<number>()
    for (const name of REQUIRED_TEXTURES) {
      const index = layerOf[name] ?? -1
      expect(index, name).toBeGreaterThanOrEqual(0)
      expect(index, name).toBeLessThan(SLOTS)
      expect(layers[index]).toBe(name)
      expect(seen.has(index), name).toBe(false)
      seen.add(index)
    }
    expect(seen.size).toBe(REQUIRED_TEXTURES.length)
    expect(layerOf.missing).toBe(0)
  })
})

describe('atlas png', () => {
  it('is a 256x256 RGBA8 image with intact CRCs', () => {
    expect([decoded.width, decoded.height]).toEqual([
      TEXTURE_TILE_PX * ATLAS_COLUMNS,
      TEXTURE_TILE_PX * ATLAS_ROWS,
    ])
    expect(decoded.bitDepth).toBe(8)
    expect(decoded.colorType).toBe(6)
    expect(decoded.chunks.every((chunk) => chunk.crcOk)).toBe(true)
  })

  it('paints something into every declared slot', () => {
    for (const name of REQUIRED_TEXTURES) {
      const alphas = alphasOf(name)
      expect(alphas.length).toBe(TEXTURE_TILE_PX * TEXTURE_TILE_PX)
      expect(
        alphas.some((alpha) => alpha > 0),
        name,
      ).toBe(true)
    }
  })

  it('applies the alpha policy of each render layer', () => {
    for (const name of REQUIRED_TEXTURES) {
      const alphas = alphasOf(name)
      if (TRANSLUCENT_TEXTURES.includes(name)) {
        expect(
          alphas.some((alpha) => alpha > 0 && alpha < 255),
          name,
        ).toBe(true)
      } else {
        expect(
          alphas.every((alpha) => alpha === 0 || alpha === 255),
          name,
        ).toBe(true)
        if (!CUTOUT_TEXTURES.includes(name)) {
          expect(
            alphas.every((alpha) => alpha === 255),
            name,
          ).toBe(true)
        }
      }
    }
  })

  it('cuts holes into the plant tiles', () => {
    for (const name of ['tall_grass', 'dead_bush', 'oak_sapling', 'flower_red', 'torch']) {
      const alphas = alphasOf(name)
      expect(alphas.includes(0), name).toBe(true)
      expect(alphas.includes(255), name).toBe(true)
    }
  })
})
