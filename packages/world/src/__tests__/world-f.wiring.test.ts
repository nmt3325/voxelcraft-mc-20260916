/**
 * Wiring of the v2 passes into the public world package. Owned by task
 * v2-world (L1-F).
 *
 * The L2 suites cover each pass on its own against its own factory. This file
 * covers the one thing only the entry point can get wrong: whether
 * createWorldGenerator actually runs them. Villages must appear from the
 * overworld decorate pass, nether ores and patches from the nether
 * generateChunk pipeline, glowstone from the nether decorate pass, and the
 * portal factory must be reachable from the package root.
 */
import type { VillagePlan } from '@voxelcraft/core-types'
import { BLOCK, BLOCK_V2, CHUNK_X, CHUNK_Z, DIMENSION } from '@voxelcraft/core-types'
import { describe, expect, it } from 'vitest'
import {
	ChunkGrid,
	createNoiseBasis,
	createPortalLinker,
	createTerrain,
	createVillageBuilder,
	createWorldGenerator,
	generateRegion,
} from '../index'

const SEED = 1337

/** Blocks that only the village builder ever writes. */
const VILLAGE_BLOCKS: readonly number[] = [
	BLOCK_V2.GRAVEL_PATH,
	BLOCK_V2.COBBLESTONE_WALL,
	BLOCK_V2.FENCE,
	BLOCK_V2.HAY_BLOCK,
	BLOCK_V2.FARMLAND,
	BLOCK.DOOR_LOWER,
	BLOCK.DOOR_UPPER,
]

/** Blocks that only the nether decoration pass ever writes. */
const NETHER_FEATURES: readonly number[] = [
	BLOCK_V2.QUARTZ_ORE,
	BLOCK_V2.SOUL_SAND,
	BLOCK_V2.MAGMA_BLOCK,
]

function countOf(grid: ChunkGrid, ids: readonly number[]): number {
	const wanted = new Set(ids)
	let found = 0
	for (const chunk of grid.all()) {
		for (let i = 0; i < chunk.blocks.length; i++) {
			if (wanted.has(chunk.blocks[i])) found++
		}
	}
	return found
}

/** The first village of the scanned regions, so the test needs no fixture. */
function firstVillage(): VillagePlan {
	const terrain = createTerrain(SEED, createNoiseBasis(SEED))
	const { planner } = createVillageBuilder(terrain)
	for (let rz = -4; rz <= 4; rz++) {
		for (let rx = -4; rx <= 4; rx++) {
			const plan = planner.planRegion(rx, rz)
			if (plan !== null) return plan
		}
	}
	throw new Error('no village was planned in regions [-4, 4]')
}

describe('overworld wiring', () => {
	it('builds villages through the public decorate pass', () => {
		const plan = firstVillage()
		const cx = Math.floor(plan.centerX / CHUNK_X)
		const cz = Math.floor(plan.centerZ / CHUNK_Z)
		const generator = createWorldGenerator(SEED)
		const grid = generateRegion(generator, cx - 2, cz - 2, 5)

		// Generation alone never writes a village: the pass belongs to decorate,
		// which is why the frozen overworld goldens are untouched by it.
		expect(countOf(grid, VILLAGE_BLOCKS)).toBe(0)

		for (const chunk of grid.all()) generator.decorate(chunk.cx, chunk.cz, grid)
		expect(countOf(grid, VILLAGE_BLOCKS)).toBeGreaterThan(0)
	})

	it('keeps nether features out of the overworld', () => {
		const generator = createWorldGenerator(SEED)
		const grid = generateRegion(generator, 0, 0, 2)
		for (const chunk of grid.all()) generator.decorate(chunk.cx, chunk.cz, grid)
		expect(countOf(grid, NETHER_FEATURES)).toBe(0)
	})
})

describe('nether wiring', () => {
	it('places ores and patches inside generateChunk', () => {
		const generator = createWorldGenerator(SEED, DIMENSION.Nether)
		const grid = generateRegion(generator, 0, 0, 3)
		expect(countOf(grid, NETHER_FEATURES)).toBeGreaterThan(0)
	})

	it('hangs glowstone from the nether decorate pass', () => {
		const generator = createWorldGenerator(SEED, DIMENSION.Nether)
		const grid = generateRegion(generator, 0, 0, 3)
		expect(countOf(grid, [BLOCK.GLOWSTONE])).toBe(0)

		for (const chunk of grid.all()) generator.decorate(chunk.cx, chunk.cz, grid)
		expect(countOf(grid, [BLOCK.GLOWSTONE])).toBeGreaterThan(0)
	})

	it('keeps villages out of the nether', () => {
		const generator = createWorldGenerator(SEED, DIMENSION.Nether)
		const grid = generateRegion(generator, 0, 0, 3)
		for (const chunk of grid.all()) generator.decorate(chunk.cx, chunk.cz, grid)
		expect(countOf(grid, VILLAGE_BLOCKS)).toBe(0)
	})
})

describe('portal wiring', () => {
	it('exposes the portal linker from the package entry point', () => {
		const linker = createPortalLinker(SEED, DIMENSION.Overworld)
		expect(typeof linker.validateFrame).toBe('function')
		expect(typeof linker.linkedPosition).toBe('function')
		expect(typeof linker.findLinkTarget).toBe('function')
		expect(typeof linker.ensureLanding).toBe('function')
	})
})
