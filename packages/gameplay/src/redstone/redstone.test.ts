import { describe, expect, it } from 'vitest'
import { BLOCK, FACE, REDSTONE } from '@voxelcraft/core-types'
import { isDoorOpen } from '../blockEntities/door'
import { createMemoryWorld, type MemoryWorld } from '../support/memoryWorld'
import { createRedstoneEngine } from './engine'
import { clampPower, isConsumer, isImmovable, isSource, isWire } from './roles'

const BUDGET = REDSTONE.maxUpdatesPerTick

function wireRun(world: MemoryWorld, length: number, y = 1, z = 0): void {
	for (let x = 0; x < length; x++) world.setBlock(x, y, z, BLOCK.REDSTONE_WIRE)
}

describe('redstone wire propagation', () => {
	it('loses one power per wire and dies after 15 blocks', () => {
		const world = createMemoryWorld()
		world.setBlock(-1, 1, 0, BLOCK.LEVER)
		wireRun(world, 20)
		const engine = createRedstoneEngine(world)
		engine.setSourcePower(-1, 1, 0, REDSTONE.maxPower)
		expect(engine.tick(1, BUDGET)).toBeGreaterThan(0)

		expect(engine.powerAt(-1, 1, 0)).toBe(REDSTONE.maxPower)
		for (let x = 0; x < REDSTONE.maxPower; x++) {
			expect(engine.powerAt(x, 1, 0)).toBe(REDSTONE.maxPower - x)
		}
		expect(engine.powerAt(REDSTONE.maxPower, 1, 0)).toBe(0)
		expect(engine.powerAt(19, 1, 0)).toBe(0)
		expect(engine.isPowered(0, 2, 0)).toBe(true)
		expect(engine.isPowered(0, 5, 0)).toBe(false)
	})

	it('drops the whole field when the lever goes off', () => {
		const world = createMemoryWorld()
		world.setBlock(-1, 1, 0, BLOCK.LEVER)
		wireRun(world, 5)
		const engine = createRedstoneEngine(world)
		engine.setSourcePower(-1, 1, 0, REDSTONE.maxPower)
		engine.tick(1, BUDGET)
		expect(engine.powerAt(4, 1, 0)).toBe(11)

		engine.setSourcePower(-1, 1, 0, 0)
		expect(engine.tick(2, BUDGET)).toBeGreaterThan(0)
		for (let x = 0; x < 5; x++) expect(engine.powerAt(x, 1, 0)).toBe(0)
		expect(engine.tick(3, BUDGET)).toBe(0)
	})

	it('releases a button after REDSTONE.buttonTicks', () => {
		const world = createMemoryWorld()
		world.setBlock(-1, 1, 0, BLOCK.BUTTON)
		wireRun(world, 2)
		const engine = createRedstoneEngine(world)
		engine.setSourcePower(-1, 1, 0, REDSTONE.maxPower)

		engine.tick(0, BUDGET)
		expect(engine.powerAt(0, 1, 0)).toBe(REDSTONE.maxPower)
		engine.tick(REDSTONE.buttonTicks - 1, BUDGET)
		expect(engine.powerAt(0, 1, 0)).toBe(REDSTONE.maxPower)

		engine.tick(REDSTONE.buttonTicks, BUDGET)
		expect(engine.powerAt(0, 1, 0)).toBe(0)
		expect(engine.pendingCount).toBe(0)
		expect(engine.tick(REDSTONE.buttonTicks + 1, BUDGET)).toBe(0)
	})

	it('keeps a pressure plate powered until it is released', () => {
		const world = createMemoryWorld()
		world.setBlock(-1, 1, 0, BLOCK.PRESSURE_PLATE)
		wireRun(world, 3)
		const engine = createRedstoneEngine(world)
		engine.setSourcePower(-1, 1, 0, REDSTONE.maxPower)
		engine.tick(1, BUDGET)
		expect(engine.powerAt(2, 1, 0)).toBe(13)

		// Plates have no auto-release, unlike buttons.
		engine.tick(REDSTONE.buttonTicks * 5, BUDGET)
		expect(engine.powerAt(2, 1, 0)).toBe(13)

		engine.setSourcePower(-1, 1, 0, 0)
		engine.tick(REDSTONE.buttonTicks * 5 + 1, BUDGET)
		expect(engine.powerAt(2, 1, 0)).toBe(0)
	})

	it('forgets a source whose block was mined', () => {
		const world = createMemoryWorld()
		world.setBlock(-1, 1, 0, BLOCK.LEVER)
		wireRun(world, 2)
		const engine = createRedstoneEngine(world)
		engine.setSourcePower(-1, 1, 0, REDSTONE.maxPower)
		engine.tick(1, BUDGET)
		expect(engine.powerAt(0, 1, 0)).toBe(REDSTONE.maxPower)

		world.setBlock(-1, 1, 0, BLOCK.AIR)
		engine.onBlockChanged(-1, 1, 0)
		engine.tick(2, BUDGET)
		expect(engine.powerAt(0, 1, 0)).toBe(0)
	})
})

