import { BLOCK, FACE, FACE_DIRS, PHYSICS } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { createFlatTestWorld } from '../testing'
import { raycastVoxels } from './raycast'

const EYE = 70.5

describe('raycastVoxels', () => {
	it('hits along +X and reports the NegX face', () => {
		const { world } = createFlatTestWorld()
		world.setBlock(5, 70, 0, BLOCK.STONE)
		const hit = raycastVoxels({ x: 0.5, y: EYE, z: 0.5 }, { x: 1, y: 0, z: 0 }, PHYSICS.reach, world)
		expect(hit).not.toBeNull()
		if (!hit) return
		expect(hit.block).toEqual({ x: 5, y: 70, z: 0 })
		expect(hit.face).toBe(FACE.NegX)
		expect(hit.normal).toEqual({ x: -1, y: 0, z: 0 })
		expect(hit.distance).toBeCloseTo(4.5, 10)
		// face and normal must agree with the canonical order.
		expect(FACE_DIRS[hit.face]).toEqual(hit.normal)
	})

	it('hits along -X and reports the PosX face', () => {
		const { world } = createFlatTestWorld()
		world.setBlock(-3, 70, 0, BLOCK.STONE)
		const hit = raycastVoxels({ x: 0.5, y: EYE, z: 0.5 }, { x: -1, y: 0, z: 0 }, PHYSICS.reach, world)
		expect(hit).not.toBeNull()
		if (!hit) return
		expect(hit.block).toEqual({ x: -3, y: 70, z: 0 })
		expect(hit.face).toBe(FACE.PosX)
		expect(hit.normal).toEqual({ x: 1, y: 0, z: 0 })
		expect(FACE_DIRS[hit.face]).toEqual(hit.normal)
	})

	it('handles zero direction components and hits the floor from above', () => {
		const { world, floorTop } = createFlatTestWorld()
		const hit = raycastVoxels({ x: 0.5, y: floorTop + 6, z: 0.5 }, { x: 0, y: -1, z: 0 }, 8, world)
		expect(hit).not.toBeNull()
		if (!hit) return
		expect(hit.block).toEqual({ x: 0, y: floorTop - 1, z: 0 })
		expect(hit.face).toBe(FACE.PosY)
		expect(hit.normal).toEqual({ x: 0, y: 1, z: 0 })
		expect(hit.distance).toBeCloseTo(6, 10)
		expect(FACE_DIRS[hit.face]).toEqual(hit.normal)
	})

	it('respects the reach, including exactly on the boundary', () => {
		const { world } = createFlatTestWorld()
		world.setBlock(5, 70, 0, BLOCK.STONE)
		// Origin on a voxel boundary: the block face is exactly `reach` away.
		const origin = { x: 0, y: EYE, z: 0.5 }
		const dir = { x: 1, y: 0, z: 0 }
		const atLimit = raycastVoxels(origin, dir, PHYSICS.reach, world)
		expect(atLimit).not.toBeNull()
		expect(atLimit?.distance).toBeCloseTo(PHYSICS.reach, 10)
		expect(raycastVoxels(origin, dir, PHYSICS.reach - 0.001, world)).toBeNull()
		const outOfReach = createFlatTestWorld()
		outOfReach.world.setBlock(6, 70, 0, BLOCK.STONE)
		expect(
			raycastVoxels({ x: 0.5, y: EYE, z: 0.5 }, dir, PHYSICS.reach, outOfReach.world),
		).toBeNull()
	})

	it('walks diagonals and keeps the entry face consistent', () => {
		const { world } = createFlatTestWorld()
		world.setBlock(3, 70, 3, BLOCK.STONE)
		const hit = raycastVoxels({ x: 0.5, y: EYE, z: 0.5 }, { x: 1, y: 0, z: 1 }, PHYSICS.reach, world)
		expect(hit).not.toBeNull()
		if (!hit) return
		expect(hit.block).toEqual({ x: 3, y: 70, z: 3 })
		expect(FACE_DIRS[hit.face]).toEqual(hit.normal)
		expect(hit.distance).toBeLessThanOrEqual(PHYSICS.reach)
		expect(hit.distance).toBeGreaterThan(0)
	})

	it('returns null for an empty world and for a zero direction', () => {
		const { world } = createFlatTestWorld()
		expect(
			raycastVoxels({ x: 0.5, y: 200.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, PHYSICS.reach, world),
		).toBeNull()
		expect(
			raycastVoxels({ x: 0.5, y: 200.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, PHYSICS.reach, world),
		).toBeNull()
	})

	it('reports distance 0 when the origin is already inside a solid', () => {
		const { world, floorTop } = createFlatTestWorld()
		const hit = raycastVoxels(
			{ x: 0.5, y: floorTop - 0.5, z: 0.5 },
			{ x: 1, y: 0, z: 0 },
			PHYSICS.reach,
			world,
		)
		expect(hit).not.toBeNull()
		if (!hit) return
		expect(hit.distance).toBe(0)
		expect(hit.block).toEqual({ x: 0, y: floorTop - 1, z: 0 })
		expect(hit.face).toBe(FACE.NegX)
		expect(FACE_DIRS[hit.face]).toEqual(hit.normal)
	})
})
