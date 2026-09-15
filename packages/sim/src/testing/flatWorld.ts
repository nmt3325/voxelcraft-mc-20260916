/**
 * World fixtures shared by every sim test (physics, light, fluid, mobs).
 *
 * Everything is built with `createSimVoxelWorld`, so chunks outside the filled
 * area stay unloaded on purpose: that is the cheapest way to cover
 * "unloaded chunk" behaviour in pathfinding and light stitching.
 */
import { BLOCK } from '@voxelcraft/core-types'
import type { AABB, BlockId } from '@voxelcraft/core-types'
import { createSimVoxelWorld } from '../shared'
import type { SimVoxelWorld } from '../shared'
import { entityBox } from '../physics/aabb'

export interface FlatWorldOptions {
	/** Y of the lowest air block, i.e. the top surface of the floor. */
	floorTop?: number
	/** Half extent in blocks around the origin that gets a floor. */
	extent?: number
	floorThickness?: number
	block?: BlockId
}

export interface FlatWorld {
	world: SimVoxelWorld
	floorTop: number
	extent: number
}

export function fillRegion(
	world: SimVoxelWorld,
	x0: number,
	y0: number,
	z0: number,
	x1: number,
	y1: number,
	z1: number,
	block: BlockId,
): void {
	const xa = Math.min(x0, x1)
	const xb = Math.max(x0, x1)
	const ya = Math.min(y0, y1)
	const yb = Math.max(y0, y1)
	const za = Math.min(z0, z1)
	const zb = Math.max(z0, z1)
	for (let x = xa; x <= xb; x++) {
		for (let y = ya; y <= yb; y++) {
			for (let z = za; z <= zb; z++) {
				world.setBlock(x, y, z, block)
			}
		}
	}
}

export function createFlatTestWorld(options: FlatWorldOptions = {}): FlatWorld {
	const floorTop = options.floorTop ?? 64
	const extent = options.extent ?? 24
	const thickness = options.floorThickness ?? 2
	const block = options.block ?? BLOCK.STONE
	const world = createSimVoxelWorld()
	fillRegion(world, -extent, floorTop - thickness, -extent, extent, floorTop - 1, extent, block)
	return { world, floorTop, extent }
}

/** Raised platform: solid from `from` up to `top - 1`, so its surface is `top`. */
export function addPlatform(
	world: SimVoxelWorld,
	opts: {
		xFrom: number
		xTo: number
		zFrom: number
		zTo: number
		from: number
		top: number
		block?: BlockId
	},
): void {
	if (opts.top <= opts.from) return
	fillRegion(
		world,
		opts.xFrom,
		opts.from,
		opts.zFrom,
		opts.xTo,
		opts.top - 1,
		opts.zTo,
		opts.block ?? BLOCK.STONE,
	)
}

/** Box for a player sized entity standing with its feet at `y`. */
export function standingBox(x: number, y: number, z: number): AABB {
	return entityBox(x, y, z)
}

export interface TestArena extends FlatWorld {
	/** Platform one block high (surface at floorTop + 1), on the +X side. */
	lowLedge: { xFrom: number; xTo: number; zFrom: number; zTo: number; top: number }
	/** Platform two blocks high (surface at floorTop + 2), on the -X side. */
	highLedge: { xFrom: number; xTo: number; zFrom: number; zTo: number; top: number }
	/** Water column standing on the floor, four blocks deep. */
	waterPool: { xFrom: number; xTo: number; zFrom: number; zTo: number; top: number }
	/** Lava pool standing on the floor, two blocks deep. */
	lavaPool: { xFrom: number; xTo: number; zFrom: number; zTo: number; top: number }
}

/**
 * The shared acceptance arena.
 *
 * Layout, with the floor surface at `floorTop` (64 by default):
 *  - a 1 block ledge at x 4..10, z -4..4, so an entity walking +X from the
 *    origin meets a step it can only clear by jumping (stepHeight is 0.6);
 *  - a 2 block ledge at x -10..-4, which no jump can clear
 *    (jumpVelocity^2 / (2 * gravity) is about 1.1 blocks);
 *  - a water column at z 6..12 for swimming and drag;
 *  - a lava pool at z -12..-6.
 */
export function createTestArena(options: FlatWorldOptions = {}): TestArena {
	const flat = createFlatTestWorld(options)
	const { world, floorTop } = flat
	const lowLedge = { xFrom: 4, xTo: 10, zFrom: -4, zTo: 4, top: floorTop + 1 }
	const highLedge = { xFrom: -10, xTo: -4, zFrom: -4, zTo: 4, top: floorTop + 2 }
	const waterPool = { xFrom: -3, xTo: 3, zFrom: 6, zTo: 12, top: floorTop + 4 }
	const lavaPool = { xFrom: -3, xTo: 3, zFrom: -12, zTo: -6, top: floorTop + 2 }
	addPlatform(world, { ...lowLedge, from: floorTop })
	addPlatform(world, { ...highLedge, from: floorTop })
	fillRegion(
		world,
		waterPool.xFrom,
		floorTop,
		waterPool.zFrom,
		waterPool.xTo,
		waterPool.top - 1,
		waterPool.zTo,
		BLOCK.WATER,
	)
	fillRegion(
		world,
		lavaPool.xFrom,
		floorTop,
		lavaPool.zFrom,
		lavaPool.xTo,
		lavaPool.top - 1,
		lavaPool.zTo,
		BLOCK.LAVA,
	)
	return { ...flat, lowLedge, highLedge, waterPool, lavaPool }
}