describe('redstone consumers', () => {
	it('opens and closes a door through the shared door helper', () => {
		const world = createMemoryWorld()
		world.setBlock(0, 1, 0, BLOCK.LEVER)
		world.setBlock(1, 1, 0, BLOCK.REDSTONE_WIRE)
		world.setBlock(2, 1, 0, BLOCK.DOOR_LOWER)
		world.setBlock(2, 2, 0, BLOCK.DOOR_UPPER)
		const engine = createRedstoneEngine(world)
		expect(isDoorOpen(world, 2, 1, 0)).toBe(false)

		engine.setSourcePower(0, 1, 0, REDSTONE.maxPower)
		engine.tick(1, BUDGET)
		expect(isDoorOpen(world, 2, 1, 0)).toBe(true)
		expect(isDoorOpen(world, 2, 2, 0)).toBe(true)

		engine.setSourcePower(0, 1, 0, 0)
		engine.tick(2, BUDGET)
		expect(isDoorOpen(world, 2, 1, 0)).toBe(false)
	})

	it('lights a redstone lamp and puts it out again', () => {
		const world = createMemoryWorld()
		world.setBlock(0, 1, 0, BLOCK.LEVER)
		world.setBlock(1, 1, 0, BLOCK.REDSTONE_WIRE)
		world.setBlock(2, 1, 0, BLOCK.REDSTONE_LAMP)
		const engine = createRedstoneEngine(world)

		engine.setSourcePower(0, 1, 0, REDSTONE.maxPower)
		engine.tick(1, BUDGET)
		expect(world.getBlock(2, 1, 0)).toBe(BLOCK.REDSTONE_LAMP_LIT)

		engine.setSourcePower(0, 1, 0, 0)
		engine.tick(2, BUDGET)
		expect(world.getBlock(2, 1, 0)).toBe(BLOCK.REDSTONE_LAMP)
	})

	it('extends a piston after REDSTONE.pistonMoveTicks and pushes a block', () => {
		const world = createMemoryWorld()
		world.setBlock(0, 1, 0, BLOCK.PISTON)
		world.setBlock(0, 2, 0, BLOCK.STONE)
		world.setBlock(1, 1, 0, BLOCK.REDSTONE_WIRE)
		world.setBlock(2, 1, 0, BLOCK.LEVER)
		const engine = createRedstoneEngine(world, { defaultPistonFacing: FACE.PosY })

		engine.setSourcePower(2, 1, 0, REDSTONE.maxPower)
		engine.tick(0, BUDGET)
		// Scheduled, not moved yet.
		expect(world.getBlock(0, 2, 0)).toBe(BLOCK.STONE)

		engine.tick(REDSTONE.pistonMoveTicks, BUDGET)
		expect(world.getBlock(0, 2, 0)).toBe(BLOCK.PISTON_HEAD)
		expect(world.getBlock(0, 3, 0)).toBe(BLOCK.STONE)

		engine.setSourcePower(2, 1, 0, 0)
		engine.tick(REDSTONE.pistonMoveTicks + 1, BUDGET)
		engine.tick(REDSTONE.pistonMoveTicks * 2 + 1, BUDGET)
		expect(world.getBlock(0, 2, 0)).toBe(BLOCK.AIR)
		// Non-sticky pistons leave the pushed block behind.
		expect(world.getBlock(0, 3, 0)).toBe(BLOCK.STONE)
	})

	it('refuses to push an immovable block', () => {
		const world = createMemoryWorld()
		world.setBlock(0, 1, 0, BLOCK.PISTON)
		world.setBlock(0, 2, 0, BLOCK.CHEST)
		world.setBlock(1, 1, 0, BLOCK.REDSTONE_WIRE)
		world.setBlock(2, 1, 0, BLOCK.LEVER)
		const engine = createRedstoneEngine(world, { defaultPistonFacing: FACE.PosY })
		engine.setSourcePower(2, 1, 0, REDSTONE.maxPower)
		engine.tick(0, BUDGET)
		engine.tick(REDSTONE.pistonMoveTicks, BUDGET)
		expect(world.getBlock(0, 2, 0)).toBe(BLOCK.CHEST)
		expect(world.getBlock(0, 3, 0)).toBe(BLOCK.AIR)
	})
})

