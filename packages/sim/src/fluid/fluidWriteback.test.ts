/**
 * The fluid engine owns its block ids (review R-04).
 *
 * Spreading used to happen in the fluid byte only, which left the block array
 * on AIR: the flowing cleanup branch was unreachable, flowing lava emitted no
 * light and a mesher could not tell a source from a flow. These tests pin the
 * writeback, the AIR restore and the light a flow now emits.
 */
import { describe, expect, it } from 'vitest'
import { BLOCK, EVENT, FLUID, MAX_LIGHT } from '@voxelcraft/core-types'
import type { BlockId } from '@voxelcraft/core-types'
import { lightCreateEngine } from '../light/lightEngine'
import { lightPropsOf } from '../shared/blockProps'
import { createEventBus } from '../shared/events'
import type { SimVoxelWorld } from '../shared/voxelWorld'
import { createFlatTestWorld } from '../testing/flatWorld'
import { fluidCreateEngine } from './fluidEngine'

const FLOOR_TOP = 64
/** A source spreads at most `FLUID_MAX_LEVEL` cells, so this floor contains it. */
const EXTENT = 8
/** Seeding the four chunks around the origin is slow but not pathological. */
const SLOW = 30000

const countBlocks = (world: SimVoxelWorld, id: BlockId): number => {
	let count = 0
	for (let x = -EXTENT; x <= EXTENT; x++) {
		for (let z = -EXTENT; z <= EXTENT; z++) {
			for (let y = FLOOR_TOP; y <= FLOOR_TOP + 2; y++) {
				if (world.getBlock(x, y, z) === id) count++
			}
		}
	}
	return count
}

const spread = (source: BlockId, build?: (world: SimVoxelWorld) => void) => {
	const flat = createFlatTestWorld({ floorTop: FLOOR_TOP, extent: EXTENT })
	if (build) build(flat.world)
	const engine = fluidCreateEngine({ world: flat.world })
	flat.world.setBlock(0, FLOOR_TOP, 0, source)
	engine.onNeighborChanged(0, FLOOR_TOP, 0)
	engine.settle()
	return { world: flat.world, engine }
}

describe('fluid block writeback', () => {
	it('writes WATER_FLOWING where water spreads and keeps the source id', () => {
		const { world } = spread(BLOCK.WATER)
		expect(world.getBlock(0, FLOOR_TOP, 0)).toBe(BLOCK.WATER)
		expect(world.getBlock(1, FLOOR_TOP, 0)).toBe(BLOCK.WATER_FLOWING)
		expect(world.getBlock(0, FLOOR_TOP, 2)).toBe(BLOCK.WATER_FLOWING)
		const state = world.fluidStateAt(1, FLOOR_TOP, 0)
		expect(state.kind).toBe(FLUID.Water)
		expect(state.level).toBeGreaterThan(0)
		expect(countBlocks(world, BLOCK.WATER_FLOWING)).toBeGreaterThan(4)
		// The layer above the flow stays untouched.
		expect(world.getBlock(1, FLOOR_TOP + 1, 0)).toBe(BLOCK.AIR)
	})

	it('restores AIR everywhere the fluid drains', () => {
		const { world, engine } = spread(BLOCK.WATER)
		expect(countBlocks(world, BLOCK.WATER_FLOWING)).toBeGreaterThan(0)
		world.setBlock(0, FLOOR_TOP, 0, BLOCK.AIR)
		engine.onNeighborChanged(0, FLOOR_TOP, 0)
		engine.settle(1000)
		expect(countBlocks(world, BLOCK.WATER_FLOWING)).toBe(0)
		expect(world.getBlock(1, FLOOR_TOP, 0)).toBe(BLOCK.AIR)
		expect(world.fluidStateAt(1, FLOOR_TOP, 0).kind).toBe(FLUID.None)
	})

	it('leaves another replaceable block in place and only fills its fluid byte', () => {
		const { world } = spread(BLOCK.WATER, (w) => {
			w.setBlock(2, FLOOR_TOP, 0, BLOCK.TALL_GRASS)
		})
		expect(world.getBlock(2, FLOOR_TOP, 0)).toBe(BLOCK.TALL_GRASS)
		expect(world.fluidStateAt(2, FLOOR_TOP, 0).kind).toBe(FLUID.Water)
	})

	it(
		'makes flowing lava a light source with the same emission as source lava',
		() => {
			const flat = createFlatTestWorld({ floorTop: FLOOR_TOP, extent: EXTENT })
			const world = flat.world
			const events = createEventBus()
			const light = lightCreateEngine({ world, events })
			light.seedAll(2)
			const engine = fluidCreateEngine({ world, events })
			events.on(EVENT.BlockChanged, (event) => {
				light.onBlockChanged(
					event.x,
					event.y,
					event.z,
					lightPropsOf(event.before),
					lightPropsOf(event.after),
				)
			})

			const before = world.getBlock(0, FLOOR_TOP, 0)
			world.setBlock(0, FLOOR_TOP, 0, BLOCK.LAVA)
			light.onBlockChanged(0, FLOOR_TOP, 0, lightPropsOf(before), lightPropsOf(BLOCK.LAVA))
			engine.onNeighborChanged(0, FLOOR_TOP, 0)
			engine.settle()
			light.drain()

			expect(lightPropsOf(BLOCK.LAVA_FLOWING).emission).toBe(lightPropsOf(BLOCK.LAVA).emission)
			expect(world.getBlock(2, FLOOR_TOP, 0)).toBe(BLOCK.LAVA_FLOWING)
			expect(light.sample(2, FLOOR_TOP, 0).block).toBe(MAX_LIGHT)
			expect(light.sample(2, FLOOR_TOP + 1, 0).block).toBeGreaterThan(0)
			expect(light.sample(0, FLOOR_TOP, 0).block).toBe(MAX_LIGHT)
		},
		SLOW,
	)
})
