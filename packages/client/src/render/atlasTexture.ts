import { ATLAS_COLUMNS, ATLAS_ROWS, TEXTURE_TILE_PX, type AtlasManifest } from '@voxelcraft/core-types'
import * as THREE from 'three'
import { TEXTURE_COUNT, TEXTURE_NAMES } from '../mesher/textures'

/**
 * Texture atlas plumbing.
 *
 * `packages/assets-gen` procedurally generates `atlas.png` (16 px tiles in a
 * 16x16 grid) plus an `atlas.json` manifest. The mesher stores the *canonical*
 * texture index from `TEXTURE_NAMES` in the vertex stream, so the atlas tiles
 * are re-ordered into canonical order here and uploaded as a
 * `DataArrayTexture`. That keeps the vertex format independent from the tile
 * layout the generator happens to pick.
 *
 * A deterministic procedural fallback is used when the generated assets are not
 * available yet (assets-gen runs in parallel), so the renderer never blocks and
 * never logs a console error.
 */

export interface AtlasPixels {
	readonly width: number
	readonly height: number
	/** RGBA8, row major, top-left origin. */
	readonly data: Uint8Array
}

export interface AtlasSource {
	readonly pixels: AtlasPixels
	readonly manifest: AtlasManifest
	readonly generated: boolean
}

const TILE = TEXTURE_TILE_PX
const BYTES_PER_PIXEL = 4

function hash32(value: number): number {
	let x = (value + 0x9e3779b9) | 0
	x = (x ^ (x >>> 16)) * 0x21f0aaad
	x = (x ^ (x >>> 15)) * 0x735a2d97
	return (x ^ (x >>> 15)) >>> 0
}

/** Deterministic placeholder atlas: distinct flat colour plus a 2x2 checker. */
export function fallbackAtlas(): AtlasSource {
	const width = ATLAS_COLUMNS * TILE
	const height = ATLAS_ROWS * TILE
	const data = new Uint8Array(width * height * BYTES_PER_PIXEL)
	const layers: string[] = []
	const layerOf: Record<string, number> = {}

	for (let index = 0; index < TEXTURE_COUNT; index++) {
		const name = TEXTURE_NAMES[index]
		layers.push(name)
		layerOf[name] = index
		const column = index % ATLAS_COLUMNS
		const row = Math.floor(index / ATLAS_COLUMNS)
		const noise = hash32(index + 1)
		const baseR = 60 + (noise & 0x7f)
		const baseG = 60 + ((noise >>> 8) & 0x7f)
		const baseB = 60 + ((noise >>> 16) & 0x7f)
		for (let ty = 0; ty < TILE; ty++) {
			for (let tx = 0; tx < TILE; tx++) {
				const checker = ((tx >> 2) + (ty >> 2)) % 2 === 0 ? 0 : 24
				const offset =
					((row * TILE + ty) * width + column * TILE + tx) * BYTES_PER_PIXEL
				data[offset] = Math.min(255, baseR + checker)
				data[offset + 1] = Math.min(255, baseG + checker)
				data[offset + 2] = Math.min(255, baseB + checker)
				data[offset + 3] = 255
			}
		}
	}

	return {
		pixels: { width, height, data },
		manifest: { tilePx: TILE, columns: ATLAS_COLUMNS, rows: ATLAS_ROWS, layers, layerOf },
		generated: false,
	}
}

/**
 * Re-pack atlas tiles into canonical `TEXTURE_NAMES` order.
 * Unknown names fall back to canonical layer 0 (`missing`).
 */
export function sliceAtlasToLayers(source: AtlasSource): Uint8Array {
	const { pixels, manifest } = source
	const columns = manifest.columns
	const out = new Uint8Array(TEXTURE_COUNT * TILE * TILE * BYTES_PER_PIXEL)
	const rowBytes = TILE * BYTES_PER_PIXEL

	for (let index = 0; index < TEXTURE_COUNT; index++) {
		const name = TEXTURE_NAMES[index]
		const tile = manifest.layerOf[name] ?? manifest.layerOf.missing ?? 0
		const column = tile % columns
		const row = Math.floor(tile / columns)
		for (let ty = 0; ty < TILE; ty++) {
			const sourceStart =
				((row * TILE + ty) * pixels.width + column * TILE) * BYTES_PER_PIXEL
			const targetStart = (index * TILE + ty) * rowBytes
			if (sourceStart + rowBytes > pixels.data.length) continue
			out.set(pixels.data.subarray(sourceStart, sourceStart + rowBytes), targetStart)
		}
	}
	return out
}

export function createAtlasTexture(source: AtlasSource): THREE.DataArrayTexture {
	const texture = new THREE.DataArrayTexture(sliceAtlasToLayers(source), TILE, TILE, TEXTURE_COUNT)
	texture.format = THREE.RGBAFormat
	texture.type = THREE.UnsignedByteType
	texture.magFilter = THREE.NearestFilter
	texture.minFilter = THREE.NearestFilter
	texture.wrapS = THREE.RepeatWrapping
	texture.wrapT = THREE.RepeatWrapping
	texture.generateMipmaps = false
	texture.colorSpace = THREE.SRGBColorSpace
	texture.needsUpdate = true
	return texture
}

function isAtlasManifest(value: unknown): value is AtlasManifest {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Partial<AtlasManifest>
	return (
		typeof candidate.tilePx === 'number' &&
		typeof candidate.columns === 'number' &&
		typeof candidate.rows === 'number' &&
		Array.isArray(candidate.layers) &&
		typeof candidate.layerOf === 'object' &&
		candidate.layerOf !== null
	)
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	return canvas
}

async function decodePng(bytes: ArrayBuffer): Promise<AtlasPixels> {
	const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
	const { width, height } = bitmap
	const canvas = createCanvas(width, height) as HTMLCanvasElement
	const context = canvas.getContext('2d')
	if (context === null) throw new Error('2d canvas context unavailable')
	context.drawImage(bitmap, 0, 0)
	const imageData = context.getImageData(0, 0, width, height)
	bitmap.close()
	return { width, height, data: new Uint8Array(imageData.data) }
}

/**
 * Load the generated atlas from `baseUrl`, falling back to the procedural atlas.
 * Only warnings are logged: the E2E suite asserts zero console errors.
 */
export async function loadAtlas(baseUrl = './'): Promise<AtlasSource> {
	try {
		const [manifestResponse, imageResponse] = await Promise.all([
			fetch(`${baseUrl}atlas.json`),
			fetch(`${baseUrl}atlas.png`),
		])
		if (!manifestResponse.ok || !imageResponse.ok) {
			throw new Error(`atlas http ${manifestResponse.status}/${imageResponse.status}`)
		}
		const manifest: unknown = await manifestResponse.json()
		if (!isAtlasManifest(manifest)) throw new Error('atlas manifest shape mismatch')
		const pixels = await decodePng(await imageResponse.arrayBuffer())
		return { pixels, manifest, generated: true }
	} catch (error) {
		console.warn('[voxelcraft] using the procedural fallback atlas:', error)
		return fallbackAtlas()
	}
}
