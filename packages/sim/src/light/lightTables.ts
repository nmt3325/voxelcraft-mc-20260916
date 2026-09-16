/**
 * Precomputed optics tables and a numerically keyed chunk cache.
 *
 * Two allocation sources dominated the H-05 profile:
 *
 *  1. `lightPropsOf` builds a fresh `LightProps` object on every call, and the
 *     engine called it once per voxel of the column top scan (~49k per chunk),
 *     once per voxel of the emission scan (65536 per chunk) and once per BFS
 *     neighbour test. `lightBuildOptics` calls the (injectable) `propsOf` once
 *     per block id instead and keeps the four fields in `Uint8Array`s.
 *  2. `SimVoxelWorld` resolves a chunk through `chunkKey(cx, cz)`, which is a
 *     template string, so every light read and write allocated a string. The
 *     cache below keys chunks by a packed integer and memoises the last lookup,
 *     which a spatially coherent BFS hits almost every time.
 *
 * Neither changes any result: the tables are filled from the same `propsOf` the
 * engine was given, and the cache is invalidated whenever the loaded chunk set
 * changes size.
 */
import { worldToChunk } from '@voxelcraft/core-types'
import type { BlockId, ChunkData, LightProps } from '@voxelcraft/core-types'
import type { SimVoxelWorld } from '../shared/voxelWorld'

/**
 * Block ids covered eagerly. The contract tops out at `BLOCK_V2_MAX` (99) plus
 * the experimental 200..255 range, so 1024 covers everything with headroom;
 * anything above it falls back to `propsOf`.
 */
const TABLE_SIZE = 1024

export interface LightOptics {
	readonly opacity: Uint8Array
	readonly emission: Uint8Array
	readonly skyFilter: Uint8Array
	/** 1 when sky light falls straight down through the voxel. */
	readonly skyPass: Uint8Array
	/** Fallback for ids outside the tables. */
	readonly propsOf: (id: BlockId) => LightProps
}

/** Builds the optics tables for one engine instance from its `propsOf`. */
export function lightBuildOptics(propsOf: (id: BlockId) => LightProps): LightOptics {
	const opacity = new Uint8Array(TABLE_SIZE)
	const emission = new Uint8Array(TABLE_SIZE)
	const skyFilter = new Uint8Array(TABLE_SIZE)
	const skyPass = new Uint8Array(TABLE_SIZE)
	for (let id = 0; id < TABLE_SIZE; id++) {
		const props = propsOf(id)
		opacity[id] = props.opacity
		emission[id] = props.emission
		skyFilter[id] = props.skyFilter
		skyPass[id] = props.skyPassThrough ? 1 : 0
	}
	return { opacity, emission, skyFilter, skyPass, propsOf }
}

export function opticsOpacity(optics: LightOptics, id: BlockId): number {
	return (id >>> 0) < TABLE_SIZE ? optics.opacity[id] : optics.propsOf(id).opacity
}

export function opticsEmission(optics: LightOptics, id: BlockId): number {
	return (id >>> 0) < TABLE_SIZE ? optics.emission[id] : optics.propsOf(id).emission
}

export function opticsSkyFilter(optics: LightOptics, id: BlockId): number {
	return (id >>> 0) < TABLE_SIZE ? optics.skyFilter[id] : optics.propsOf(id).skyFilter
}

/** 1 when sky light passes straight through, 0 otherwise. */
export function opticsSkyPass(optics: LightOptics, id: BlockId): number {
	if ((id >>> 0) < TABLE_SIZE) return optics.skyPass[id]
	return optics.propsOf(id).skyPassThrough ? 1 : 0
}

export interface LightChunkCache {
	/** Chunk owning the (cx, cz) column, or `undefined` when it is not loaded. */
	chunkAt(cx: number, cz: number): ChunkData | undefined
	/** Same lookup from world coordinates. */
	at(x: number, z: number): ChunkData | undefined
	/** Drops every memoised entry. Call it when chunks are added or removed. */
	reset(): void
}

/**
 * Packs a chunk coordinate pair into one integer key.
 *
 * 16 bits per axis, so coordinates outside +/-32768 chunks would alias. That is
 * roughly +/-524288 blocks, far beyond any world this engine loads, and the
 * fallback would only be a cache collision inside one engine instance.
 */
const cacheKey = (cx: number, cz: number): number => ((cx & 0xffff) << 16) | (cz & 0xffff)

export function lightCreateChunkCache(world: SimVoxelWorld): LightChunkCache {
	const entries = new Map<number, ChunkData | undefined>()
	let knownSize = -1
	let lastKey = 0
	let lastChunk: ChunkData | undefined
	let hasLast = false

	const reset = (): void => {
		entries.clear()
		hasLast = false
		knownSize = world.chunks.size
	}

	const chunkAt = (cx: number, cz: number): ChunkData | undefined => {
		if (world.chunks.size !== knownSize) reset()
		const key = cacheKey(cx, cz)
		if (hasLast && key === lastKey) return lastChunk
		let chunk = entries.get(key)
		if (chunk === undefined && !entries.has(key)) {
			chunk = world.getChunk(cx, cz)
			entries.set(key, chunk)
		}
		lastKey = key
		lastChunk = chunk
		hasLast = true
		return chunk
	}

	return {
		chunkAt,
		at: (x: number, z: number): ChunkData | undefined =>
			chunkAt(worldToChunk(x), worldToChunk(z)),
		reset,
	}
}
