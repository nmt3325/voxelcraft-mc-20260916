/**
 * Nether bulk terrain. Owned by task v2-world (L1-F).
 *
 * The invariant tests aggregate their findings into a single expect, so a
 * failure names every rule that broke instead of stopping at the first voxel.
 */
import { describe, expect, it } from 'vitest'
import {
	BENCH,
	BLOCK,
	BLOCK_V2,
	CHUNK_VOLUME,
	CHUNK_X,
	CHUNK_Y,
	CHUNK_Z,
	DIMENSION,
	FLUID,
	NETHER_GEN,
	PERF,
	blockIndex,
	packFluid,
} from '@voxelcraft/core-types'
import { NETHER_ROOF_TOP, createWorldGenerator } from '../index'

const SEEDS = [1337, 20260916]
const LAVA_SOURCE = packFluid({ kind: FLUID.Lava, level: 0, falling: false })

function genNether(seed: number, cx: number, cz: number) {
	const gen = createWorldGenerator(seed, DIMENSION.Nether)
	const blocks = new Uint16Array(CHUNK_VOLUME)
	const fluids = new Uint8Array(CHUNK_VOLUME)
	gen.generateChunk(cx, cz, blocks, fluids)
	return { blocks, fluids }
}

describe('nether determinism', () => {
	it.each(SEEDS)('generates an identical chunk twice for seed %i', (seed) => {
		const a = genNether(seed, 3, -7)
		const b = genNether(seed, 3, -7)
		expect(b.blocks).toEqual(a.blocks)
		expect(b.fluids).toEqual(a.fluids)
	})

	it('produces a different nether for a different seed', () => {
		const a = genNether(SEEDS[0], 0, 0)
		const b = genNether(SEEDS[1], 0, 0)
		expect(b.blocks).not.toEqual(a.blocks)
	})

	it('does not depend on the order chunks are generated in', () => {
		const forward = createWorldGenerator(SEEDS[0], DIMENSION.Nether)
		const backward = createWorldGenerator(SEEDS[0], DIMENSION.Nether)
		const scratch = new Uint16Array(CHUNK_VOLUME)
		const scratchFluids = new Uint8Array(CHUNK_VOLUME)
		const first = new Uint16Array(CHUNK_VOLUME)
		const firstFluids = new Uint8Array(CHUNK_VOLUME)

		forward.generateChunk(0, 0, scratch, scratchFluids)
		forward.generateChunk(1, -1, first, firstFluids)

		const second = new Uint16Array(CHUNK_VOLUME)
		const secondFluids = new Uint8Array(CHUNK_VOLUME)
		backward.generateChunk(1, -1, second, secondFluids)

		expect(second).toEqual(first)
		expect(secondFluids).toEqual(firstFluids)
	})

	it.each(SEEDS)('reports a column matching the generated chunk for seed %i', (seed) => {
		const cx = 2
		const cz = 5
		const gen = createWorldGenerator(seed, DIMENSION.Nether)
		const other = createWorldGenerator(seed, DIMENSION.Nether)
		const { blocks } = genNether(seed, cx, cz)

		let checked = 0
		for (let x = 0; x < CHUNK_X; x += 3) {
			for (let z = 0; z < CHUNK_Z; z += 3) {
				const wx = cx * CHUNK_X + x
				const wz = cz * CHUNK_Z + z
				const sample = gen.sampleColumn(wx, wz)
				// Two independent generators of one seed agree on the column.
				expect(other.sampleColumn(wx, wz).surfaceY).toBe(sample.surfaceY)
				if (sample.surfaceY === NETHER_GEN.lavaSeaLevel) continue
				// ... and the column agrees with the voxels of the generated chunk.
				const y = sample.surfaceY
				expect(blocks[blockIndex(x, y, z)]).toBe(BLOCK_V2.NETHERRACK)
				expect(blocks[blockIndex(x, y + 1, z)]).toBe(BLOCK.AIR)
				expect(blocks[blockIndex(x, y + 2, z)]).toBe(BLOCK.AIR)
				checked++
			}
		}
		expect(checked).toBeGreaterThan(0)
	})
})

