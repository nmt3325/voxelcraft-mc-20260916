/**
 * H-05: initial light seeding performance.
 *
 * Blocker H-05 measured sky light seeding plus boundary stitching at roughly
 * 45 ms per chunk, about 10 seconds for the 225 chunks of a render distance 8
 * world. This test rebuilds that exact scenario (15 x 15 chunks) and prints the
 * per chunk average so the before / after numbers are verifiable from the test
 * log rather than from a claim.
 *
 * Wall clock is printed, never used as the primary assertion: the hard
 * assertions are the deterministic correctness invariants (open sky columns,
 * the shadow under a roof that spans three chunks on both axes, block light
 * falloff, and seeding being idempotent). The timing assertion is only a
 * regression guard, with the contract's own `BENCH.failFactor` used as CI
 * slack, exactly as the render / tick benchmarks do.
 *
 * The fixture writes into `ChunkData.blocks` directly instead of going through
 * `setBlock`, because 225 chunks of terrain is 3.6 million voxels and the point
 * here is to measure the light engine, not the voxel setter.
 */
import { describe, expect, it } from 'vitest'
import {
	BENCH,
	BLOCK,
	CHUNK_X,
	CHUNK_Z,
	MAX_LIGHT,
	blockIndex,
} from '@voxelcraft/core-types'
import { createSimVoxelWorld } from '../shared/voxelWorld'
import type { SimVoxelWorld } from '../shared/voxelWorld'
import { lightCreateEngine } from './lightEngine'

/** 15 x 15 = 225 chunks, the world H-05 was measured on. */
const WORLD_CHUNKS = 15
/** H-05 acceptance target, in milliseconds per chunk. */
const TARGET_MS_PER_CHUNK = 15
/** Regression guard. `BENCH.failFactor` is the contract's CI slack convention. */
const GUARD_MS_PER_CHUNK = TARGET_MS_PER_CHUNK * BENCH.failFactor
/** Seeding 225 chunks twice is slow before the optimisation; never flaky. */
const SLOW = 900_000

const SURFACE_BASE = 62
const SURFACE_SPAN = 9

/** Slab roof crossing the x = 48 / 64 and z = 48 / 64 chunk seams. */
const ROOF = { y: 80, x0: 40, x1: 71, z0: 40, z1: 71 } as const
/** One glowstone every fifth chunk, so the block channel is exercised too. */
const LAMP_STRIDE = 5
const LAMP_LOCAL = 8
/** Column with open sky, clear of both the roof and every lamp. */
const OPEN = { x: 5, z: 5 } as const
/** Centre of the roof: 16 blocks from the nearest lit edge, so pitch black. */
const SHADOW = { x: 56, z: 56 } as const

/** Deterministic integer hash, so the fixture is byte reproducible. */
const surfaceAt = (wx: number, wz: number): number => {
	const mixed = (Math.imul(wx + 0x1f, 0x9e3779b1) ^ Math.imul(wz + 0x2b, 0x85ebca6b)) >>> 0
	return SURFACE_BASE + ((mixed >>> 7) % SURFACE_SPAN) - ((SURFACE_SPAN - 1) >> 1)
}

const columnSlot = (lx: number, lz: number): number => (lz << 4) | lx

const buildWorld = (): SimVoxelWorld => {
	const world = createSimVoxelWorld()
	for (let cx = 0; cx < WORLD_CHUNKS; cx++) {
		for (let cz = 0; cz < WORLD_CHUNKS; cz++) {
			const chunk = world.ensureChunk(cx, cz)
			const baseX = cx * CHUNK_X
			const baseZ = cz * CHUNK_Z
			for (let lz = 0; lz < CHUNK_Z; lz++) {
				for (let lx = 0; lx < CHUNK_X; lx++) {
					const surface = surfaceAt(baseX + lx, baseZ + lz)
					for (let y = 0; y <= surface; y++) {
						chunk.blocks[blockIndex(lx, y, lz)] =
							y === 0 ? BLOCK.BEDROCK : y > surface - 4 ? BLOCK.DIRT : BLOCK.STONE
					}
					chunk.heightmap[columnSlot(lx, lz)] = surface + 1
				}
			}
		}
	}
	for (let x = ROOF.x0; x <= ROOF.x1; x++) {
		for (let z = ROOF.z0; z <= ROOF.z1; z++) {
			const chunk = world.ensureChunk(x >> 4, z >> 4)
			const lx = x & 15
			const lz = z & 15
			chunk.blocks[blockIndex(lx, ROOF.y, lz)] = BLOCK.STONE
			chunk.heightmap[columnSlot(lx, lz)] = ROOF.y + 1
		}
	}
	for (let cx = 0; cx < WORLD_CHUNKS; cx += LAMP_STRIDE) {
		for (let cz = 0; cz < WORLD_CHUNKS; cz += LAMP_STRIDE) {
			const chunk = world.ensureChunk(cx, cz)
			const lampY = surfaceAt(cx * CHUNK_X + LAMP_LOCAL, cz * CHUNK_Z + LAMP_LOCAL) + 2
			chunk.blocks[blockIndex(LAMP_LOCAL, lampY, LAMP_LOCAL)] = BLOCK.GLOWSTONE
			chunk.heightmap[columnSlot(LAMP_LOCAL, LAMP_LOCAL)] = lampY + 1
		}
	}
	return world
}

