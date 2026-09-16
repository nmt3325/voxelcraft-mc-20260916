import { PHYSICS, makeRng } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import { SIM_DT } from '../schedule'
import { createFlatTestWorld, createTestArena } from '../testing'
import { entityBox } from './aabb'
import { DEFAULT_MOVE_OPTIONS, isBoxClearOfSolids, isOnGround, moveEntity, subStepCount } from './move'

describe('moveEntity', () => {
	it('never penetrates a solid block over 1000 ticks of random input', () => {
		const { world, floorTop } = createTestArena()
		const rng = makeRng(0xc0ffee, 7)
		let box = entityBox(0, floorTop + 4, 0)
		for (let tick = 0; tick < 1000; tick++) {
			const vx = (rng.next01() * 2 - 1) * PHYSICS.sprintSpeed * 4
			const vy = (rng.next01() * 2 - 1) * PHYSICS.terminalVelocity
			const vz = (rng.next01() * 2 - 1) * PHYSICS.sprintSpeed * 4
			const result = moveEntity(
				box,
				{ x: vx * SIM_DT, y: vy * SIM_DT, z: vz * SIM_DT },
				world,
				DEFAULT_MOVE_OPTIONS,
			)
			box = result.box
			expect(isBoxClearOfSolids(box, world)).toBe(true)
			// The floor is two blocks thick, so nothing may ever get below it.
			expect(box.minY).toBeGreaterThan(floorTop - 1)
			// Stay inside the part of the world that actually has a floor.
			if (Math.abs(box.minX) > 14 || Math.abs(box.minZ) > 14) {
				box = entityBox(0, floorTop + 4, 0)
			}
		}
	})

	it('does not tunnel through the floor at terminal velocity', () => {
		const { world, floorTop } = createFlatTestWorld()
		const perTick = PHYSICS.terminalVelocity * SIM_DT
		expect(perTick).toBeGreaterThan(PHYSICS.maxSubStepBlocks)
		let box = entityBox(0, floorTop + 60, 0)
		for (let tick = 0; tick < 100; tick++) {
			box = moveEntity(box, { x: 0, y: -perTick, z: 0 }, world, DEFAULT_MOVE_OPTIONS).box
			expect(isBoxClearOfSolids(box, world)).toBe(true)
		}
		expect(box.minY).toBeGreaterThanOrEqual(floorTop)
		expect(box.minY).toBeLessThan(floorTop + 0.01)
		expect(isOnGround(box, world)).toBe(true)
	})

	it('keeps every sub step inside the tunnelling bound', () => {
		const perTick = PHYSICS.terminalVelocity * SIM_DT
		const steps = subStepCount(0, -perTick, 0, PHYSICS.maxSubStepBlocks)
		expect(perTick / steps).toBeLessThanOrEqual(PHYSICS.maxSubStepBlocks)
		expect(subStepCount(0, 0, 0, PHYSICS.maxSubStepBlocks)).toBe(1)
		expect(subStepCount(0.1, 0.1, 0.1, PHYSICS.maxSubStepBlocks)).toBe(1)
	})

	it('comes to rest on the floor without oscillating', () => {
		const { world, floorTop } = createFlatTestWorld()
		let box = entityBox(0, floorTop + 0.5, 0)
		let vy = 0
		const heights: number[] = []
		for (let tick = 0; tick < 60; tick++) {
			vy -= PHYSICS.gravity * SIM_DT
			const result = moveEntity(box, { x: 0, y: vy * SIM_DT, z: 0 }, world, DEFAULT_MOVE_OPTIONS)
			if (result.hitY) vy = 0
			box = result.box
			heights.push(box.minY)
		}
		const tail = heights.slice(40)
		for (const height of tail) expect(height).toBe(tail[0])
		expect(tail[0]).toBeGreaterThanOrEqual(floorTop)
		expect(tail[0]).toBeLessThan(floorTop + 0.01)
	})

	it('resolves axes in the order Y, X, Z', () => {
		// A move into an inside corner: Y first lands the box, then X is blocked by
		// the wall while Z still slides along it.
		const { world, floorTop } = createFlatTestWorld()
		world.setBlock(1, floorTop, 0, 1)
		const box = entityBox(0, floorTop + 0.2, 0)
		const result = moveEntity(box, { x: 0.9, y: -0.3, z: 0.3 }, world, DEFAULT_MOVE_OPTIONS)
		expect(result.hitY).toBe(true)
		expect(result.hitX).toBe(true)
		expect(result.hitZ).toBe(false)
		expect(result.box.minY).toBeCloseTo(floorTop, 2)
		expect(result.box.maxX).toBeLessThan(1)
		expect(result.dz).toBeCloseTo(0.3, 10)
		expect(isBoxClearOfSolids(result.box, world)).toBe(true)
	})

	/**
	 * Voxels are unit cubes, so the only ledge geometry that exists is one block
	 * high. "A 0.5 ledge is climbable and a 1.5 one is not" is therefore tested
	 * as the equivalent statement about the step budget: auto-stepping happens
	 * exactly when stepHeight is at least the ledge height. The contract's 0.6
	 * step height against a 1.0 ledge is the "needs a jump" case, covered in the
	 * locomotion tests.
	 */
	describe('step up', () => {
		it('climbs a ledge no higher than the step budget', () => {
			const arena = createTestArena()
			const box = entityBox(3.5, arena.floorTop, 0)
			const result = moveEntity(
				box,
				{ x: 0.4, y: 0, z: 0 },
				arena.world,
				{ ...DEFAULT_MOVE_OPTIONS, stepHeight: 1.2 },
			)
			expect(result.steppedUp).toBe(true)
			expect(result.box.minY).toBeGreaterThanOrEqual(arena.lowLedge.top)
			expect(result.box.minY).toBeLessThan(arena.lowLedge.top + 0.01)
			expect(result.box.maxX).toBeGreaterThan(arena.lowLedge.xFrom)
			expect(isBoxClearOfSolids(result.box, arena.world)).toBe(true)
		})

		it('is blocked by a ledge higher than the step budget', () => {
			const arena = createTestArena()
			const box = entityBox(3.5, arena.floorTop, 0)
			const result = moveEntity(box, { x: 0.4, y: 0, z: 0 }, arena.world, DEFAULT_MOVE_OPTIONS)
			expect(result.steppedUp).toBe(false)
			expect(result.hitX).toBe(true)
			expect(result.box.minY).toBeCloseTo(arena.floorTop, 6)
			expect(result.box.maxX).toBeLessThan(arena.lowLedge.xFrom)
			expect(isBoxClearOfSolids(result.box, arena.world)).toBe(true)
		})
	})

	it('reports the fluid the box is standing in', () => {
		const arena = createTestArena()
		const inWater = moveEntity(
			entityBox(0, arena.floorTop + 1, 9),
			{ x: 0, y: -0.05, z: 0 },
			arena.world,
			DEFAULT_MOVE_OPTIONS,
		)
		expect(inWater.inWater).toBe(true)
		expect(inWater.inLava).toBe(false)

		const inLava = moveEntity(
			entityBox(0, arena.floorTop, -9),
			{ x: 0, y: -0.05, z: 0 },
			arena.world,
			DEFAULT_MOVE_OPTIONS,
		)
		expect(inLava.inLava).toBe(true)
		expect(inLava.inWater).toBe(false)
	})
})

describe('isOnGround', () => {
	it('is false while airborne and true while resting', () => {
		const { world, floorTop } = createFlatTestWorld()
		expect(isOnGround(entityBox(0, floorTop + 0.5, 0), world)).toBe(false)
		expect(isOnGround(entityBox(0, floorTop, 0), world)).toBe(true)
		expect(isOnGround(entityBox(0, floorTop + PHYSICS.epsilon, 0), world)).toBe(true)
	})
})
