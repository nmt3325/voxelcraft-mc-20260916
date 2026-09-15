/**
 * Amanatides and Woo voxel DDA.
 *
 * Properties the contract asks for:
 *  - zero direction components are handled (their tMax stays Infinity, so that
 *    axis is never stepped);
 *  - an origin exactly on a voxel boundary enters the voxel the direction
 *    points into;
 *  - `normal` always points out of the hit block, back towards the origin, and
 *    `face` is the matching index in the canonical `FACE` order, so
 *    `FACE_DIRS[hit.face]` equals `hit.normal`;
 *  - `distance` is measured along the normalised direction, so `maxDistance`
 *    is a reach in blocks (`PHYSICS.reach` is 5).
 */
import { FACE } from '@voxelcraft/core-types'
import type { Face, RayHit, RaycastVoxels, Vec3f, VoxelView } from '@voxelcraft/core-types'

/** X -> NegX/PosX, Y -> NegY/PosY, Z -> NegZ/PosZ, matching FACE. */
function faceFor(axis: 0 | 1 | 2, positiveStep: boolean): Face {
	const index = axis * 2 + (positiveStep ? 0 : 1)
	switch (index) {
		case 0:
			return FACE.NegX
		case 1:
			return FACE.PosX
		case 2:
			return FACE.NegY
		case 3:
			return FACE.PosY
		case 4:
			return FACE.NegZ
		default:
			return FACE.PosZ
	}
}

function normalFor(axis: 0 | 1 | 2, positiveStep: boolean): Vec3f {
	const sign = positiveStep ? -1 : 1
	return {
		x: axis === 0 ? sign : 0,
		y: axis === 1 ? sign : 0,
		z: axis === 2 ? sign : 0,
	}
}

/** Face used when the ray starts inside a solid block: the one it came from. */
function entryFaceFromDirection(dx: number, dy: number, dz: number): 0 | 1 | 2 {
	const ax = Math.abs(dx)
	const ay = Math.abs(dy)
	const az = Math.abs(dz)
	if (ax >= ay && ax >= az) return 0
	return ay >= az ? 1 : 2
}

export const raycastVoxels: RaycastVoxels = (origin, dir, maxDistance, view): RayHit | null => {
	const length = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z)
	if (!Number.isFinite(length) || length === 0) return null
	const dx = dir.x / length
	const dy = dir.y / length
	const dz = dir.z / length

	let vx = Math.floor(origin.x)
	let vy = Math.floor(origin.y)
	let vz = Math.floor(origin.z)

	if (view.isSolid(vx, vy, vz)) {
		const axis = entryFaceFromDirection(dx, dy, dz)
		const positive = (axis === 0 ? dx : axis === 1 ? dy : dz) > 0
		const normal = normalFor(axis, positive)
		return {
			block: { x: vx, y: vy, z: vz },
			normal: { x: normal.x, y: normal.y, z: normal.z },
			distance: 0,
			face: faceFor(axis, positive),
		}
	}
	if (!(maxDistance > 0)) return null

	const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
	const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
	const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0

	const invX = dx === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(dx)
	const invY = dy === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(dy)
	const invZ = dz === 0 ? Number.POSITIVE_INFINITY : 1 / Math.abs(dz)

	let tMaxX =
		stepX === 0
			? Number.POSITIVE_INFINITY
			: (stepX > 0 ? vx + 1 - origin.x : origin.x - vx) * invX
	let tMaxY =
		stepY === 0
			? Number.POSITIVE_INFINITY
			: (stepY > 0 ? vy + 1 - origin.y : origin.y - vy) * invY
	let tMaxZ =
		stepZ === 0
			? Number.POSITIVE_INFINITY
			: (stepZ > 0 ? vz + 1 - origin.z : origin.z - vz) * invZ

	// One voxel per iteration, at most three crossings per block of distance.
	const maxIterations = Math.ceil(maxDistance) * 3 + 8
	for (let i = 0; i < maxIterations; i++) {
		let axis: 0 | 1 | 2
		let distance: number
		if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
			axis = 0
			distance = tMaxX
			vx += stepX
			tMaxX += invX
		} else if (tMaxY <= tMaxZ) {
			axis = 1
			distance = tMaxY
			vy += stepY
			tMaxY += invY
		} else {
			axis = 2
			distance = tMaxZ
			vz += stepZ
			tMaxZ += invZ
		}
		if (!Number.isFinite(distance) || distance > maxDistance) return null
		if (!view.isSolid(vx, vy, vz)) continue
		const positive = (axis === 0 ? stepX : axis === 1 ? stepY : stepZ) > 0
		const normal = normalFor(axis, positive)
		return {
			block: { x: vx, y: vy, z: vz },
			normal: { x: normal.x, y: normal.y, z: normal.z },
			distance,
			face: faceFor(axis, positive),
		}
	}
	return null
}

/** Convenience wrapper using the contract reach. */
export function raycastReach(origin: Vec3f, dir: Vec3f, view: VoxelView, reach: number): RayHit | null {
	return raycastVoxels(origin, dir, reach, view)
}
