/**
 * Fluid acceptance tests: purity of `computeFluidAt`, levels 0..7, falling
 * columns, water/lava interaction, convergence without oscillation and the per
 * tick cell budget.
 */
import { describe, expect, it } from 'vitest'
import { BLOCK, FLUID, FLUID_MAX_LEVEL, PERF, packFluid } from '@voxelcraft/core-types'
import type { SimVoxelWorld } from '../shared/voxelWorld'
import { createFlatTestWorld } from '../testing/flatWorld'
import { fluidCreateEngine } from './fluidEngine'

type Engine = ReturnType<typeof fluidCreateEngine>

const FLOOR_TOP = 64

const build = (
	setup: (world: SimVoxelWorld) => void,
): { world: SimVoxelWorld; engine: Engine } => {
	const flat = createFlatTestWorld({ floorTop: FLOOR_TOP, extent: 16 })
	setup(flat.world)
	const engine = fluidCreateEngine({ world: flat.world })
	engine.scheduleAll()
	return { world: flat.world, engine }
}

const waterSource = (world: SimVoxelWorld): void => {
	world.setBlock(0, FLOOR_TOP, 0, BLOCK.WATER)
}

describe('computeFluidAt', () => {
	it('is a pure function of the neighbourhood', () => {
		const { world, engine } = build(waterSource)
		const before = world.hash()
		const first = engine.computeFluidAt(1, FLOOR_TOP, 0)
		const second = engine.computeFluidAt(1, FLOOR_TOP, 0)
		expect(first).toEqual(second)
		expect(first).not.toBe(second)
		expect(world.hash()).toBe(before)
	})

	it('reports a source block as level 0', () => {
		const { engine } = build(waterSource)
		expect(engine.computeFluidAt(0, FLOOR_TOP, 0)).toEqual({
			kind: FLUID.Water,
			level: 0,
			falling: false,
		})
	})
})

describe('water spreading', () => {
	it('numbers the levels 0..7 and stops after the last step', () => {
		const { world, engine } = build(waterSource)
		engine.settle()
		expect(engine.pending).toBe(0)
		for (let distance = 1; distance <= FLUID_MAX_LEVEL; distance++) {
			const state = world.fluidStateAt(distance, FLOOR_TOP, 0)
			expect(state.kind).toBe(FLUID.Water)
			expect(state.level).toBe(distance)
		}
		expect(world.fluidStateAt(FLUID_MAX_LEVEL + 1, FLOOR_TOP, 0).kind).toBe(FLUID.None)
		for (let x = -12; x <= 12; x++) {
			for (let z = -12; z <= 12; z++) {
				expect(world.fluidStateAt(x, FLOOR_TOP, z).level).toBeLessThanOrEqual(FLUID_MAX_LEVEL)
			}
		}
	})

	it('does not oscillate once settled', () => {
		const { world, engine } = build(waterSource)
		engine.settle()
		const settled = world.hash()
		let processed = 0
		for (let at = 1000; at < 1100; at++) processed += engine.tick(at, PERF.fluidCellsPerTick)
		expect(processed).toBe(0)
		expect(world.hash()).toBe(settled)
	})

	it('drains completely when the source is removed', () => {
		const { world, engine } = build(waterSource)
		engine.settle()
		expect(world.fluidStateAt(3, FLOOR_TOP, 0).kind).toBe(FLUID.Water)
		world.setBlock(0, FLOOR_TOP, 0, BLOCK.AIR)
		world.setFluid(0, FLOOR_TOP, 0, 0)
		engine.onNeighborChanged(0, FLOOR_TOP, 0)
		engine.settle(1000)
		for (let x = -12; x <= 12; x++) {
			for (let z = -12; z <= 12; z++) {
				expect(world.fluidStateAt(x, FLOOR_TOP, z).kind).toBe(FLUID.None)
			}
		}
	})

	it('is deterministic for the same setup', () => {
		const a = build(waterSource)
		const b = build(waterSource)
		a.engine.settle()
		b.engine.settle()
		expect(a.world.hash()).toBe(b.world.hash())
	})

	it('reaches the same state with a tiny budget, only slower', () => {
		const fast = build(waterSource)
		fast.engine.settle()
		const slow = build(waterSource)
		slow.engine.settle(0, 40, 1)
		expect(slow.engine.pending).toBeGreaterThan(0)
		slow.engine.settle(1000)
		expect(slow.world.hash()).toBe(fast.world.hash())
	})
})

describe('falling water', () => {
	it('pours straight down a hole instead of spreading sideways', () => {
		const { world, engine } = build((w) => {
			// A hole straight through the two floor layers, under the source.
			w.setBlock(4, FLOOR_TOP - 1, 4, BLOCK.AIR)
			w.setBlock(4, FLOOR_TOP - 2, 4, BLOCK.AIR)
			w.setBlock(4, FLOOR_TOP, 4, BLOCK.WATER)
		})
		engine.settle()
		expect(world.fluidStateAt(4, FLOOR_TOP - 1, 4).kind).toBe(FLUID.Water)
		expect(world.fluidStateAt(4, FLOOR_TOP - 1, 4).falling).toBe(true)
		expect(world.fluidStateAt(4, FLOOR_TOP - 2, 4).falling).toBe(true)
		// A voxel that can pour downwards never spreads sideways.
		expect(world.fluidStateAt(5, FLOOR_TOP, 4).kind).toBe(FLUID.None)
		// The column reaches the bottom of the world and spreads there.
		expect(world.fluidStateAt(4, 0, 4).kind).toBe(FLUID.Water)
		expect(world.fluidStateAt(5, 0, 4).level).toBe(1)
	})
})

describe('water and lava', () => {
	it('turns a touched lava source into obsidian', () => {
		const { world, engine } = build((w) => {
			w.setBlock(0, FLOOR_TOP, 0, BLOCK.LAVA)
			w.setBlock(1, FLOOR_TOP, 0, BLOCK.WATER)
		})
		engine.settle()
		expect(world.getBlock(0, FLOOR_TOP, 0)).toBe(BLOCK.OBSIDIAN)
		expect(world.fluidStateAt(0, FLOOR_TOP, 0).kind).toBe(FLUID.None)
	})

	it('turns flowing lava into cobblestone', () => {
		const { world, engine } = build(waterSource)
		world.setFluid(1, FLOOR_TOP, 0, packFluid({ kind: FLUID.Lava, level: 3, falling: false }))
		expect(engine.interactionAt(1, FLOOR_TOP, 0)).toBe(BLOCK.COBBLESTONE)
		engine.onNeighborChanged(1, FLOOR_TOP, 0)
		engine.settle()
		expect(world.getBlock(1, FLOOR_TOP, 0)).toBe(BLOCK.COBBLESTONE)
	})

	it('leaves lava alone when no water touches it', () => {
		const { world, engine } = build((w) => {
			w.setBlock(0, FLOOR_TOP, 0, BLOCK.LAVA)
		})
		expect(engine.interactionAt(0, FLOOR_TOP, 0)).toBe(null)
		engine.settle()
		expect(world.getBlock(0, FLOOR_TOP, 0)).toBe(BLOCK.LAVA)
		expect(world.fluidStateAt(1, FLOOR_TOP, 0).kind).toBe(FLUID.Lava)
	})
})
