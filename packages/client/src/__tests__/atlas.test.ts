import { ATLAS_COLUMNS, ATLAS_ROWS, TEXTURE_TILE_PX } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	fallbackAtlas,
	sliceAtlasToLayers,
	type AtlasPixels,
	type AtlasSource,
} from '../render/atlasTexture'
import { TEXTURE_COUNT, TEXTURE_NAMES, textureLayer } from '../mesher/textures'

const TILE = TEXTURE_TILE_PX
const TILE_BYTES = TILE * TILE * 4

function gcd(a: number, b: number): number {
	return b === 0 ? a : gcd(b, a % b)
}

/**
 * Smallest stride >= 7 that is coprime with `count`, so stepping by it visits
 * every tile exactly once. Hard-coding a stride silently degenerates whenever
 * the texture count gains that factor (119 = 7 * 17 collapsed 7 to 17 tiles).
 */
function coprimeStride(count: number): number {
	for (let stride = 7; stride < count; stride++) {
		if (gcd(stride, count) === 1) return stride
	}
	return 1
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false
	}
	return true
}

/** Copy one atlas tile out of the packed sheet, row by row. */
function tileBytes(pixels: AtlasPixels, tile: number, columns: number): Uint8Array {
	const out = new Uint8Array(TILE_BYTES)
	const column = tile % columns
	const row = Math.floor(tile / columns)
	for (let ty = 0; ty < TILE; ty++) {
		const start = ((row * TILE + ty) * pixels.width + column * TILE) * 4
		out.set(pixels.data.subarray(start, start + TILE * 4), ty * TILE * 4)
	}
	return out
}

function layerBytes(layers: Uint8Array, index: number): Uint8Array {
	return layers.subarray(index * TILE_BYTES, (index + 1) * TILE_BYTES)
}

/** Replace the manifest while keeping the same pixels. */
function withLayerOf(source: AtlasSource, layerOf: Record<string, number>): AtlasSource {
	return {
		pixels: source.pixels,
		manifest: { ...source.manifest, layerOf },
		generated: true,
	}
}

describe('fallback atlas', () => {
	it('is deterministic and matches the atlas contract', () => {
		const first = fallbackAtlas()
		const second = fallbackAtlas()

		expect(first.generated).toBe(false)
		expect(first.manifest.tilePx).toBe(TEXTURE_TILE_PX)
		expect(first.manifest.columns).toBe(ATLAS_COLUMNS)
		expect(first.manifest.rows).toBe(ATLAS_ROWS)
		expect(first.pixels.width).toBe(ATLAS_COLUMNS * TILE)
		expect(first.pixels.height).toBe(ATLAS_ROWS * TILE)
		expect(first.pixels.data.length).toBe(first.pixels.width * first.pixels.height * 4)
		expect(bytesEqual(first.pixels.data, second.pixels.data)).toBe(true)
	})

	it('maps every required texture name, with "missing" on layer 0', () => {
		const { manifest } = fallbackAtlas()
		expect(manifest.layerOf.missing).toBe(0)
		for (const name of TEXTURE_NAMES) {
			expect(typeof manifest.layerOf[name]).toBe('number')
		}
	})
})

describe('atlas slicing', () => {
	it('produces one layer per client texture, deterministically', () => {
		const source = fallbackAtlas()
		const first = sliceAtlasToLayers(source)
		const second = sliceAtlasToLayers(source)

		expect(first.length).toBe(TEXTURE_COUNT * TILE_BYTES)
		expect(bytesEqual(first, second)).toBe(true)
	})

	it('keeps canonical order when the manifest is already canonical', () => {
		const source = fallbackAtlas()
		const layers = sliceAtlasToLayers(source)
		for (let index = 0; index < TEXTURE_COUNT; index++) {
			const tile = source.manifest.layerOf[TEXTURE_NAMES[index]] ?? 0
			expect(
				bytesEqual(
					layerBytes(layers, index),
					tileBytes(source.pixels, tile, source.manifest.columns),
				),
			).toBe(true)
		}
	})

	it('reorders a permuted manifest back into client order', () => {
		// The stride has to be coprime with TEXTURE_COUNT for this to be a
		// bijection on tiles, so derive one instead of assuming a count.
		const source = fallbackAtlas()
		const stride = coprimeStride(TEXTURE_COUNT)
		const permuted: Record<string, number> = {}
		const expectedTile = new Map<number, number>()
		TEXTURE_NAMES.forEach((name, index) => {
			const tile = (index * stride + 3) % TEXTURE_COUNT
			permuted[name] = tile
			expectedTile.set(index, tile)
		})
		const layers = sliceAtlasToLayers(withLayerOf(source, permuted))

		const seen = new Set(expectedTile.values())
		expect(seen.size).toBe(TEXTURE_COUNT)
		for (let index = 0; index < TEXTURE_COUNT; index++) {
			const tile = expectedTile.get(index) ?? -1
			expect(
				bytesEqual(
					layerBytes(layers, index),
					tileBytes(source.pixels, tile, source.manifest.columns),
				),
			).toBe(true)
		}
	})

	it('falls back to the missing tile for unknown names', () => {
		const source = fallbackAtlas()
		const layers = sliceAtlasToLayers(withLayerOf(source, { missing: 5 }))
		const missingTile = tileBytes(source.pixels, 5, source.manifest.columns)
		for (let index = 0; index < TEXTURE_COUNT; index++) {
			expect(bytesEqual(layerBytes(layers, index), missingTile)).toBe(true)
		}
	})
})

describe('texture layer lookup', () => {
	it('resolves known names and degrades to the missing layer', () => {
		expect(textureLayer('missing')).toBe(0)
		expect(textureLayer('stone')).toBe(TEXTURE_NAMES.indexOf('stone'))
		expect(textureLayer('not_a_real_texture')).toBe(0)
	})
})
