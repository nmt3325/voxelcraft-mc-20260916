import { describe, expect, it } from 'vitest'
import {
	BLOCK,
	CHUNK_VOLUME,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	DIMENSION,
	blockIndex,
} from '@voxelcraft/core-types'
import { SERVER_GEN_VERSION, generateColumn } from './generator'
import { isKnownBlock } from './validate'
import { createServerWorld } from './worldStore'

const SEED = 20260916
const SEA_LEVEL = 62

function column(seed: number, cx: number, cz: number): { blocks: Uint16Array; fluids: Uint8Array } {
	const blocks = new Uint16Array(CHUNK_VOLUME)
	const fluids = new Uint8Array(CHUNK_VOLUME)
	generateColumn(seed, cx, cz, blocks, fluids)
	return { blocks, fluids }
}

describe('generateColumn', () => {
	it('exposes a gen version so goldens can key off it', () => {
		expect(SERVER_GEN_VERSION).toBe(1)
	})

	it('is a pure function of seed, cx and cz', () => {
		const first = column(SEED, 3, -7)
		const second = column(SEED, 3, -7)
		expect(second.blocks).toEqual(first.blocks)
		expect(second.fluids).toEqual(first.fluids)
	})

	it('does not care what order columns are generated in', () => {
		const forward = [column(SEED, 0, 0), column(SEED, 1, 0), column(SEED, 0, 1)]
		const backward = [column(SEED, 0, 1), column(SEED, 1, 0), column(SEED, 0, 0)]
		expect(backward[2].blocks).toEqual(forward[0].blocks)
		expect(backward[1].blocks).toEqual(forward[1].blocks)
		expect(backward[0].blocks).toEqual(forward[2].blocks)
	})

	it('produces a different column for a different cx, cz or seed', () => {
		const base = column(SEED, 0, 0).blocks
		expect(column(SEED, 1, 0).blocks).not.toEqual(base)
		expect(column(SEED, 0, 1).blocks).not.toEqual(base)
		expect(column(SEED + 1, 0, 0).blocks).not.toEqual(base)
	})

	it('writes only ids the validator accepts', () => {
		const ids = new Set<number>(column(SEED, 2, -2).blocks)
		expect(ids.size).toBeGreaterThan(1)
		for (const id of ids) expect(isKnownBlock(id)).toBe(true)
	})

	it('puts bedrock at y 0 and air at the top of every column', () => {
		const { blocks } = column(SEED, -4, 9)
		for (let lz = 0; lz < CHUNK_Z; lz++) {
			for (let lx = 0; lx < CHUNK_X; lx++) {
				expect(blocks[blockIndex(lx, 0, lz)]).toBe(BLOCK.BEDROCK)
				expect(blocks[blockIndex(lx, CHUNK_Y - 1, lz)]).toBe(BLOCK.AIR)
			}
		}
	})

	it('fills water no higher than sea level and marks the fluid layer', () => {
		let waterCells = 0
		let highestWaterY = -1
		let unmarkedWaterCells = 0
		for (let cx = 0; cx < 4; cx++) {
			const { blocks, fluids } = column(SEED, cx, 0)
			for (let y = 0; y < CHUNK_Y; y++) {
				for (let lz = 0; lz < CHUNK_Z; lz++) {
					for (let lx = 0; lx < CHUNK_X; lx++) {
						const i = blockIndex(lx, y, lz)
						if (blocks[i] !== BLOCK.WATER) continue
						waterCells++
						if (y > highestWaterY) highestWaterY = y
						if (fluids[i] === 0) unmarkedWaterCells++
					}
				}
			}
		}
		expect(waterCells).toBeGreaterThan(0)
		expect(highestWaterY).toBeLessThanOrEqual(SEA_LEVEL)
		expect(unmarkedWaterCells).toBe(0)
	})

	it('stays cheap enough for on demand streaming', () => {
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		generateColumn(SEED, 0, 0, blocks, fluids) // warm the jit before timing
		const started = performance.now()
		for (let cx = 0; cx < 32; cx++) generateColumn(SEED, cx, 5, blocks, fluids)
		// Budget is 2 ms per column; the bound is loose so a noisy runner cannot
		// turn a perf hint into a red gate.
		expect((performance.now() - started) / 32).toBeLessThan(10)
	})

	it('rejects buffers that are not CHUNK_VOLUME long', () => {
		expect(() => generateColumn(SEED, 0, 0, new Uint16Array(8), new Uint8Array(8))).toThrow()
	})
})

describe('createServerWorld', () => {
	it('keeps its seed and defaults to the overworld', () => {
		const world = createServerWorld(SEED)
		expect(world.seed).toBe(SEED)
		expect(world.dimension).toBe(DIMENSION.Overworld)
		expect(createServerWorld(SEED, DIMENSION.Nether).dimension).toBe(DIMENSION.Nether)
	})

	it('generates a column once and then caches it', () => {
		const world = createServerWorld(SEED)
		expect(world.loadedChunks).toBe(0)
		const first = world.chunk(0, 0)
		expect(world.chunk(0, 0)).toBe(first)
		expect(world.chunk(0, 0)).toBe(first)
		expect(world.loadedChunks).toBe(1)
		world.chunk(1, 0)
		world.chunk(0, -1)
		expect(world.loadedChunks).toBe(3)
	})

	it('round trips a block at positive and negative coordinates', () => {
		const world = createServerWorld(SEED)
		const spots: ReadonlyArray<readonly [number, number]> = [
			[5, 7],
			[-1, -1],
			[-33, 40],
			[16, -16],
		]
		for (const [x, z] of spots) {
			expect(world.setBlock(x, 100, z, BLOCK.COBBLESTONE)).toBe(true)
			expect(world.block(x, 100, z)).toBe(BLOCK.COBBLESTONE)
		}
		// Neighbouring columns must not alias onto the same voxel.
		expect(world.setBlock(0, 101, 0, BLOCK.STONE)).toBe(true)
		expect(world.block(-1, 101, 0)).not.toBe(BLOCK.STONE)
	})

	it('bumps the revision of the edited column only', () => {
		const world = createServerWorld(SEED)
		const edited = world.chunk(0, 0)
		const untouched = world.chunk(-2, 3)
		expect(edited.revision).toBe(0)
		world.setBlock(3, 120, 4, BLOCK.STONE)
		expect(edited.revision).toBe(1)
		world.setBlock(3, 121, 4, BLOCK.STONE)
		expect(edited.revision).toBe(2)
		expect(untouched.revision).toBe(0)
	})

	it('refuses to build outside the column and reads air there', () => {
		const world = createServerWorld(SEED)
		expect(world.setBlock(0, -1, 0, BLOCK.STONE)).toBe(false)
		expect(world.setBlock(0, CHUNK_Y, 0, BLOCK.STONE)).toBe(false)
		expect(world.block(0, -1, 0)).toBe(BLOCK.AIR)
		expect(world.block(0, CHUNK_Y, 0)).toBe(BLOCK.AIR)
	})

	it('reports the first free y above the highest non air block', () => {
		const world = createServerWorld(SEED)
		const surface = world.surfaceY(9, -9)
		expect(world.block(9, surface, -9)).toBe(BLOCK.AIR)
		expect(world.block(9, surface - 1, -9)).not.toBe(BLOCK.AIR)
		world.setBlock(9, surface + 6, -9, BLOCK.STONE)
		expect(world.surfaceY(9, -9)).toBe(surface + 7)
	})
})
