import type { BlockId } from './ids'
import type { SerializedBlockEntity, BlockEntityData } from './blockEntity'

export const CHUNK_X = 16
export const CHUNK_Z = 16
export const CHUNK_Y = 256
export const CHUNK_AREA = CHUNK_X * CHUNK_Z
export const CHUNK_VOLUME = CHUNK_X * CHUNK_Z * CHUNK_Y
export const SECTION_Y = 16
export const SECTIONS_PER_CHUNK = CHUNK_Y / SECTION_Y

/**
 * Canonical voxel index inside a chunk: (y << 8) | (z << 4) | x.
 * x is the fastest axis. Range 0..65535, i.e. it fits a Uint16.
 */
export function blockIndex(x: number, y: number, z: number): number {
	return (y << 8) | (z << 4) | x
}
export function indexX(i: number): number {
	return i & 15
}
export function indexZ(i: number): number {
	return (i >> 4) & 15
}
export function indexY(i: number): number {
	return (i >> 8) & 255
}
/** Section (16 high slice) that contains this index: 0..15. */
export function sectionOfIndex(i: number): number {
	return (i >> 12) & 15
}
export function worldToChunk(w: number): number {
	return w >> 4
}
export function worldToLocal(w: number): number {
	return w & 15
}
export function chunkKey(cx: number, cz: number): string {
	return `${cx},${cz}`
}

/** In-memory chunk. Light is derived state and is never serialized. */
export interface ChunkData {
	readonly cx: number
	readonly cz: number
	/** BlockId per voxel, length CHUNK_VOLUME. */
	readonly blocks: Uint16Array
	/** Packed fluid byte per voxel (see fluid.ts), length CHUNK_VOLUME. */
	readonly fluids: Uint8Array
	/** (sky << 4) | block per voxel, length CHUNK_VOLUME. */
	readonly light: Uint8Array
	/** First y above the highest sky-blocking block, length CHUNK_AREA. */
	readonly heightmap: Uint16Array
	/** Block entities keyed by voxel index. */
	readonly blockEntities: Map<number, BlockEntityData>
	/** Bumped on every mutation. Stale mesher results must be dropped. */
	revision: number
	/** Bitmask over the 16 sections that need a re-mesh. */
	dirtySections: number
	generated: boolean
	lit: boolean
	dirtyForSave: boolean
}

export function createChunkData(cx: number, cz: number): ChunkData {
	return {
		cx,
		cz,
		blocks: new Uint16Array(CHUNK_VOLUME),
		fluids: new Uint8Array(CHUNK_VOLUME),
		light: new Uint8Array(CHUNK_VOLUME),
		heightmap: new Uint16Array(CHUNK_AREA),
		blockEntities: new Map<number, BlockEntityData>(),
		revision: 0,
		dirtySections: 0,
		generated: false,
		lit: false,
		dirtyForSave: false,
	}
}

/** Bytes 0..3 of every serialized chunk: 'V' 'X' 'C' 0x01. */
export const CHUNK_MAGIC: readonly number[] = [0x56, 0x58, 0x43, 0x01]
export const CHUNK_CODEC_VERSION = 1

/**
 * Serialized chunk payload.
 * Layout (little endian), decided in Phase 2 and frozen for v1:
 *   magic[4] | version u16 | flags u16 | sectionMask u16 | reserved u16
 *   per section in ascending sy where the mask bit is set:
 *     paletteLen u16 | palette[BlockId u16 x paletteLen] | bits u8 | pad u8 | data[u32 x n]
 *     bits is 0 (paletteLen === 1, data omitted) or one of 1,2,4,8,16.
 *     entriesPerWord = 32 / bits, entries never straddle a word.
 *   fluid layer: same section mask, RLE pairs (value u8, runLength u16)
 *   blockEntities: count u16 | (index u16 | jsonLen u16 | utf8 json) x count
 */
export interface ChunkSnapshot {
	cx: number
	cz: number
	blocks: Uint16Array
	fluids: Uint8Array
	blockEntities: readonly SerializedBlockEntity[]
}

export interface ChunkCodec {
	readonly version: number
	encode(snapshot: ChunkSnapshot): Uint8Array
	decode(bytes: Uint8Array): ChunkSnapshot
	canDecode(bytes: Uint8Array): boolean
}

export function blockAt(chunk: ChunkData, x: number, y: number, z: number): BlockId {
	return chunk.blocks[blockIndex(x, y, z)]
}