interface Timing {
	chunks: number
	seedMs: number
	stitchMs: number
	totalMs: number
	perChunkMs: number
}

const measure = (
	world: SimVoxelWorld,
	engine: ReturnType<typeof lightCreateEngine>,
): Timing => {
	const chunks = world.orderedChunks()
	const start = performance.now()
	for (const chunk of chunks) engine.seedChunk(chunk.cx, chunk.cz)
	const seeded = performance.now()
	engine.stitchBoundaries(2)
	engine.drain()
	const done = performance.now()
	const seedMs = seeded - start
	const stitchMs = done - seeded
	return {
		chunks: chunks.length,
		seedMs,
		stitchMs,
		totalMs: seedMs + stitchMs,
		perChunkMs: (seedMs + stitchMs) / chunks.length,
	}
}

describe('light seeding performance (H-05)', () => {
	it(
		'seeds and stitches 225 chunks within the per chunk budget',
		() => {
			const world = buildWorld()
			const engine = lightCreateEngine({ world })
			const first = measure(world, engine)
			expect(first.chunks).toBe(WORLD_CHUNKS * WORLD_CHUNKS)

			console.log(
				`[H-05] ${first.chunks} chunks: seed ${first.seedMs.toFixed(1)} ms + ` +
					`stitch ${first.stitchMs.toFixed(1)} ms = ${first.totalMs.toFixed(1)} ms ` +
					`-> ${first.perChunkMs.toFixed(2)} ms/chunk ` +
					`(target ${TARGET_MS_PER_CHUNK} ms/chunk, guard ${GUARD_MS_PER_CHUNK})`,
			)

			// Correctness first: a fast engine that lights the world wrongly is worse
			// than a slow one.
			const openSurface = surfaceAt(OPEN.x, OPEN.z)
			expect(world.getSkyLightAt(OPEN.x, openSurface + 1, OPEN.z)).toBe(MAX_LIGHT)
			expect(world.getSkyLightAt(OPEN.x, openSurface + 40, OPEN.z)).toBe(MAX_LIGHT)
			expect(world.getSkyLightAt(OPEN.x, openSurface, OPEN.z)).toBe(0)

			expect(world.getSkyLightAt(SHADOW.x, ROOF.y + 1, SHADOW.z)).toBe(MAX_LIGHT)
			expect(world.getSkyLightAt(SHADOW.x, ROOF.y - 1, SHADOW.z)).toBe(0)
			// The lit rim under the roof edge proves the shadow is a real gradient and
			// that it crossed the chunk seams rather than stopping at them.
			expect(world.getSkyLightAt(ROOF.x0, ROOF.y - 1, SHADOW.z)).toBeGreaterThan(0)
			expect(world.getSkyLightAt(ROOF.x0, ROOF.y - 1, SHADOW.z)).toBeLessThan(MAX_LIGHT)

			const lampY = surfaceAt(LAMP_LOCAL, LAMP_LOCAL) + 2
			expect(world.getBlockLightAt(LAMP_LOCAL, lampY, LAMP_LOCAL)).toBe(MAX_LIGHT)
			expect(world.getBlockLightAt(LAMP_LOCAL, lampY + 1, LAMP_LOCAL)).toBe(MAX_LIGHT - 1)
			expect(world.getBlockLightAt(LAMP_LOCAL, lampY + 2, LAMP_LOCAL)).toBe(MAX_LIGHT - 2)

			// Re-seeding a converged world must not change a single light byte, which
			// is what makes skipping already lit chunks a safe optimisation.
			const converged = world.hash()
			const second = measure(world, engine)
			expect(world.hash()).toBe(converged)
			console.log(
				`[H-05] re-seed of an already lit world: ${second.totalMs.toFixed(1)} ms ` +
					`-> ${second.perChunkMs.toFixed(2)} ms/chunk`,
			)

			expect(first.perChunkMs).toBeLessThan(GUARD_MS_PER_CHUNK)
		},
		SLOW,
	)
})
