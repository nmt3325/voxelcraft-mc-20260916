/**
 * Light propagation acceptance tests.
 *
 * Covers the four required patterns (placement, removal, corner propagation and
 * the cross chunk seam) plus the invariant that a differential update always
 * ends up identical to a full recompute.
 *
 * The fixtures are deliberately tiny: seeding a chunk walks all 65536 of its
 * voxels, so every world here spans just the four chunks around the origin,
 * which puts the chunk seams at x = 0 and z = 0.
 */
import { describe, expect, it } from 'vitest'
import { BLOCK, MAX_LIGHT } from '@voxelcraft/core-types'
import type { BlockId } from '@voxelcraft/core-types'
import { lightPropsOf } from '../shared/blockProps'
import type { SimVoxelWorld } from '../shared/voxelWorld'
import { createFlatTestWorld, fillRegion } from '../testing/flatWorld'
import { lightCreateEngine } from './lightEngine'

type Engine = ReturnType<typeof lightCreateEngine>

interface Region {
	x0: number
	x1: number
	y0: number
	y1: number
	z0: number
	z1: number
}

const FLOOR_TOP = 64
const EXTENT = 6
/** Seeding four chunks twice per test is slow but still far from pathological. */
const SLOW = 30000

const OPEN: Region = { x0: -6, x1: 6, y0: FLOOR_TOP - 1, y1: FLOOR_TOP + 5, z0: -6, z1: 6 }
const ROOF = { xFrom: -2, xTo: 2, zFrom: -2, zTo: 2, y: FLOOR_TOP + 3 }
/** Last voxel of chunk (-1, 0), so its light has to cross the x = 0 seam. */
const LAMP = { x: -1, y: FLOOR_TOP + 1, z: 0 }

const seeded = (
	build?: (world: SimVoxelWorld) => void,
): { world: SimVoxelWorld; engine: Engine } => {
	const flat = createFlatTestWorld({ floorTop: FLOOR_TOP, extent: EXTENT })
	if (build) build(flat.world)
	const engine = lightCreateEngine({ world: flat.world })
	engine.seedAll(2)
	return { world: flat.world, engine }
}

const snapshot = (world: SimVoxelWorld, region: Region): number[] => {
	const out: number[] = []
	for (let x = region.x0; x <= region.x1; x++) {
		for (let y = region.y0; y <= region.y1; y++) {
			for (let z = region.z0; z <= region.z1; z++) out.push(world.getLightByte(x, y, z))
		}
	}
	return out
}

/** Places a block and runs the differential update to completion. */
const place = (
	engine: Engine,
	world: SimVoxelWorld,
	x: number,
	y: number,
	z: number,
	id: BlockId,
): void => {
	const before = lightPropsOf(world.getBlock(x, y, z))
	world.setBlock(x, y, z, id)
	engine.onBlockChanged(x, y, z, before, lightPropsOf(id))
	engine.drain()
}

const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
	[-1, 0, 0],
	[1, 0, 0],
	[0, -1, 0],
	[0, 1, 0],
	[0, 0, -1],
	[0, 0, 1],
]

/** Independent BFS reference for the block light channel inside a sealed box. */
const referenceBlockLight = (world: SimVoxelWorld, region: Region): Map<string, number> => {
	const levels = new Map<string, number>()
	const queue: number[] = []
	const inside = (x: number, y: number, z: number): boolean =>
		x >= region.x0 &&
		x <= region.x1 &&
		y >= region.y0 &&
		y <= region.y1 &&
		z >= region.z0 &&
		z <= region.z1
	for (let x = region.x0; x <= region.x1; x++) {
		for (let y = region.y0; y <= region.y1; y++) {
			for (let z = region.z0; z <= region.z1; z++) {
				const emission = lightPropsOf(world.getBlock(x, y, z)).emission
				if (emission <= 0) continue
				levels.set(cellKey(x, y, z), emission)
				queue.push(x, y, z)
			}
		}
	}
	for (let head = 0; head < queue.length; head += 3) {
		const x = queue[head]
		const y = queue[head + 1]
		const z = queue[head + 2]
		const level = levels.get(cellKey(x, y, z)) ?? 0
		for (const [dx, dy, dz] of NEIGHBOURS) {
			const nx = x + dx
			const ny = y + dy
			const nz = z + dz
			if (!inside(nx, ny, nz)) continue
			const next = level - 1 - lightPropsOf(world.getBlock(nx, ny, nz)).opacity
			if (next <= 0) continue
			if ((levels.get(cellKey(nx, ny, nz)) ?? 0) >= next) continue
			levels.set(cellKey(nx, ny, nz), next)
			queue.push(nx, ny, nz)
		}
	}
	return levels
}

