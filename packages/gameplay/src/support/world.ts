import type { BlockEntityData, VoxelEditView } from '@voxelcraft/core-types'

/**
 * Voxel access plus block-entity storage: the minimum surface the gameplay
 * block entities, redstone and persistence code needs from a world.
 *
 * `@voxelcraft/world` provides the production implementation; `createMemoryWorld`
 * in this package provides a dependency-free one for tests.
 */
export interface BlockEntityWorld extends VoxelEditView {
	getBlockEntity(x: number, y: number, z: number): BlockEntityData | undefined
	/** Passing `null` removes the block entity at that position. */
	setBlockEntity(x: number, y: number, z: number, data: BlockEntityData | null): void
}

/** Stable string key for a voxel position. */
export function posKey(x: number, y: number, z: number): string {
	return `${x},${y},${z}`
}
