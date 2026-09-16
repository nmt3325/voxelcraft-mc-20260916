/**
 * The authoritative block store.
 *
 * Columns are generated on first touch and then cached, and the identity of the
 * returned ChunkColumn matters as much as its values: the streamer encodes the
 * very arrays an edit lands in.
 *
 * The cache is bounded. It used to be a Map that only ever grew, so any path
 * that read a block at an arbitrary coordinate - a rejected block edit, for
 * example - let a client generate and pin unbounded terrain. Clean columns are
 * now evicted least recently used first. A column holding an accepted edit is
 * game state rather than a cache entry, so it is pinned: dropping it would
 * silently roll the edit back the next time the column was generated.
 */
import {
	BLOCK,
	CHUNK_VOLUME,
	CHUNK_Y,
	DIMENSION,
	NET,
	blockIndex,
	chunkKey,
	worldToChunk,
	worldToLocal,
	type BlockId,
	type DimensionId,
} from '@voxelcraft/core-types'
import type { ChunkColumn, ServerWorld } from '../types'
import { generateColumn } from './generator'

/** Buildable y range. Matches VALIDATION.minY / VALIDATION.maxY by construction. */
const MIN_Y = 0
const MAX_Y = CHUNK_Y - 1

/** Columns in one full stream window, (2r + 1)^2 under the square rule. */
const STREAM_WINDOW_COLUMNS = (2 * NET.streamRadius + 1) ** 2

export const WORLD_CACHE = {
	/**
	 * Resident clean columns. Two stream windows: one for where a player is and
	 * one for the trail it just left, so walking back a few chunks does not pay
	 * to regenerate what was streamed a second ago. A window per player would be
	 * maxPlayers times this and is not worth the resident memory, because the
	 * generator is deterministic and a re-touch only costs time.
	 */
	maxColumns: STREAM_WINDOW_COLUMNS * 2,
} as const

function inBuildRange(y: number): boolean {
	return y >= MIN_Y && y <= MAX_Y
}

export interface ServerWorldOptions {
	/** Resident clean columns before eviction starts. Defaults to WORLD_CACHE. */
	readonly maxColumns?: number
}

export function createServerWorld(
	seed: number,
	dimension: DimensionId = DIMENSION.Overworld,
	options: ServerWorldOptions = {},
): ServerWorld {
	const maxColumns = Math.max(1, Math.floor(options.maxColumns ?? WORLD_CACHE.maxColumns))
	const columns = new Map<string, ChunkColumn>()
	/** Keys of columns an accepted edit touched. Pinned, never evicted. */
	const edited = new Set<string>()

	/** Re-inserting is what turns the insertion ordered Map into an LRU. */
	function touch(key: string, column: ChunkColumn): void {
		columns.delete(key)
		columns.set(key, column)
	}

	function evict(): void {
		if (columns.size <= maxColumns) return
		for (const key of columns.keys()) {
			if (columns.size <= maxColumns) return
			if (edited.has(key)) continue
			columns.delete(key)
		}
		// If every resident column is pinned the store stays above the cap on
		// purpose: player edits are not a cache the server may throw away.
	}

	function chunk(cx: number, cz: number): ChunkColumn {
		const key = chunkKey(cx, cz)
		const cached = columns.get(key)
		if (cached !== undefined) {
			touch(key, cached)
			return cached
		}
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		generateColumn(seed, cx, cz, blocks, fluids)
		const column: ChunkColumn = { cx, cz, blocks, fluids }
		columns.set(key, column)
		evict()
		return column
	}

	function columnAt(x: number, z: number): ChunkColumn {
		return chunk(worldToChunk(x), worldToChunk(z))
	}

	return {
		seed,
		dimension,
		chunk,
		hasColumn(cx: number, cz: number): boolean {
			// A peek, so it deliberately does not count as a use for the LRU.
			return columns.has(chunkKey(cx, cz))
		},
		block(x: number, y: number, z: number): BlockId {
			// Air rather than a throw: a mob or a player at the world ceiling must
			// not be able to kill the tick loop.
			if (!inBuildRange(y)) return BLOCK.AIR
			return columnAt(x, z).blocks[blockIndex(worldToLocal(x), y, worldToLocal(z))]
		},
		setBlock(x: number, y: number, z: number, block: BlockId): boolean {
			if (!inBuildRange(y)) return false
			const column = columnAt(x, z)
			column.blocks[blockIndex(worldToLocal(x), y, worldToLocal(z))] = block
			// From here on this column is state, not cache.
			edited.add(chunkKey(column.cx, column.cz))
			return true
		},
		surfaceY(x: number, z: number): number {
			const column = columnAt(x, z)
			const lx = worldToLocal(x)
			const lz = worldToLocal(z)
			for (let y = MAX_Y; y >= MIN_Y; y--) {
				if (column.blocks[blockIndex(lx, y, lz)] !== BLOCK.AIR) return y + 1
			}
			return MIN_Y
		},
		get loadedChunks(): number {
			return columns.size
		},
	}
}
