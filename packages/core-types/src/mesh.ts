import type { RenderLayer } from './blocks'

/** Mesh/render unit is a 16x16x16 section, not the full 256 high column. */
export const PADDED = 18
export const PADDED_VOLUME = PADDED * PADDED * PADDED

/** Padded neighbourhood index used by mesher inputs. */
export function paddedIndex(x: number, y: number, z: number): number {
	return x + 1 + PADDED * (z + 1 + PADDED * (y + 1))
}

export function sectionKey(cx: number, cz: number, sy: number): string {
	return `${cx}:${cz}:${sy}`
}

/**
 * Vertex layout: one interleaved Uint16 buffer, stride 8 lanes (16 bytes).
 * Chosen over Uint32 bit packing because non-normalized integer attributes are
 * converted to float32 by three.js and lose bits above 2^24.
 *   lane 0..2 : position x, y, z in 1/16 block fixed point (0..256), section local
 *   lane 3    : reserved (0)
 *   lane 4    : texture layer index into the DataArrayTexture
 *   lane 5    : (normalId << 4) | (uvCorner << 2) | ao      normalId 0..5, uvCorner 0..3, ao 0..3
 *   lane 6    : (skyLight << 4) | blockLight
 *   lane 7    : biome tint index (0 = none)
 */
export const VERTEX_STRIDE_U16 = 8
export const VERTEX_LANE = {
	PosX: 0,
	PosY: 1,
	PosZ: 2,
	Reserved: 3,
	TexLayer: 4,
	NormalAo: 5,
	Light: 6,
	Tint: 7,
} as const

export interface MeshFlags {
	ao: boolean
	smoothLight: boolean
}

export interface MeshRequest {
	key: string
	cx: number
	cz: number
	sy: number
	revision: number
	/** Padded 18^3 block ids. */
	blocks: Uint16Array
	/** Padded 18^3 packed light bytes. */
	light: Uint8Array
	/** Padded 18^3 packed fluid bytes. */
	fluids: Uint8Array
	flags: MeshFlags
}

export interface MeshBuffer {
	layer: RenderLayer
	/** Uint16Array view, VERTEX_STRIDE_U16 lanes per vertex. */
	interleaved: ArrayBuffer
	/** Uint16Array view. vertexCount <= 65535 is guaranteed for a 16^3 section. */
	index: ArrayBuffer
	vertexCount: number
	indexCount: number
}

export interface MeshResult {
	key: string
	cx: number
	cz: number
	sy: number
	revision: number
	/** Empty layers are omitted. */
	buffers: readonly MeshBuffer[]
	stats: { quads: number; meshMs: number }
}

export type MesherMessage =
	| { type: 'mesh'; request: MeshRequest }
	| { type: 'cancel'; key: string }

export type MesherResponse =
	| { type: 'mesh'; result: MeshResult }
	| { type: 'skipped'; key: string; reason: 'cancelled' | 'empty' }
	| { type: 'error'; key: string; message: string }

/** Procedural texture atlas produced by assets-gen and sliced into array layers. */
export const TEXTURE_TILE_PX = 16
export const ATLAS_COLUMNS = 16
export const ATLAS_ROWS = 16

export interface AtlasManifest {
	tilePx: number
	columns: number
	rows: number
	/** Texture name per layer index. */
	layers: readonly string[]
	/** Reverse lookup: texture name to layer index. */
	layerOf: Readonly<Record<string, number>>
}

export interface SoundManifest {
	sampleRate: number
	/** Sound name to generated file name. */
	files: Readonly<Record<string, string>>
}