describe('redstone convergence', () => {
	it('settles a wire loop and then reports no work', () => {
		const world = createMemoryWorld()
		// A closed ring: every cell has two wire neighbours, which is what makes
		// a naive neighbour-push loop oscillate forever.
		for (let n = 0; n <= 8; n++) {
			world.setBlock(n, 1, 0, BLOCK.REDSTONE_WIRE)
			world.setBlock(n, 1, 8, BLOCK.REDSTONE_WIRE)
			world.setBlock(0, 1, n, BLOCK.REDSTONE_WIRE)
			world.setBlock(8, 1, n, BLOCK.REDSTONE_WIRE)
		}
		world.setBlock(-1, 1, 0, BLOCK.LEVER)
		const engine = createRedstoneEngine(world)
		engine.setSourcePower(-1, 1, 0, REDSTONE.maxPower)

		let tick = 0
		let updates = engine.tick(tick, BUDGET)
		expect(updates).toBeGreaterThan(0)
		while (updates > 0 && tick < 50) {
			tick += 1
			updates = engine.tick(tick, BUDGET)
		}
		expect(updates).toBe(0)
		expect(tick).toBeLessThan(5)
		expect(engine.powerAt(0, 1, 0)).toBe(REDSTONE.maxPower)
		expect(engine.powerAt(1, 1, 0)).toBe(REDSTONE.maxPower - 1)
		// The far corner is 16 wire steps away along both arms of the ring.
		expect(engine.powerAt(8, 1, 8)).toBe(0)
	})

	it('honours the update budget and finishes on a later tick', () => {
		const world = createMemoryWorld()
		world.setBlock(-1, 1, 0, BLOCK.LEVER)
		wireRun(world, 15)
		const engine = createRedstoneEngine(world)
		engine.setSourcePower(-1, 1, 0, REDSTONE.maxPower)

		engine.tick(0, 1)
		expect(engine.powerAt(14, 1, 0)).toBe(0)
		engine.tick(1, BUDGET)
		expect(engine.powerAt(14, 1, 0)).toBe(1)
		expect(engine.tick(2, BUDGET)).toBe(0)
	})
})

describe('redstone roles', () => {
	it('classifies blocks from the registry', () => {
		expect(isWire(BLOCK.REDSTONE_WIRE)).toBe(true)
		expect(isWire(BLOCK.STONE)).toBe(false)
		expect(isSource(BLOCK.LEVER)).toBe(true)
		expect(isSource(BLOCK.BUTTON)).toBe(true)
		expect(isSource(BLOCK.PRESSURE_PLATE)).toBe(true)
		expect(isSource(BLOCK.REDSTONE_WIRE)).toBe(false)
		expect(isConsumer(BLOCK.DOOR_LOWER)).toBe(true)
		expect(isConsumer(BLOCK.REDSTONE_LAMP)).toBe(true)
		expect(isConsumer(BLOCK.PISTON)).toBe(true)
		expect(isConsumer(BLOCK.STONE)).toBe(false)
	})

	it('clamps power and protects immovable blocks', () => {
		expect(clampPower(99)).toBe(REDSTONE.maxPower)
		expect(clampPower(-4)).toBe(0)
		expect(clampPower(Number.NaN)).toBe(0)
		expect(clampPower(7)).toBe(7)
		expect(isImmovable(BLOCK.PISTON)).toBe(true)
		expect(isImmovable(BLOCK.PISTON_HEAD)).toBe(true)
		expect(isImmovable(BLOCK.CHEST)).toBe(true)
		expect(isImmovable(BLOCK.STONE)).toBe(false)
	})
})
