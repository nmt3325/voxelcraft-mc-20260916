/**
 * Voxel ray cast (Amanatides & Woo DDA).
 *
 * Used for block picking: it returns the first solid voxel along the ray plus
 * the face normal that was crossed, which is exactly what block placement
 * needs. Grid stepping means no sampling gaps, unlike a fixed-step march.
 */

export interface Vec3 {
	x: number
	y: number
	z: number
}

export interface RaycastHit {
	/** The solid voxel that was hit. */
	block: Vec3
	/** Face normal pointing back towards the ray origin. */
	normal: Vec3
	/** Neighbouring empty voxel, i.e. where a new block would be placed. */
	place: Vec3
	distance: number
}

export type SolidTest = (x: number, y: number, z: number) => boolean

export function raycastVoxels(
	origin: Vec3,
	direction: Vec3,
	maxDistance: number,
	isSolid: SolidTest,
): RaycastHit | null {
	const length = Math.hypot(direction.x, direction.y, direction.z)
	if (length === 0 || !Number.isFinite(length)) return null
	const dx = direction.x / length
	const dy = direction.y / length
	const dz = direction.z / length

	let x = Math.floor(origin.x)
	let y = Math.floor(origin.y)
	let z = Math.floor(origin.z)

	const stepX = dx > 0 ? 1 : -1
	const stepY = dy > 0 ? 1 : -1
	const stepZ = dz > 0 ? 1 : -1

	const deltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity
	const deltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity
	const deltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity

	let nextX =
		dx !== 0 ? (dx > 0 ? x + 1 - origin.x : origin.x - x) * deltaX : Infinity
	let nextY =
		dy !== 0 ? (dy > 0 ? y + 1 - origin.y : origin.y - y) * deltaY : Infinity
	let nextZ =
		dz !== 0 ? (dz > 0 ? z + 1 - origin.z : origin.z - z) * deltaZ : Infinity

	// The camera can start inside a block (e.g. in water); report it at t = 0.
	if (isSolid(x, y, z)) {
		return {
			block: { x, y, z },
			normal: { x: 0, y: 0, z: 0 },
			place: { x, y, z },
			distance: 0,
		}
	}

	let travelled = 0
	let guard = 0
	const maxSteps = Math.ceil(maxDistance) * 3 + 8

	while (travelled <= maxDistance && guard++ < maxSteps) {
		let normal: Vec3
		if (nextX <= nextY && nextX <= nextZ) {
			x += stepX
			travelled = nextX
			nextX += deltaX
			normal = { x: -stepX, y: 0, z: 0 }
		} else if (nextY <= nextZ) {
			y += stepY
			travelled = nextY
			nextY += deltaY
			normal = { x: 0, y: -stepY, z: 0 }
		} else {
			z += stepZ
			travelled = nextZ
			nextZ += deltaZ
			normal = { x: 0, y: 0, z: -stepZ }
		}
		if (travelled > maxDistance) return null
		if (isSolid(x, y, z)) {
			return {
				block: { x, y, z },
				normal,
				place: { x: x + normal.x, y: y + normal.y, z: z + normal.z },
				distance: travelled,
			}
		}
	}
	return null
}
