/**
 * AABB helpers.
 *
 * An entity box is axis aligned, centred on `x` / `z` and standing on `y`:
 * `y` is the feet, `y + height` the head. Sizes come from `PHYSICS`
 * (`playerWidth`, `playerHeight`); nothing here re-defines them.
 */
import { PHYSICS } from '@voxelcraft/core-types'
import type { AABB } from '@voxelcraft/core-types'

export function createAabb(
	minX: number,
	minY: number,
	minZ: number,
	maxX: number,
	maxY: number,
	maxZ: number,
): AABB {
	return { minX, minY, minZ, maxX, maxY, maxZ }
}

export function cloneAabb(box: AABB): AABB {
	return { ...box }
}

/** Box for an entity standing at (x, y, z) with feet at `y`. */
export function entityBox(
	x: number,
	y: number,
	z: number,
	width: number = PHYSICS.playerWidth,
	height: number = PHYSICS.playerHeight,
): AABB {
	const half = width / 2
	return { minX: x - half, minY: y, minZ: z - half, maxX: x + half, maxY: y + height, maxZ: z + half }
}

export function playerBox(x: number, y: number, z: number): AABB {
	return entityBox(x, y, z, PHYSICS.playerWidth, PHYSICS.playerHeight)
}

export function offsetAabb(box: AABB, dx: number, dy: number, dz: number): AABB {
	return {
		minX: box.minX + dx,
		minY: box.minY + dy,
		minZ: box.minZ + dz,
		maxX: box.maxX + dx,
		maxY: box.maxY + dy,
		maxZ: box.maxZ + dz,
	}
}

/** Grows the box by the given amounts on both sides of each axis. */
export function expandAabb(box: AABB, dx: number, dy: number, dz: number): AABB {
	return {
		minX: box.minX - dx,
		minY: box.minY - dy,
		minZ: box.minZ - dz,
		maxX: box.maxX + dx,
		maxY: box.maxY + dy,
		maxZ: box.maxZ + dz,
	}
}

export function aabbOverlaps(a: AABB, b: AABB, epsilon = 0): boolean {
	return (
		a.minX < b.maxX - epsilon &&
		a.maxX > b.minX + epsilon &&
		a.minY < b.maxY - epsilon &&
		a.maxY > b.minY + epsilon &&
		a.minZ < b.maxZ - epsilon &&
		a.maxZ > b.minZ + epsilon
	)
}

export function aabbCenterX(box: AABB): number {
	return (box.minX + box.maxX) / 2
}

export function aabbCenterZ(box: AABB): number {
	return (box.minZ + box.maxZ) / 2
}

/** Box of a single voxel. */
export function voxelBox(x: number, y: number, z: number): AABB {
	return { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 }
}
