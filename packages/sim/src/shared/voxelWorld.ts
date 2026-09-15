/**
 * In-memory voxel storage shared by every simulation system.
 *
 * It implements the contract's `VoxelEditView` on top of `ChunkData`, so the
 * physics sweep, the DDA raycast, light propagation, fluids and pathfinding all
 * read the world through the same object and can never disagree about what is
 * solid.
 *
 * Conventions:
 *  - Coordinates are world-space integers. `y` outside `0..CHUNK_Y-1` is air.
 *  - Unloaded chunks read as air and report `isLoaded === false`; pathfinding
 *    makes them expensive rather than impassable (`PATHFIND.unloadedPenalty`).
 *  - `fluids` is the source of truth for level and falling. When a cell has no
 *    fluid byte but its block id is a fluid, `getFluid` derives a source byte,
 *    so a world built by placing WATER blocks still reports liquid.
 *  - Light is derived state: `setFluid` never touches it (contract note in
 *    `light.ts`), `setBlock` only marks the section dirty.
 */
import {
	BLOCK,
	CHUNK_Y,
	FLUID,
	blockIndex,
	chunkKey,
	createChunkData,
	getBlockLight,
	getSkyLight,
	hashBuffer,
	packFluid,
	setBlockLight,
	setSkyLight,
	unpackFluid,
	worldToChunk,
	worldToLocal,
	MAX_LIGHT,
} from '@voxelcraft/core-types'
import type { BlockId, ChunkData, FluidState, VoxelEditView } from '@voxelcraft/core-types'
import { fluidKindOf, simBlockProps } from './blockProps'
import type { SimBlockProps } from './blockProps'

export interface SimVoxelWorld extends VoxelEditView {
	readonly chunks: ReadonlyMap<string, ChunkData>
	getChunk(cx: number, cz: number): ChunkData | undefined
	ensureChunk(cx: number, cz: number): ChunkData
	unloadChunk(cx: number, cz: number): void
	/** Loaded chunks in ascending (cx, cz) order: deterministic iteration. */
	orderedChunks(): ChunkData[]
	propsAt(x: number, y: number, z: number): Readonly<SimBlockProps>
	inBounds(y: number): boolean
	fluidStateAt(x: number, y: number, z: number): FluidState
	getLightByte(x: number, y: number, z: number): number
	setLightByte(x: number, y: number, z: number, packed: number): void
	getSkyLightAt(x: number, y: number, z: number): number
	setSkyLightAt(x: number, y: number, z: number, value: number): void
	getBlockLightAt(x: number, y: number, z: number): number
	setBlockLightAt(x: number, y: number, z: number, value: number): void
	/** Bumps revision, flags the section for re-mesh and marks the chunk unsaved. */
	markDirty(x: number, y: number, z: number): void
	/** Deterministic digest of blocks, fluids and light over all loaded chunks. */
	hash(): number
}

const EMPTY_FLUID: FluidState = { kind: FLUID.None, level: 0, falling: false }