describe('sky light', () => {
	it(
		'fills the open column and packs the byte as (sky << 4) | block',
		() => {
			const { world } = seeded()
			expect(world.getSkyLightAt(0, FLOOR_TOP, 0)).toBe(MAX_LIGHT)
			expect(world.getSkyLightAt(0, FLOOR_TOP + 5, 0)).toBe(MAX_LIGHT)
			expect(world.getSkyLightAt(0, FLOOR_TOP - 1, 0)).toBe(0)
			expect(world.getLightByte(0, FLOOR_TOP, 0)).toBe((MAX_LIGHT << 4) | 0)
		},
		SLOW,
	)

	it(
		'shadows the voxels under a roof',
		() => {
			const { world } = seeded((w) => {
				fillRegion(w, ROOF.xFrom, ROOF.y, ROOF.zFrom, ROOF.xTo, ROOF.y, ROOF.zTo, BLOCK.STONE)
			})
			expect(world.getSkyLightAt(0, ROOF.y + 1, 0)).toBe(MAX_LIGHT)
			expect(world.getSkyLightAt(0, ROOF.y - 1, 0)).toBeLessThan(MAX_LIGHT)
			expect(world.getSkyLightAt(6, FLOOR_TOP, 0)).toBe(MAX_LIGHT)
		},
		SLOW,
	)
})

describe('block light', () => {
	it(
		'falls off by one per step from a torch',
		() => {
			const { world, engine } = seeded()
			place(engine, world, 0, FLOOR_TOP, 0, BLOCK.TORCH)
			expect(world.getBlockLightAt(0, FLOOR_TOP, 0)).toBe(14)
			expect(world.getBlockLightAt(1, FLOOR_TOP, 0)).toBe(13)
			expect(world.getBlockLightAt(3, FLOOR_TOP, 0)).toBe(11)
			expect(world.getBlockLightAt(0, FLOOR_TOP, -5)).toBe(9)
			expect(world.getBlockLightAt(5, FLOOR_TOP, 5)).toBe(4)
		},
		SLOW,
	)

	it(
		'matches a reference BFS around a corner inside a sealed room',
		() => {
			const room: Region = { x0: -3, x1: 3, y0: FLOOR_TOP, y1: FLOOR_TOP + 2, z0: -3, z1: 3 }
			const { world, engine } = seeded((w) => {
				fillRegion(w, -4, room.y0 - 1, -4, 4, room.y1 + 1, 4, BLOCK.STONE)
				fillRegion(w, room.x0, room.y0, room.z0, room.x1, room.y1, room.z1, BLOCK.AIR)
				// Partition across x = 0 with a doorway at z 2..3, so the only route
				// to the +x half turns two corners.
				fillRegion(w, 0, room.y0, room.z0, 0, room.y1, 1, BLOCK.STONE)
			})
			place(engine, world, -3, FLOOR_TOP, -3, BLOCK.GLOWSTONE)
			const expected = referenceBlockLight(world, room)
			// The far half must be lit through the doorway, otherwise the corner case
			// is not actually exercised.
			expect(expected.get(cellKey(3, FLOOR_TOP, 0)) ?? 0).toBeGreaterThan(0)
			for (let x = room.x0; x <= room.x1; x++) {
				for (let y = room.y0; y <= room.y1; y++) {
					for (let z = room.z0; z <= room.z1; z++) {
						expect(world.getBlockLightAt(x, y, z)).toBe(expected.get(cellKey(x, y, z)) ?? 0)
					}
				}
			}
		},
		SLOW,
	)
})