describe('nether shell invariants', () => {
	it.each(SEEDS)('keeps the floor, the roof and the lava sea intact for seed %i', (seed) => {
		const { blocks, fluids } = genNether(seed, -4, 9)
		const broken = {
			floorNotBedrock: 0,
			roofNotBedrock: 0,
			solidAboveRoof: 0,
			airBelowSeaLevel: 0,
			lavaWithoutSource: 0,
			lavaAboveSeaLevel: 0,
			bedrockInsideShell: 0,
		}
		let lava = 0
		let openAboveSea = 0

		for (let z = 0; z < CHUNK_Z; z++) {
			for (let x = 0; x < CHUNK_X; x++) {
				if (blocks[blockIndex(x, 0, z)] !== BLOCK.BEDROCK) broken.floorNotBedrock++
				if (blocks[blockIndex(x, NETHER_ROOF_TOP, z)] !== BLOCK.BEDROCK) broken.roofNotBedrock++

				for (let y = 1; y < CHUNK_Y; y++) {
					const i = blockIndex(x, y, z)
					const id = blocks[i]
					if (y <= NETHER_GEN.lavaSeaLevel) {
						// Nothing is walkable below the sea: it is rock or lava.
						if (id === BLOCK.AIR) broken.airBelowSeaLevel++
						if (id === BLOCK.LAVA) {
							lava++
							if (fluids[i] !== LAVA_SOURCE) broken.lavaWithoutSource++
						}
					} else if (id === BLOCK.LAVA) {
						broken.lavaAboveSeaLevel++
					}
					if (y > NETHER_ROOF_TOP && id !== BLOCK.AIR) broken.solidAboveRoof++
					if (y >= NETHER_GEN.floorY && y < NETHER_GEN.roofY) {
						if (id === BLOCK.BEDROCK) broken.bedrockInsideShell++
						if (y > NETHER_GEN.lavaSeaLevel && id === BLOCK.AIR) openAboveSea++
					}
				}
			}
		}

		expect(broken).toEqual({
			floorNotBedrock: 0,
			roofNotBedrock: 0,
			solidAboveRoof: 0,
			airBelowSeaLevel: 0,
			lavaWithoutSource: 0,
			lavaAboveSeaLevel: 0,
			bedrockInsideShell: 0,
		})
		// A nether with no lava sea, or with no room to walk, would satisfy every
		// rule above while being useless.
		expect(lava).toBeGreaterThan(0)
		expect(openAboveSea).toBeGreaterThan(0)
		const shell = CHUNK_X * CHUNK_Z * (NETHER_GEN.roofY - NETHER_GEN.floorY)
		console.log(
			`world-f nether seed ${seed}: open above sea ${((openAboveSea / shell) * 100).toFixed(2)}%, lava voxels ${lava}`,
		)
	})

	it('fills the bedrock layers without sealing the shell into solid rock', () => {
		const { blocks } = genNether(SEEDS[0], 12, -30)
		let floorBedrock = 0
		let roofBedrock = 0
		for (let z = 0; z < CHUNK_Z; z++) {
			for (let x = 0; x < CHUNK_X; x++) {
				for (let y = 0; y < NETHER_GEN.floorY; y++) {
					if (blocks[blockIndex(x, y, z)] === BLOCK.BEDROCK) floorBedrock++
				}
				for (let y = NETHER_GEN.roofY; y <= NETHER_ROOF_TOP; y++) {
					if (blocks[blockIndex(x, y, z)] === BLOCK.BEDROCK) roofBedrock++
				}
			}
		}
		const perLayer = CHUNK_X * CHUNK_Z
		// Rough layers: more than the one guaranteed solid layer, less than all.
		expect(floorBedrock).toBeGreaterThan(perLayer)
		expect(floorBedrock).toBeLessThan(perLayer * NETHER_GEN.floorY)
		expect(roofBedrock).toBeGreaterThan(perLayer)
		expect(roofBedrock).toBeLessThan(perLayer * NETHER_GEN.bedrockLayers)
	})
})

describe('nether performance', () => {
	it('generates a nether chunk within the benchmark budget', () => {
		const gen = createWorldGenerator(1337, DIMENSION.Nether)
		const blocks = new Uint16Array(CHUNK_VOLUME)
		const fluids = new Uint8Array(CHUNK_VOLUME)
		for (let i = 0; i < 6; i++) gen.generateChunk(i, 99, blocks, fluids)

		const count = 24
		const started = performance.now()
		for (let i = 0; i < count; i++) {
			gen.generateChunk(i % 6, Math.floor(i / 6), blocks, fluids)
		}
		const avg = (performance.now() - started) / count
		console.log(
			`world-f nether chunkGen avg ${avg.toFixed(3)} ms over ${count} chunks (budget ${PERF.chunkGenBudgetMs} ms, bench max ${BENCH.chunkGenAvgMsMax} ms)`,
		)
		expect(avg).toBeLessThan(BENCH.chunkGenAvgMsMax * BENCH.failFactor)
	})
})
