/**
 * In-memory region of generated chunks that implements VoxelEditView, so
 * decorate can be exercised in tests. Owned by task world-a; the L2 tasks may
 * import it but must not edit it.
 */
import type { BlockId, VoxelEditView, WorldGenerator } from '@voxelcraft/core-types'
import { CHUNK_VOLUME, CHUNK_Y, blockIndex, worldToChunk, worldToLocal } from '@voxelcraft/core-types'
import { isLiquidBlock, isSolidBlock } from '../internal'

export interface GeneratedChunk {
	readonly cx: number
	readonly cz: number
	readonly blocks: Uint16Array
	readonly fluids: Uint8Array
}

/**
 * Chunk visit orders used by the order-invariance test. `quadrants` mimics four
 * parallel workers each owning one quarter of the region.
 */
export type GenerationOrder = 'forward' | 'reverse' | 'quadrants'

function key(cx: number, cz: number): string {
	return `${cx},${cz}`
}

export class ChunkGrid implements VoxelEditView {
	private readonly chunks = new Map<string, GeneratedChunk>()

	add(chunk: GeneratedChunk): void {
		this.chunks.set(key(chunk.cx, chunk.cz), chunk)
	}

	chunk(cx: number, cz: number): GeneratedChunk | undefined {
		return this.chunks.get(key(cx, cz))
	}

	all(): GeneratedChunk[] {
		return [...this.chunks.values()]
	}

	getBlock(x: number, y: number, z: number): BlockId {
		if (y < 0 || y >= CHUNK_Y) return 0
		const c = this.chunks.get(key(worldToChunk(x), worldToChunk(z)))
		if (c === undefined) return 0
		return c.blocks[blockIndex(worldToLocal(x), y, worldToLocal(z))]
	}

	getFluid(x: number, y: number, z: number): number {
		if (y < 0 || y >= CHUNK_Y) return 0
		const c = this.chunks.get(key(worldToChunk(x), worldToChunk(z)))
		if (c === undefined) return 0
		return c.fluids[blockIndex(worldToLocal(x), y, worldToLocal(z))]
	}

	isSolid(x: number, y: number, z: number): boolean {
		return isSolidBlock(this.getBlock(x, y, z))
	}

	isLiquid(x: number, y: number, z: number): boolean {
		return isLiquidBlock(this.getBlock(x, y, z))
	}

	isLoaded(cx: number, cz: number): boolean {
		return this.chunks.has(key(cx, cz))
	}

	setBlock(x: number, y: number, z: number, id: BlockId): void {
		if (y < 0 || y >= CHUNK_Y) return
		const c = this.chunks.get(key(worldToChunk(x), worldToChunk(z)))
		if (c === undefined) return
		c.blocks[blockIndex(worldToLocal(x), y, worldToLocal(z))] = id
	}

	setFluid(x: number, y: number, z: number, packed: number): void {
		if (y < 0 || y >= CHUNK_Y) return
		const c = this.chunks.get(key(worldToChunk(x), worldToChunk(z)))
		if (c === undefined) return
		c.fluids[blockIndex(worldToLocal(x), y, worldToLocal(z))] = packed
	}
}

export function chunkCoords(
	cx0: number,
	cz0: number,
	size: number,
	order: GenerationOrder = 'forward',
): Array<[number, number]> {
	const forward: Array<[number, number]> = []
	for (let dz = 0; dz < size; dz++) {
		for (let dx = 0; dx < size; dx++) forward.push([cx0 + dx, cz0 + dz])
	}
	if (order === 'forward') return forward
	if (order === 'reverse') return forward.reverse()

	const half = Math.ceil(size / 2)
	const quads: Array<[number, number]> = [
		[0, 0],
		[1, 0],
		[0, 1],
		[1, 1],
	]
	const out: Array<[number, number]> = []
	for (const [qx, qz] of quads) {
		const zEnd = Math.min(size, qz * half + half)
		const xEnd = Math.min(size, qx * half + half)
		for (let dz = qz * half; dz < zEnd; dz++) {
			for (let dx = qx * half; dx < xEnd; dx++) out.push([cx0 + dx, cz0 + dz])
		}
	}
	return out
}

export function generateRegion(
	generator: WorldGenerator,
	cx0: number,
	cz0: number,
	size: number,
	order: GenerationOrder = 'forward',
): ChunkGrid {
	const grid = new ChunkGrid()
	for (const [cx, cz] of chunkCoords(cx0, cz0, size, order)) {
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		generator.generateChunk(cx, cz, blocks, fluids)
		grid.add({ cx, cz, blocks, fluids })
	}
	return grid
}
