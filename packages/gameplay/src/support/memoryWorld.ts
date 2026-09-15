import {
	BLOCK,
	FLUID,
	type BlockEntityData,
	type BlockId,
	type Vec3i,
} from '@voxelcraft/core-types'
import { BLOCKS, type GameplayBlockRegistry } from '../blocks/registry'
import { createBlockEntityData } from '../blockEntities/data'
import { posKey, type BlockEntityWorld } from './world'

export interface MemoryWorldEntry {
	pos: Vec3i
	data: BlockEntityData
}

/**
 * Sparse in-memory world. Unbounded, dependency free and deterministic, so
 * block entity, redstone and persistence tests can build small scenes without
 * booting the real chunk store.
 */
export interface MemoryWorld extends BlockEntityWorld {
	readonly registry: GameplayBlockRegistry
	/** Sets a block and, optionally, an explicit block entity payload. */
	place(x: number, y: number, z: number, id: BlockId, data?: BlockEntityData): void
	/** All block entities, ordered by y, then z, then x. */
	blockEntityEntries(): MemoryWorldEntry[]
	clear(): void
}

export function createMemoryWorld(
	options: {
		registry?: GameplayBlockRegistry
		defaultBlock?: BlockId
		/** Create default payloads when a block entity block is placed (default true). */
		autoBlockEntities?: boolean
	} = {},
): MemoryWorld {
	const registry = options.registry ?? BLOCKS
	const defaultBlock = options.defaultBlock ?? BLOCK.AIR
	const autoBlockEntities = options.autoBlockEntities ?? true
	const blocks = new Map<string, BlockId>()
	const fluids = new Map<string, number>()
	const entities = new Map<string, MemoryWorldEntry>()

	const world: MemoryWorld = {
		registry,
		getBlock(x: number, y: number, z: number): BlockId {
			return blocks.get(posKey(x, y, z)) ?? defaultBlock
		},
		getFluid(x: number, y: number, z: number): number {
			return fluids.get(posKey(x, y, z)) ?? 0
		},
		isSolid(x: number, y: number, z: number): boolean {
			return registry.isSolid(world.getBlock(x, y, z))
		},
		isLiquid(x: number, y: number, z: number): boolean {
			if (world.getFluid(x, y, z) !== 0) return true
			const def = registry.tryById(world.getBlock(x, y, z))
			return def !== undefined && def.fluid !== FLUID.None
		},
		isLoaded(): boolean {
			return true
		},
		setBlock(x: number, y: number, z: number, id: BlockId): void {
			const key = posKey(x, y, z)
			const previous = blocks.get(key) ?? defaultBlock
			if (id === defaultBlock) blocks.delete(key)
			else blocks.set(key, id)
			if (previous === id) return

			const kind = registry.tryById(id)?.blockEntity ?? null
			if (kind === null) {
				entities.delete(key)
				return
			}
			const existing = entities.get(key)
			if (existing !== undefined && existing.data.kind === kind) return
			if (autoBlockEntities) {
				entities.set(key, { pos: { x, y, z }, data: createBlockEntityData(kind) })
			} else {
				entities.delete(key)
			}
		},
		setFluid(x: number, y: number, z: number, packed: number): void {
			const key = posKey(x, y, z)
			if (packed === 0) fluids.delete(key)
			else fluids.set(key, packed)
		},
		getBlockEntity(x: number, y: number, z: number): BlockEntityData | undefined {
			return entities.get(posKey(x, y, z))?.data
		},
		setBlockEntity(x: number, y: number, z: number, data: BlockEntityData | null): void {
			const key = posKey(x, y, z)
			if (data === null) entities.delete(key)
			else entities.set(key, { pos: { x, y, z }, data })
		},
		place(x: number, y: number, z: number, id: BlockId, data?: BlockEntityData): void {
			world.setBlock(x, y, z, id)
			if (data !== undefined) world.setBlockEntity(x, y, z, data)
		},
		blockEntityEntries(): MemoryWorldEntry[] {
			return [...entities.values()].sort(
				(a, b) => a.pos.y - b.pos.y || a.pos.z - b.pos.z || a.pos.x - b.pos.x,
			)
		},
		clear(): void {
			blocks.clear()
			fluids.clear()
			entities.clear()
		},
	}

	return world
}