describe('differential updates', () => {
	it(
		'placing a roof block by block equals a full recompute',
		() => {
			const incremental = seeded()
			for (let x = ROOF.xFrom; x <= ROOF.xTo; x++) {
				for (let z = ROOF.zFrom; z <= ROOF.zTo; z++) {
					place(incremental.engine, incremental.world, x, ROOF.y, z, BLOCK.STONE)
				}
			}
			const full = seeded((w) => {
				fillRegion(w, ROOF.xFrom, ROOF.y, ROOF.zFrom, ROOF.xTo, ROOF.y, ROOF.zTo, BLOCK.STONE)
			})
			expect(snapshot(incremental.world, OPEN)).toEqual(snapshot(full.world, OPEN))
		},
		SLOW,
	)

	it(
		'breaking the roof again equals a full recompute',
		() => {
			const incremental = seeded((w) => {
				fillRegion(w, ROOF.xFrom, ROOF.y, ROOF.zFrom, ROOF.xTo, ROOF.y, ROOF.zTo, BLOCK.STONE)
			})
			for (let x = ROOF.xFrom; x <= ROOF.xTo; x++) {
				for (let z = ROOF.zFrom; z <= ROOF.zTo; z++) {
					place(incremental.engine, incremental.world, x, ROOF.y, z, BLOCK.AIR)
				}
			}
			expect(snapshot(incremental.world, OPEN)).toEqual(snapshot(seeded().world, OPEN))
		},
		SLOW,
	)

	it(
		'placing and removing a torch restores the original field',
		() => {
			const { world, engine } = seeded()
			const before = snapshot(world, OPEN)
			place(engine, world, 0, FLOOR_TOP + 1, 0, BLOCK.TORCH)
			expect(snapshot(world, OPEN)).not.toEqual(before)
			place(engine, world, 0, FLOOR_TOP + 1, 0, BLOCK.AIR)
			expect(snapshot(world, OPEN)).toEqual(before)
		},
		SLOW,
	)

	it(
		'reports dirty sections and drains them once',
		() => {
			const { world, engine } = seeded()
			const out = new Int32Array(3 * 64)
			engine.drainDirtySections(out)
			place(engine, world, 0, FLOOR_TOP, 0, BLOCK.GLOWSTONE)
			expect(engine.drainDirtySections(out)).toBeGreaterThan(0)
			expect(engine.drainDirtySections(out)).toBe(0)
		},
		SLOW,
	)
})

describe('chunk boundaries', () => {
	it(
		'carries block light across a chunk seam',
		() => {
			const { world } = seeded((w) => {
				w.setBlock(LAMP.x, LAMP.y, LAMP.z, BLOCK.GLOWSTONE)
			})
			expect(world.getBlockLightAt(LAMP.x, LAMP.y, LAMP.z)).toBe(MAX_LIGHT)
			expect(world.getBlockLightAt(0, LAMP.y, 0)).toBe(MAX_LIGHT - 1)
			expect(world.getBlockLightAt(2, LAMP.y, 0)).toBe(MAX_LIGHT - 3)
		},
		SLOW,
	)

	it(
		'converges after two passes, so extra passes change nothing',
		() => {
			const { world, engine } = seeded((w) => {
				w.setBlock(LAMP.x, LAMP.y, LAMP.z, BLOCK.GLOWSTONE)
			})
			const converged = snapshot(world, OPEN)
			engine.stitchBoundaries(2)
			engine.drain()
			expect(snapshot(world, OPEN)).toEqual(converged)
		},
		SLOW,
	)

	it(
		'per chunk seeding plus stitching equals one unconfined propagation',
		() => {
			const stitched = seeded((w) => {
				w.setBlock(LAMP.x, LAMP.y, LAMP.z, BLOCK.GLOWSTONE)
			})
			const unconfined = seeded()
			place(unconfined.engine, unconfined.world, LAMP.x, LAMP.y, LAMP.z, BLOCK.GLOWSTONE)
			expect(snapshot(stitched.world, OPEN)).toEqual(snapshot(unconfined.world, OPEN))
		},
		SLOW,
	)
})