export function createSimVoxelWorld(): SimVoxelWorld {
	const chunks = new Map<string, ChunkData>()

	const inBounds = (y: number): boolean => y >= 0 && y < CHUNK_Y

	const getChunk = (cx: number, cz: number): ChunkData | undefined => chunks.get(chunkKey(cx, cz))

	const ensureChunk = (cx: number, cz: number): ChunkData => {
		const key = chunkKey(cx, cz)
		let chunk = chunks.get(key)
		if (!chunk) {
			chunk = createChunkData(cx, cz)
			chunk.generated = true
			chunks.set(key, chunk)
		}
		return chunk
	}

	const chunkAt = (x: number, z: number): ChunkData | undefined =>
		getChunk(worldToChunk(x), worldToChunk(z))

	const recomputeColumn = (chunk: ChunkData, lx: number, lz: number): void => {
		let y = CHUNK_Y - 1
		while (y >= 0 && simBlockProps(chunk.blocks[blockIndex(lx, y, lz)]).skyPassThrough) y--
		chunk.heightmap[(lz << 4) | lx] = y + 1
	}

	const markDirty = (x: number, y: number, z: number): void => {
		const chunk = chunkAt(x, z)
		if (!chunk || !inBounds(y)) return
		chunk.revision++
		chunk.dirtySections |= 1 << ((y >> 4) & 15)
		chunk.dirtyForSave = true
	}

	const getBlock = (x: number, y: number, z: number): BlockId => {
		if (!inBounds(y)) return BLOCK.AIR
		const chunk = chunkAt(x, z)
		if (!chunk) return BLOCK.AIR
		return chunk.blocks[blockIndex(worldToLocal(x), y, worldToLocal(z))]
	}

	const getFluid = (x: number, y: number, z: number): number => {
		if (!inBounds(y)) return 0
		const chunk = chunkAt(x, z)
		if (!chunk) return 0
		const index = blockIndex(worldToLocal(x), y, worldToLocal(z))
		const packed = chunk.fluids[index]
		if (packed !== 0) return packed
		const kind = fluidKindOf(chunk.blocks[index])
		if (kind === FLUID.None) return 0
		return packFluid({ kind, level: 0, falling: false })
	}

	const world: SimVoxelWorld = {
		chunks,
		getChunk,
		ensureChunk,
		unloadChunk(cx: number, cz: number): void {
			chunks.delete(chunkKey(cx, cz))
		},
		orderedChunks(): ChunkData[] {
			return [...chunks.values()].sort((a, b) => (a.cx === b.cx ? a.cz - b.cz : a.cx - b.cx))
		},
		getBlock,
		getFluid,
		isSolid(x: number, y: number, z: number): boolean {
			return simBlockProps(getBlock(x, y, z)).solid
		},
		isLiquid(x: number, y: number, z: number): boolean {
			return unpackFluid(getFluid(x, y, z)).kind !== FLUID.None
		},
		isLoaded(cx: number, cz: number): boolean {
			return chunks.has(chunkKey(cx, cz))
		},
		setBlock(x: number, y: number, z: number, id: BlockId): void {
			if (!inBounds(y)) return
			const chunk = ensureChunk(worldToChunk(x), worldToChunk(z))
			const lx = worldToLocal(x)
			const lz = worldToLocal(z)
			const index = blockIndex(lx, y, lz)
			if (chunk.blocks[index] === id) return
			chunk.blocks[index] = id
			recomputeColumn(chunk, lx, lz)
			markDirty(x, y, z)
		},
		setFluid(x: number, y: number, z: number, packed: number): void {
			if (!inBounds(y)) return
			const chunk = ensureChunk(worldToChunk(x), worldToChunk(z))
			const index = blockIndex(worldToLocal(x), y, worldToLocal(z))
			if (chunk.fluids[index] === (packed & 0xff)) return
			chunk.fluids[index] = packed & 0xff
			markDirty(x, y, z)
		},
		propsAt(x: number, y: number, z: number): Readonly<SimBlockProps> {
			return simBlockProps(getBlock(x, y, z))
		},
		inBounds,
		fluidStateAt(x: number, y: number, z: number): FluidState {
			const packed = getFluid(x, y, z)
			return packed === 0 ? { ...EMPTY_FLUID } : unpackFluid(packed)
		},
		getLightByte(x: number, y: number, z: number): number {
			if (!inBounds(y)) return y >= CHUNK_Y ? MAX_LIGHT << 4 : 0
			const chunk = chunkAt(x, z)
			if (!chunk) return 0
			return chunk.light[blockIndex(worldToLocal(x), y, worldToLocal(z))]
		},
		setLightByte(x: number, y: number, z: number, packed: number): void {
			if (!inBounds(y)) return
			const chunk = chunkAt(x, z)
			if (!chunk) return
			chunk.light[blockIndex(worldToLocal(x), y, worldToLocal(z))] = packed & 0xff
		},
		getSkyLightAt(x: number, y: number, z: number): number {
			if (y >= CHUNK_Y) return MAX_LIGHT
			if (y < 0) return 0
			const chunk = chunkAt(x, z)
			if (!chunk) return 0
			return getSkyLight(chunk.light, blockIndex(worldToLocal(x), y, worldToLocal(z)))
		},
		setSkyLightAt(x: number, y: number, z: number, value: number): void {
			if (!inBounds(y)) return
			const chunk = chunkAt(x, z)
			if (!chunk) return
			setSkyLight(chunk.light, blockIndex(worldToLocal(x), y, worldToLocal(z)), value)
		},
		getBlockLightAt(x: number, y: number, z: number): number {
			if (!inBounds(y)) return 0
			const chunk = chunkAt(x, z)
			if (!chunk) return 0
			return getBlockLight(chunk.light, blockIndex(worldToLocal(x), y, worldToLocal(z)))
		},
		setBlockLightAt(x: number, y: number, z: number, value: number): void {
			if (!inBounds(y)) return
			const chunk = chunkAt(x, z)
			if (!chunk) return
			setBlockLight(chunk.light, blockIndex(worldToLocal(x), y, worldToLocal(z)), value)
		},
		markDirty,
		hash(): number {
			let h = 0x811c9dc5 >>> 0
			const mix = (value: number): void => {
				h = Math.imul(h ^ (value >>> 0), 0x01000193) >>> 0
			}
			for (const chunk of world.orderedChunks()) {
				mix(chunk.cx)
				mix(chunk.cz)
				mix(hashBuffer(chunk.blocks))
				mix(hashBuffer(chunk.fluids))
				mix(hashBuffer(chunk.light))
			}
			return h >>> 0
		},
	}
	return world
}
