/**
 * Chunk-local seeding for the light engine.
 *
 * This is the hot half of H-05. The original `seedChunk` did three expensive
 * things per chunk, and none of them were needed:
 *
 *  - it scanned each column top down with a stride of 256 bytes and allocated a
 *    `LightProps` object per voxel (~49k objects per chunk),
 *  - it wrote the direct sky band voxel by voxel even though a whole y layer is
 *    256 contiguous bytes (`blockIndex` is `(y << 8) | (z << 4) | x`), so the
 *    uniformly lit band above the highest column top is a single memset,
 *  - it queued every direct sky voxel of every border column as a BFS source,
 *    about 11k records per chunk that cannot light anything while propagation
 *    is confined to the chunk.
 *
 * The results are identical. The frontier rule is the same one the original
 * comment describes ("a direct sky voxel surrounded by direct sky voxels cannot
 * light anything new"), only evaluated properly: the blanket `edge` term is
 * gone, because an out-of-chunk neighbour is not writable during a confined
 * seed and seams are `stitchBoundaries`' job. Dropping it also removes a latent
 * bug the term was masking, since `tops[(lz << 4) | (lx + 1)]` reads the top of
 * column `(0, lz + 1)` when `lx` is 15, and `tops[-1]` when `lx` is 0.
 */
import {
	BLOCK,
	CHUNK_AREA,
	CHUNK_VOLUME,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	MAX_LIGHT,
	indexX,
	indexY,
	indexZ,
	setBlockLight,
} from '@voxelcraft/core-types'
import type { ChunkData } from '@voxelcraft/core-types'
import { LightQueue } from './lightQueue'
import { opticsEmission, opticsSkyPass } from './lightTables'
import type { LightOptics } from './lightTables'

/** Light byte of a voxel with full sky and no block light: `(MAX_LIGHT << 4)`. */
const SKY_FULL_BYTE = MAX_LIGHT << 4

export interface LightSeedScratch {
	/** First y above the highest sky blocker, per column slot `(lz << 4) | lx`. */
	readonly tops: Uint16Array
	/** 1 once a column's top has been found during the top scan. */
	readonly resolved: Uint8Array
}

/** Reusable per-engine buffers, so seeding a chunk allocates nothing. */
export function lightCreateSeedScratch(): LightSeedScratch {
	return { tops: new Uint16Array(CHUNK_AREA), resolved: new Uint8Array(CHUNK_AREA) }
}

/** First y above the highest sky blocking voxel of one column. */
export function lightColumnTop(
	chunk: ChunkData,
	optics: LightOptics,
	lx: number,
	lz: number,
): number {
	const slot = (lz << 4) | lx
	for (let y = CHUNK_Y - 1; y >= 0; y--) {
		if (opticsSkyPass(optics, chunk.blocks[(y << 8) | slot]) === 0) return y + 1
	}
	return 0
}

export interface LightSeedStats {
	/** Lowest column top in the chunk. */
	minTop: number
	/** Highest column top in the chunk. */
	maxTop: number
	/** Direct sky voxels queued as BFS sources. */
	skyFrontier: number
	/** Emissive voxels queued as BFS sources. */
	emitters: number
}

/**
 * Clears the chunk's light, writes the direct sky band and the emissive voxels,
 * and queues only the voxels that can actually spread. The caller drains the
 * queues with propagation confined to this chunk.
 */
export function lightSeedChunkLocal(
	chunk: ChunkData,
	optics: LightOptics,
	scratch: LightSeedScratch,
	skyQueue: LightQueue,
	blockQueue: LightQueue,
): LightSeedStats {
	const blocks = chunk.blocks
	const light = chunk.light
	const tops = scratch.tops
	const resolved = scratch.resolved
	light.fill(0)
	tops.fill(0)
	resolved.fill(0)

	// One y layer at a time, top down: a layer is 256 contiguous bytes, so this
	// walks `blocks` sequentially instead of striding per column, and it stops as
	// soon as every column has found its blocker.
	let pending = CHUNK_AREA
	let maxTop = 0
	let minTop = CHUNK_Y
	for (let y = CHUNK_Y - 1; y >= 0 && pending > 0; y--) {
		const base = y << 8
		for (let slot = 0; slot < CHUNK_AREA; slot++) {
			if (resolved[slot] === 1) continue
			if (opticsSkyPass(optics, blocks[base + slot]) !== 0) continue
			const top = y + 1
			tops[slot] = top
			resolved[slot] = 1
			pending--
			if (top > maxTop) maxTop = top
			if (top < minTop) minTop = top
		}
	}
	// A column with no blocker at all is open all the way down to y = 0.
	if (pending > 0) minTop = 0
	if (minTop > maxTop) minTop = maxTop

	// Above the highest column top every column is direct sky, so the whole band
	// is one memset. Block light is still zero here, so writing the packed byte
	// directly is equivalent to `setSkyLight` on each voxel.
	if (maxTop < CHUNK_Y) light.fill(SKY_FULL_BYTE, maxTop << 8, CHUNK_VOLUME)
	// Only the band between the lowest and the highest top is ragged.
	for (let y = minTop; y < maxTop; y++) {
		const base = y << 8
		for (let slot = 0; slot < CHUNK_AREA; slot++) {
			if (tops[slot] <= y) light[base + slot] = SKY_FULL_BYTE
		}
	}

	const baseX = chunk.cx * CHUNK_X
	const baseZ = chunk.cz * CHUNK_Z
	let skyFrontier = 0
	// Above `maxTop` no column is shadowed and no column bottoms out, so the
	// frontier can only live in the ragged band.
	const frontierTop = maxTop < CHUNK_Y ? maxTop : CHUNK_Y - 1
	for (let y = minTop; y <= frontierTop; y++) {
		for (let lz = 0; lz < CHUNK_Z; lz++) {
			for (let lx = 0; lx < CHUNK_X; lx++) {
				const slot = (lz << 4) | lx
				const top = tops[slot]
				if (y < top) continue
				let spreads = y === top
				if (!spreads && lx > 0 && tops[slot - 1] > y) spreads = true
				if (!spreads && lx < CHUNK_X - 1 && tops[slot + 1] > y) spreads = true
				if (!spreads && lz > 0 && tops[slot - CHUNK_X] > y) spreads = true
				if (!spreads && lz < CHUNK_Z - 1 && tops[slot + CHUNK_X] > y) spreads = true
				if (!spreads) continue
				skyQueue.pushAdd(baseX + lx, y, baseZ + lz)
				skyFrontier++
			}
		}
	}

	// Air is the overwhelming majority of a chunk, so skip it outright unless the
	// injected optics claim air emits light.
	const skipAir = opticsEmission(optics, BLOCK.AIR) === 0
	let emitters = 0
	for (let i = 0; i < CHUNK_VOLUME; i++) {
		const id = blocks[i]
		if (skipAir && id === BLOCK.AIR) continue
		const emission = opticsEmission(optics, id)
		if (emission <= 0) continue
		setBlockLight(light, i, emission)
		blockQueue.pushAdd(baseX + indexX(i), indexY(i), baseZ + indexZ(i))
		emitters++
	}

	return { minTop, maxTop, skyFrontier, emitters }
}
