/**
 * The authoritative block store. Columns are generated on first touch and then
 * kept, so the identity of the returned ChunkColumn matters as much as its
 * values: the streamer holds on to it and compares `revision` to notice that a
 * payload it already sent is stale.
 */
import {
	BLOCK,
	CHUNK_VOLUME,
	CHUNK_Y,
	DIMENSION,
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

function inBuildRange(y: number): boolean {
	return y >= MIN_Y && y <= MAX_Y
}

export function createServerWorld(
	seed: number,
	dimension: DimensionId = DIMENSION.Overworld,
): ServerWorld {
	const columns = new Map<string, ChunkColumn>()

	function chunk(cx: number, cz: number): ChunkColumn {
		const key = chunkKey(cx, cz)
		const cached = columns.get(key)
		if (cached !== undefined) return cached
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		generateColumn(seed, cx, cz, blocks, fluids)
		const column: ChunkColumn = { cx, cz, blocks, fluids, revision: 0 }
		columns.set(key, column)
		return column
	}

	function columnAt(x: number, z: number): ChunkColumn {
		return chunk(worldToChunk(x), worldToChunk(z))
	}

	return {
		seed,
		dimension,
		chunk,
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
			column.revision += 1
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
